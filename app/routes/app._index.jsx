import { useEffect } from "react";
import {
  useFetcher,
  useLoaderData,
  useNavigate,
  useRevalidator,
  useRouteError,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { enqueueFullSync } from "../jobs/queue.server";
import { BUCKET, BUCKET_META, BUCKET_ORDER } from "../services/risk-buckets";

function safeParse(json) {
  try {
    return json ? JSON.parse(json) : [];
  } catch {
    return [];
  }
}

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  // Filter: "FLAGGED" (default) = everything except healthy; "ALL"; or a bucket.
  const activeBucket = new URL(request.url).searchParams.get("bucket") || "FLAGGED";
  const listWhere = { shop };
  if (activeBucket === "FLAGGED") listWhere.bucket = { not: BUCKET.HEALTHY };
  else if (activeBucket !== "ALL") listWhere.bucket = activeBucket;

  const [grouped, items, syncState] = await Promise.all([
    prisma.riskScore.groupBy({
      by: ["bucket"],
      where: { shop },
      _count: { bucket: true },
    }),
    prisma.riskScore.findMany({
      where: listWhere,
      orderBy: { score: "desc" },
      take: 100,
      include: { variant: { include: { product: true } } },
    }),
    prisma.syncState.findUnique({
      where: { shop_resource: { shop, resource: "products" } },
    }),
  ]);

  const counts = Object.fromEntries(BUCKET_ORDER.map((b) => [b, 0]));
  for (const row of grouped) counts[row.bucket] = row._count.bucket;

  const flagged = items.map((r) => ({
    id: r.id,
    variantId: r.variantId,
    bucket: r.bucket,
    score: r.score,
    reasons: safeParse(r.reasons),
    productTitle: r.variant?.product?.title ?? "Unknown product",
    variantTitle: r.variant?.title ?? null,
    sku: r.variant?.sku ?? null,
  }));

  return {
    counts,
    flagged,
    lastSyncedAt: syncState?.lastSyncedAt ?? null,
    hasData: grouped.length > 0,
    syncStatus: syncState?.status ?? null,
    syncError: syncState?.status === "error" ? syncState?.error : null,
    activeBucket,
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  // Return fast: hand the heavy sync to the background worker (Phase 3).
  const result = await enqueueFullSync(session.shop);
  return { ok: true, ...result };
};

function variantLabel(item) {
  const title =
    item.variantTitle && item.variantTitle !== "Default Title"
      ? item.variantTitle
      : null;
  if (title && item.sku) return `${title} (${item.sku})`;
  if (title) return title;
  if (item.sku) return item.sku;
  return "—";
}

const FILTERS = [
  { key: "FLAGGED", label: "Flagged" },
  { key: "HIGH_RISK", label: "High risk" },
  { key: "NEEDS_ATTENTION", label: "Needs attention" },
  { key: "HEALTHY", label: "Healthy" },
  { key: "NOT_ENOUGH_DATA", label: "Not enough data" },
  { key: "ALL", label: "All" },
];

export default function Index() {
  const {
    counts,
    flagged,
    lastSyncedAt,
    hasData,
    syncStatus,
    syncError,
    activeBucket,
  } = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const revalidator = useRevalidator();
  const navigate = useNavigate();

  // A sync is in-flight while the background job is queued or running.
  const isRunning = syncStatus === "queued" || syncStatus === "running";
  const isSubmitting =
    ["loading", "submitting"].includes(fetcher.state) &&
    fetcher.formMethod === "POST";
  const isSyncing = isRunning || isSubmitting;

  // Poll the loader every 2s while a sync is in progress so counts/flagged
  // update live as the worker finishes.
  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => {
      if (revalidator.state === "idle") revalidator.revalidate();
    }, 2000);
    return () => clearInterval(id);
  }, [isRunning, revalidator]);

  useEffect(() => {
    if (fetcher.data?.ok && fetcher.data.queued) {
      shopify.toast.show("Sync started in the background…");
    } else if (fetcher.data?.ok && fetcher.data.skipped) {
      shopify.toast.show("A sync is already in progress");
    }
  }, [fetcher.data, shopify]);

  const runSync = () => fetcher.submit({}, { method: "POST" });

  return (
    <s-page heading="Inventory Risk Monitor">
      <s-button
        slot="primary-action"
        onClick={runSync}
        {...(isSyncing ? { loading: true } : {})}
      >
        {isSyncing ? "Syncing…" : "Sync now"}
      </s-button>

      {syncError && (
        <s-banner heading="Sync failed" tone="critical">
          <s-paragraph>{syncError}</s-paragraph>
        </s-banner>
      )}

      {isRunning && (
        <s-banner heading="Sync in progress" tone="info">
          <s-paragraph>
            Pulling your store&apos;s inventory and scoring risk in the
            background — this page updates automatically.
          </s-paragraph>
        </s-banner>
      )}

      <s-section heading="What needs my attention?">
        <s-paragraph color="subdued">
          {lastSyncedAt
            ? `Last synced: ${new Date(lastSyncedAt).toLocaleString()}`
            : "Not synced yet — click “Sync now” to pull your store's inventory."}
        </s-paragraph>

        <s-grid gridTemplateColumns="1fr 1fr 1fr 1fr" gap="base">
          {BUCKET_ORDER.map((b) => (
            <s-box
              key={b}
              padding="base"
              background="subdued"
              borderRadius="base"
            >
              <s-stack direction="block" gap="base">
                <s-heading>{counts[b] ?? 0}</s-heading>
                <s-badge tone={BUCKET_META[b].tone}>
                  {BUCKET_META[b].label}
                </s-badge>
              </s-stack>
            </s-box>
          ))}
        </s-grid>
      </s-section>

      <s-section heading="Flagged inventory">
        <s-button-group>
          {FILTERS.map((f) => (
            <s-button
              key={f.key}
              variant={activeBucket === f.key ? "primary" : "tertiary"}
              onClick={() =>
                navigate(f.key === "FLAGGED" ? "/app" : `/app?bucket=${f.key}`)
              }
            >
              {f.label}
            </s-button>
          ))}
        </s-button-group>

        {!hasData && (
          <s-paragraph>
            No risk data yet. Click “Sync now” to analyze your inventory.
          </s-paragraph>
        )}
        {hasData && flagged.length === 0 && (
          <s-paragraph>Nothing in this view.</s-paragraph>
        )}
        {flagged.length > 0 && (
          <s-table variant="auto">
            <s-table-header-row>
              <s-table-header listSlot="primary">Product</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header>Variant / SKU</s-table-header>
              <s-table-header>Reason</s-table-header>
              <s-table-header>Details</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {flagged.map((item) => (
                <s-table-row key={item.id}>
                  <s-table-cell>{item.productTitle}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={BUCKET_META[item.bucket]?.tone}>
                      {BUCKET_META[item.bucket]?.label}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>{variantLabel(item)}</s-table-cell>
                  <s-table-cell>{item.reasons.join(" · ")}</s-table-cell>
                  <s-table-cell>
                    <s-link href={`/app/variants/${item.variantId}`}>
                      View
                    </s-link>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
