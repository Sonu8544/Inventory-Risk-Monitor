import { useLoaderData, useRouteError } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { DEFAULT_CONFIG } from "../services/risk-engine";
import { BUCKET_META } from "../services/risk-buckets";

function safeParse(json) {
  try {
    return json ? JSON.parse(json) : [];
  } catch {
    return [];
  }
}

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const windowDays = DEFAULT_CONFIG.salesWindowDays;
  const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  // shop-scoped lookup — a variant id from another store returns nothing.
  const variant = await prisma.variant.findFirst({
    where: { id: params.id, shop },
    include: {
      product: true,
      riskScore: true,
      inventoryLevels: true,
      salesDaily: { where: { date: { gte: cutoff } }, orderBy: { date: "asc" } },
    },
  });
  if (!variant) throw new Response("Variant not found", { status: 404 });

  const locations = await prisma.location.findMany({ where: { shop } });
  const locName = new Map(locations.map((l) => [l.shopifyLocationId, l.name]));

  const totalAvailable = variant.inventoryLevels.reduce(
    (s, il) => s + il.available,
    0,
  );
  const unitsInWindow = variant.salesDaily.reduce(
    (s, sd) => s + sd.unitsSold,
    0,
  );
  const velocity = unitsInWindow / windowDays;
  const daysOfCover = velocity > 0 ? totalAvailable / velocity : null;

  return {
    productGid: variant.product.shopifyProductId,
    productTitle: variant.product.title,
    variantTitle: variant.title,
    sku: variant.sku,
    status: variant.product.status,
    bucket: variant.riskScore?.bucket ?? "NOT_ENOUGH_DATA",
    reasons: safeParse(variant.riskScore?.reasons),
    totalAvailable,
    velocity,
    daysOfCover,
    unitsInWindow,
    windowDays,
    levels: variant.inventoryLevels.map((il) => ({
      id: il.id,
      location: locName.get(il.locationId) ?? il.locationId,
      available: il.available,
    })),
    sales: variant.salesDaily.map((sd) => ({
      date: sd.date,
      units: sd.unitsSold,
    })),
  };
};

const round1 = (n) => Math.round(n * 10) / 10;

export default function VariantDetail() {
  const data = useLoaderData();
  const shopify = useAppBridge();
  const meta = BUCKET_META[data.bucket];

  const editInAdmin = () =>
    shopify.intents?.invoke?.("edit:shopify/Product", {
      value: data.productGid,
    });

  return (
    <s-page heading={data.productTitle}>
      <s-button slot="primary-action" onClick={editInAdmin}>
        Edit in Admin
      </s-button>

      <s-section>
        <s-stack direction="inline" gap="base" alignItems="center">
          {meta && <s-badge tone={meta.tone}>{meta.label}</s-badge>}
          {data.variantTitle && data.variantTitle !== "Default Title" && (
            <s-text>{data.variantTitle}</s-text>
          )}
          {data.sku && <s-text color="subdued">SKU: {data.sku}</s-text>}
          <s-link href="/app">← Back to dashboard</s-link>
        </s-stack>
      </s-section>

      <s-section heading="Why it's flagged">
        {data.reasons.length ? (
          <s-unordered-list>
            {data.reasons.map((r, i) => (
              <s-list-item key={i}>{r}</s-list-item>
            ))}
          </s-unordered-list>
        ) : (
          <s-paragraph>No specific reasons recorded.</s-paragraph>
        )}
      </s-section>

      <s-section heading="Signals">
        <s-table variant="auto">
          <s-table-header-row>
            <s-table-header listSlot="primary">Metric</s-table-header>
            <s-table-header>Value</s-table-header>
          </s-table-header-row>
          <s-table-body>
            <s-table-row>
              <s-table-cell>Total available</s-table-cell>
              <s-table-cell>{data.totalAvailable}</s-table-cell>
            </s-table-row>
            <s-table-row>
              <s-table-cell>Sales velocity</s-table-cell>
              <s-table-cell>~{round1(data.velocity)} / day</s-table-cell>
            </s-table-row>
            <s-table-row>
              <s-table-cell>Days of cover</s-table-cell>
              <s-table-cell>
                {data.daysOfCover != null
                  ? `~${round1(data.daysOfCover)} days`
                  : "—"}
              </s-table-cell>
            </s-table-row>
            <s-table-row>
              <s-table-cell>Units sold ({data.windowDays}d)</s-table-cell>
              <s-table-cell>{data.unitsInWindow}</s-table-cell>
            </s-table-row>
            <s-table-row>
              <s-table-cell>Product status</s-table-cell>
              <s-table-cell>{data.status ?? "—"}</s-table-cell>
            </s-table-row>
          </s-table-body>
        </s-table>
      </s-section>

      <s-section heading="Stock by location">
        {data.levels.length ? (
          <s-table variant="auto">
            <s-table-header-row>
              <s-table-header listSlot="primary">Location</s-table-header>
              <s-table-header>Available</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {data.levels.map((l) => (
                <s-table-row key={l.id}>
                  <s-table-cell>{l.location}</s-table-cell>
                  <s-table-cell>{l.available}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        ) : (
          <s-paragraph>Inventory isn&apos;t tracked for this variant.</s-paragraph>
        )}
      </s-section>

      <s-section heading={`Sales (last ${data.windowDays} days)`}>
        {data.sales.length ? (
          <s-table variant="auto">
            <s-table-header-row>
              <s-table-header listSlot="primary">Date</s-table-header>
              <s-table-header>Units sold</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {data.sales.map((s) => (
                <s-table-row key={s.date}>
                  <s-table-cell>
                    {new Date(s.date).toLocaleDateString()}
                  </s-table-cell>
                  <s-table-cell>{s.units}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        ) : (
          <s-paragraph>No sales recorded in this window.</s-paragraph>
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
