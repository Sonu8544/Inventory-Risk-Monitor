import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { syncInventory, syncSales } from "../services/sync.server";
import { recomputeRisk } from "../services/risk.server";
import { getShopSettings } from "../services/settings.server";
import { sendHighRiskAlert } from "../services/notify.server";
import { isPro } from "../services/billing.server";

// -----------------------------------------------------------------------------
// Background processing (Phase 3).
//
// Webhooks and the "Sync now" action should return immediately; the heavy work
// (paginated GraphQL sync + scoring) runs here on a BullMQ queue backed by Redis.
//
// The Worker runs IN-PROCESS with the app server. That keeps dev simple (no
// second process, same env/secrets) and works for a single-container deploy.
// For horizontal scale, run this module in a dedicated worker process instead —
// the job logic (`processJob`) does not change.
// -----------------------------------------------------------------------------

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const QUEUE_NAME = "inventory";

// BullMQ requires connections with request-retries disabled (workers use
// blocking commands). Queue and Worker must not share one connection.
function makeConnection() {
  return new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
}

// Singletons survive Vite/React Router hot-reloads in dev (same pattern as
// db.server.js) so we don't spawn a new Queue/Worker on every code change.
const g = global;

export const inventoryQueue =
  g.__inventoryQueue ??
  new Queue(QUEUE_NAME, {
    connection: makeConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: 50,
      removeOnFail: 200,
    },
  });
if (!g.__inventoryQueue) g.__inventoryQueue = inventoryQueue;

/**
 * Enqueue a full inventory sync for a shop. Deduped via SyncState: if a sync is
 * already queued or running for this shop, we skip enqueuing another.
 * @param {string} shop
 * @returns {Promise<{ queued: boolean, skipped?: boolean }>}
 */
export async function enqueueFullSync(shop) {
  const state = await prisma.syncState.findUnique({
    where: { shop_resource: { shop, resource: "products" } },
  });
  if (state && (state.status === "queued" || state.status === "running")) {
    return { queued: false, skipped: true };
  }

  await prisma.syncState.upsert({
    where: { shop_resource: { shop, resource: "products" } },
    create: { shop, resource: "products", status: "queued" },
    update: { status: "queued", error: null },
  });

  await inventoryQueue.add("full-sync", { shop });
  return { queued: true };
}

// --- Worker (consumer) ---
async function processJob(job) {
  if (job.name === "full-sync") {
    const { shop } = job.data;
    // No incoming request in a background job — load the stored offline token.
    const { admin } = await unauthenticated.admin(shop);
    const synced = await syncInventory({ admin, shop });
    const sales = await syncSales({ admin, shop });
    const { tally, newlyHighRisk } = await recomputeRisk({ shop });

    // Notify (Phase 6): only on new high-risk transitions, and never fail the
    // sync if the notification channel is down.
    let notified = 0;
    if (newlyHighRisk.length) {
      // Automated alerts are a Pro feature (Phase 8 gating).
      const [settings, pro] = await Promise.all([
        getShopSettings(shop),
        isPro(shop),
      ]);
      if (pro && settings.notify?.enabled && settings.notify?.webhookUrl) {
        try {
          await sendHighRiskAlert({
            webhookUrl: settings.notify.webhookUrl,
            shop,
            items: newlyHighRisk,
          });
          notified = newlyHighRisk.length;
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error("[notify] Teams alert failed:", err?.message);
        }
      }
    }

    return { synced, sales, tally, notified };
  }
  throw new Error(`Unknown job type: ${job.name}`);
}

if (!g.__inventoryWorker) {
  const worker = new Worker(QUEUE_NAME, processJob, {
    connection: makeConnection(),
    concurrency: 2,
  });
  worker.on("completed", (job) => {
    // eslint-disable-next-line no-console
    console.log(`[worker] ${job.name} completed for ${job.data?.shop}`);
  });
  worker.on("failed", (job, err) => {
    // eslint-disable-next-line no-console
    console.error(`[worker] ${job?.name} failed:`, err?.message);
  });
  g.__inventoryWorker = worker;
}
