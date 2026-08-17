import { authenticate } from "../shopify.server";
import { recordWebhookOnce } from "./tenant.server";
import { enqueueFullSync } from "../jobs/queue.server";

// Shared handler for product / inventory / order webhooks: verify HMAC, dedupe
// the delivery, then enqueue a DEBOUNCED re-sync (never process inline). A burst
// of changes collapses into a single sync via the delay + SyncState dedupe.
export const resyncAction = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);
  const eventId = request.headers.get("x-shopify-webhook-id");

  const fresh = await recordWebhookOnce({ shop, topic, eventId });
  if (fresh) {
    await enqueueFullSync(shop, { delayMs: 15000 });
  }

  return new Response();
};
