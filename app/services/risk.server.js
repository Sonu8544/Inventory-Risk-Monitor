import prisma from "../db.server";
import { DEFAULT_CONFIG, scoreVariant } from "./risk-engine";

// Server-side runner: feeds DB data into the pure engine (./risk-engine.js) and
// persists a RiskScore per variant. Keep scoring logic in the engine, not here.

/**
 * Recompute and persist a RiskScore for every variant of a shop, using current
 * inventory + sales velocity from `SalesDaily`. Also detects variants that just
 * transitioned INTO high risk (for notifications).
 * @param {{ shop: string, config?: Partial<typeof DEFAULT_CONFIG> }} args
 * @returns {Promise<{ tally: Record<string, number>, newlyHighRisk: Array<object> }>}
 */
export async function recomputeRisk({ shop, config = {} }) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const now = Date.now();
  const cutoff = new Date(now - cfg.salesWindowDays * 24 * 60 * 60 * 1000);

  const variants = await prisma.variant.findMany({
    where: { shop },
    include: {
      product: true,
      riskScore: true,
      inventoryLevels: true,
      salesDaily: { where: { date: { gte: cutoff } } },
    },
  });

  const tally = {
    HIGH_RISK: 0,
    NEEDS_ATTENTION: 0,
    HEALTHY: 0,
    NOT_ENOUGH_DATA: 0,
  };
  const newlyHighRisk = [];

  for (const variant of variants) {
    const prevBucket = variant.riskScore?.bucket ?? null;
    const tracked = variant.inventoryLevels.length > 0;
    const totalAvailable = variant.inventoryLevels.reduce(
      (sum, il) => sum + il.available,
      0,
    );
    const unitsInWindow = variant.salesDaily.reduce(
      (sum, sd) => sum + sd.unitsSold,
      0,
    );
    const avgDailyVelocity = unitsInWindow / cfg.salesWindowDays;
    const daysSinceCreated = variant.shopifyCreatedAt
      ? Math.floor(
          (now - new Date(variant.shopifyCreatedAt).getTime()) /
            (24 * 60 * 60 * 1000),
        )
      : null;

    const { bucket, score, reasons } = scoreVariant(
      { tracked, totalAvailable, avgDailyVelocity, daysSinceCreated },
      cfg,
    );
    tally[bucket] += 1;

    // Fired only on the transition into high risk, not every sync.
    if (bucket === "HIGH_RISK" && prevBucket !== "HIGH_RISK") {
      newlyHighRisk.push({
        productTitle: variant.product?.title ?? "Unknown product",
        variantTitle: variant.title ?? null,
        sku: variant.sku ?? null,
        reason: reasons[0] ?? "",
      });
    }

    await prisma.riskScore.upsert({
      where: { variantId: variant.id },
      create: {
        shop,
        variantId: variant.id,
        bucket,
        score,
        reasons: JSON.stringify(reasons),
      },
      update: {
        bucket,
        score,
        reasons: JSON.stringify(reasons),
        computedAt: new Date(),
      },
    });
  }

  return { tally, newlyHighRisk };
}
