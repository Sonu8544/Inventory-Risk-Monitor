import { describe, it, expect } from "vitest";
import { scoreVariant, DEFAULT_CONFIG } from "./risk-engine";
import { BUCKET } from "./risk-buckets";

// The engine is the proprietary core, so it gets the most thorough tests.
// Defaults: leadTime 7d, lowCover 14d, overstock 90d, newProduct 14d, window 60d.

describe("scoreVariant — low-data guard", () => {
  it("is NOT_ENOUGH_DATA when inventory isn't tracked", () => {
    const r = scoreVariant({
      tracked: false,
      totalAvailable: 0,
      avgDailyVelocity: 0,
      daysSinceCreated: 200,
    });
    expect(r.bucket).toBe(BUCKET.NOT_ENOUGH_DATA);
  });

  it("is NOT_ENOUGH_DATA for a brand-new product with no sales", () => {
    const r = scoreVariant({
      tracked: true,
      totalAvailable: 50,
      avgDailyVelocity: 0,
      daysSinceCreated: 5,
    });
    expect(r.bucket).toBe(BUCKET.NOT_ENOUGH_DATA);
  });

  it("is NOT_ENOUGH_DATA when there is no stock and no sales", () => {
    const r = scoreVariant({
      tracked: true,
      totalAvailable: 0,
      avgDailyVelocity: 0,
      daysSinceCreated: 200,
    });
    expect(r.bucket).toBe(BUCKET.NOT_ENOUGH_DATA);
  });
});

describe("scoreVariant — dead stock", () => {
  it("flags stock with no recent sales (old enough) as NEEDS_ATTENTION", () => {
    const r = scoreVariant({
      tracked: true,
      totalAvailable: 40,
      avgDailyVelocity: 0,
      daysSinceCreated: 120,
    });
    expect(r.bucket).toBe(BUCKET.NEEDS_ATTENTION);
    expect(r.reasons[0]).toMatch(/dead stock/i);
  });
});

describe("scoreVariant — stock-out risk", () => {
  it("is HIGH_RISK and top score when out of stock while selling", () => {
    const r = scoreVariant({
      tracked: true,
      totalAvailable: 0,
      avgDailyVelocity: 3,
      daysSinceCreated: 200,
    });
    expect(r.bucket).toBe(BUCKET.HIGH_RISK);
    expect(r.score).toBe(100);
  });

  it("is HIGH_RISK when days of cover < lead time", () => {
    // 10 units / 2 per day = 5 days cover < 7 lead time
    const r = scoreVariant({
      tracked: true,
      totalAvailable: 10,
      avgDailyVelocity: 2,
      daysSinceCreated: 200,
    });
    expect(r.bucket).toBe(BUCKET.HIGH_RISK);
    expect(r.score).toBeGreaterThan(85);
    expect(r.score).toBeLessThan(100);
  });

  it("ranks lower cover as higher risk score", () => {
    const near = scoreVariant({
      tracked: true,
      totalAvailable: 2,
      avgDailyVelocity: 2,
      daysSinceCreated: 200,
    }); // 1 day cover
    const further = scoreVariant({
      tracked: true,
      totalAvailable: 12,
      avgDailyVelocity: 2,
      daysSinceCreated: 200,
    }); // 6 days cover
    expect(near.score).toBeGreaterThan(further.score);
  });
});

describe("scoreVariant — attention & healthy", () => {
  it("is NEEDS_ATTENTION when running low (cover between lead time and lowCover)", () => {
    // 20 / 2 = 10 days cover (between 7 and 14)
    const r = scoreVariant({
      tracked: true,
      totalAvailable: 20,
      avgDailyVelocity: 2,
      daysSinceCreated: 200,
    });
    expect(r.bucket).toBe(BUCKET.NEEDS_ATTENTION);
  });

  it("is NEEDS_ATTENTION when overstocked", () => {
    // 1000 / 2 = 500 days cover (> 90)
    const r = scoreVariant({
      tracked: true,
      totalAvailable: 1000,
      avgDailyVelocity: 2,
      daysSinceCreated: 200,
    });
    expect(r.bucket).toBe(BUCKET.NEEDS_ATTENTION);
    expect(r.reasons[0]).toMatch(/overstock/i);
  });

  it("is HEALTHY for comfortable cover", () => {
    // 100 / 2 = 50 days cover (between 14 and 90)
    const r = scoreVariant({
      tracked: true,
      totalAvailable: 100,
      avgDailyVelocity: 2,
      daysSinceCreated: 200,
    });
    expect(r.bucket).toBe(BUCKET.HEALTHY);
  });
});

describe("scoreVariant — config is respected", () => {
  it("honors a custom lead time", () => {
    // 20 days cover; with leadTime 30 this becomes HIGH_RISK
    const r = scoreVariant(
      {
        tracked: true,
        totalAvailable: 20,
        avgDailyVelocity: 1,
        daysSinceCreated: 200,
      },
      { ...DEFAULT_CONFIG, leadTimeDays: 30, lowCoverDays: 40 },
    );
    expect(r.bucket).toBe(BUCKET.HIGH_RISK);
  });
});
