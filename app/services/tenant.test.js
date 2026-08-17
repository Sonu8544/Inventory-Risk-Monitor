import { describe, it, expect, beforeAll, afterAll } from "vitest";
import prisma from "../db.server";
import { recomputeRisk } from "./risk.server";
import { purgeShopData } from "./tenant.server";

// Integration test: proves tenant isolation against the real Prisma layer.
// Uses namespaced test shops in the dev DB and cleans them up, so it never
// touches real store data — which is itself the property under test.

// DB-backed integration test — needs a reachable Postgres (DATABASE_URL).
// Skipped automatically when it isn't set (e.g. local without a DB).
// eslint-disable-next-line no-undef
const hasDb = Boolean(process.env.DATABASE_URL);

const SHOP_A = "test-tenant-a.myshopify.com";
const SHOP_B = "test-tenant-b.myshopify.com";

async function seedVariant(shop, { available, unitsSold }) {
  await prisma.shop.upsert({ where: { shop }, create: { shop }, update: {} });
  const product = await prisma.product.create({
    data: { shop, shopifyProductId: `gid://p/${shop}`, title: `${shop} product` },
  });
  const variant = await prisma.variant.create({
    data: {
      shop,
      shopifyVariantId: `gid://v/${shop}`,
      productId: product.id,
      title: "Default Title",
    },
  });
  await prisma.inventoryLevel.create({
    data: { shop, variantId: variant.id, locationId: "loc-1", available },
  });
  await prisma.salesDaily.create({
    data: { shop, variantId: variant.id, date: new Date(), unitsSold },
  });
  return variant;
}

beforeAll(async () => {
  if (!hasDb) return;
  await purgeShopData(SHOP_A);
  await purgeShopData(SHOP_B);
});

afterAll(async () => {
  if (!hasDb) return;
  await purgeShopData(SHOP_A);
  await purgeShopData(SHOP_B);
  await prisma.$disconnect();
});

describe.skipIf(!hasDb)("multi-tenant isolation", () => {
  it("recomputeRisk scores ONLY the target shop, never the other tenant", async () => {
    await seedVariant(SHOP_A, { available: 0, unitsSold: 60 }); // out of stock, selling
    await seedVariant(SHOP_B, { available: 50, unitsSold: 60 }); // healthy

    const { tally } = await recomputeRisk({ shop: SHOP_A });

    // Only A's single variant was scored.
    expect(tally.HIGH_RISK).toBe(1);

    const aScores = await prisma.riskScore.findMany({ where: { shop: SHOP_A } });
    const bScores = await prisma.riskScore.findMany({ where: { shop: SHOP_B } });
    expect(aScores).toHaveLength(1);
    expect(bScores).toHaveLength(0); // B was never touched
  });

  it("purgeShopData deletes only the target shop's data", async () => {
    await recomputeRisk({ shop: SHOP_B }); // give B some scores too

    await purgeShopData(SHOP_A);

    const aVariants = await prisma.variant.count({ where: { shop: SHOP_A } });
    const bVariants = await prisma.variant.count({ where: { shop: SHOP_B } });
    expect(aVariants).toBe(0); // A fully purged
    expect(bVariants).toBeGreaterThan(0); // B untouched
  });
});
