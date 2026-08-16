import { BUCKET } from "./risk-buckets";

// -----------------------------------------------------------------------------
// The scoring engine (proprietary core — see CLAUDE.md).
//
// This file is PURE: no prisma, no I/O, no Shopify. It maps a variant's current
// stock + sales velocity to a risk bucket + score + human-readable reasons, so
// it can be unit-tested exhaustively (risk.test.js) and tuned without touching
// sync or UI code. `risk.server.js` feeds it data from the database.
//
// v1 signals:
//   - days of cover = on-hand / avg daily velocity   → stock-out risk
//   - out of stock while still selling               → lost sales (highest)
//   - dead stock: units on hand but ~no recent sales
//   - overstock: very high days of cover
//   - low-data guard: new products / no tracking → NOT_ENOUGH_DATA
//
// Thresholds live in config (not hard-coded in branches) — this is the knob set
// that will become per-merchant tunable later.
// -----------------------------------------------------------------------------

export const DEFAULT_CONFIG = {
  salesWindowDays: 60, // window used to measure velocity
  leadTimeDays: 7, // time to restock; cover below this = high risk
  lowCoverDays: 14, // cover below this = needs attention
  overstockDays: 90, // cover above this = overstocked
  newProductDays: 14, // younger than this + no sales = not enough data
};

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * @param {{
 *   tracked: boolean,
 *   totalAvailable: number,
 *   avgDailyVelocity: number,   // units/day over the sales window
 *   daysSinceCreated: number|null,
 * }} input
 * @param {typeof DEFAULT_CONFIG} [config]
 * @returns {{ bucket: string, score: number, reasons: string[] }}
 */
export function scoreVariant(input, config = DEFAULT_CONFIG) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const { tracked, totalAvailable, avgDailyVelocity, daysSinceCreated } = input;
  const v = avgDailyVelocity || 0;

  if (!tracked) {
    return {
      bucket: BUCKET.NOT_ENOUGH_DATA,
      score: 0,
      reasons: ["No inventory tracking data for this variant"],
    };
  }

  // No recent sales — can't measure velocity.
  if (v <= 0) {
    if (daysSinceCreated != null && daysSinceCreated < cfg.newProductDays) {
      return {
        bucket: BUCKET.NOT_ENOUGH_DATA,
        score: 0,
        reasons: [
          `New product (added ${daysSinceCreated} day(s) ago) — not enough sales history yet`,
        ],
      };
    }
    if (totalAvailable > 0) {
      return {
        bucket: BUCKET.NEEDS_ATTENTION,
        score: 55,
        reasons: [
          `No sales in the last ${cfg.salesWindowDays} days but ${totalAvailable} unit(s) in stock — possible dead stock`,
        ],
      };
    }
    return {
      bucket: BUCKET.NOT_ENOUGH_DATA,
      score: 0,
      reasons: ["No stock and no recent sales"],
    };
  }

  // We have velocity — reason about days of cover.
  const doc = totalAvailable / v;

  if (totalAvailable <= 0) {
    return {
      bucket: BUCKET.HIGH_RISK,
      score: 100,
      reasons: [`Out of stock while selling ~${round1(v)}/day — losing sales`],
    };
  }

  if (doc < cfg.leadTimeDays) {
    // Closer to zero cover = higher score within the high-risk band.
    const score = 85 + ((cfg.leadTimeDays - doc) / cfg.leadTimeDays) * 15;
    return {
      bucket: BUCKET.HIGH_RISK,
      score: Math.round(score),
      reasons: [
        `Only ~${round1(doc)} days of cover at ~${round1(v)}/day; restock takes ~${cfg.leadTimeDays} days — will stock out first`,
      ],
    };
  }

  if (doc < cfg.lowCoverDays) {
    return {
      bucket: BUCKET.NEEDS_ATTENTION,
      score: 65,
      reasons: [
        `Running low: ~${round1(doc)} days of cover at ~${round1(v)}/day`,
      ],
    };
  }

  if (doc > cfg.overstockDays) {
    return {
      bucket: BUCKET.NEEDS_ATTENTION,
      score: 50,
      reasons: [
        `Overstocked: ~${Math.round(doc)} days of cover (${totalAvailable} units) — capital tied up`,
      ],
    };
  }

  return {
    bucket: BUCKET.HEALTHY,
    score: 10,
    reasons: [`Healthy: ~${round1(doc)} days of cover at ~${round1(v)}/day`],
  };
}
