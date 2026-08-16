import prisma from "../db.server";

// Multi-tenancy + reliability helpers (Phase 7).

/**
 * Delete ALL data for a shop across every tenant-scoped table. Called on
 * app/uninstalled and satisfies GDPR "shop redact". Children first, then
 * parents, so it works even if a DB adapter doesn't enforce FK cascades.
 * Idempotent — safe to run repeatedly.
 * @param {string} shop
 */
export async function purgeShopData(shop) {
  await prisma.$transaction([
    prisma.riskScore.deleteMany({ where: { shop } }),
    prisma.salesDaily.deleteMany({ where: { shop } }),
    prisma.inventoryLevel.deleteMany({ where: { shop } }),
    prisma.variant.deleteMany({ where: { shop } }),
    prisma.product.deleteMany({ where: { shop } }),
    prisma.location.deleteMany({ where: { shop } }),
    prisma.webhookEvent.deleteMany({ where: { shop } }),
    prisma.syncState.deleteMany({ where: { shop } }),
    prisma.shop.deleteMany({ where: { shop } }),
    prisma.session.deleteMany({ where: { shop } }),
  ]);
}

/**
 * Idempotency guard: returns true the FIRST time a (topic, eventId) pair is
 * seen, false on any redelivery. Shopify can deliver a webhook more than once,
 * so side-effectful handlers should bail when this returns false.
 * @param {{ shop: string, topic: string, eventId: string|null }} args
 * @returns {Promise<boolean>}
 */
export async function recordWebhookOnce({ shop, topic, eventId }) {
  if (!eventId) return true; // nothing to dedupe on — allow processing
  try {
    await prisma.webhookEvent.create({ data: { shop, topic, eventId } });
    return true;
  } catch {
    // Unique (topic, eventId) violation → already handled.
    return false;
  }
}
