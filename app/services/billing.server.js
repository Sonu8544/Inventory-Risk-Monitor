import prisma from "../db.server";
import { PRO_PLAN } from "../shopify.server";

// Use Shopify test charges in dev/demo so no real card is charged.
// Set to false for production billing.
export const BILLING_IS_TEST = process.env.NODE_ENV !== "production";

export { PRO_PLAN };

/**
 * Check the shop's subscription with Shopify, persist the result to Shop.plan
 * (so background jobs can gate features without an API call), and return status.
 * @param {{ billing: any, shop: string }} args
 * @returns {Promise<{ subscribed: boolean, subscription: object|null }>}
 */
export async function checkAndPersistPlan({ billing, shop }) {
  const { hasActivePayment, appSubscriptions } = await billing.check({
    plans: [PRO_PLAN],
    isTest: BILLING_IS_TEST,
  });
  const subscription = appSubscriptions?.[0] ?? null;

  await prisma.shop.upsert({
    where: { shop },
    create: { shop, plan: hasActivePayment ? PRO_PLAN : null },
    update: { plan: hasActivePayment ? PRO_PLAN : null },
  });

  return { subscribed: hasActivePayment, subscription };
}

/** DB-only Pro check for background jobs (no Shopify API call). */
export async function isPro(shop) {
  const row = await prisma.shop.findUnique({ where: { shop } });
  return row?.plan === PRO_PLAN;
}
