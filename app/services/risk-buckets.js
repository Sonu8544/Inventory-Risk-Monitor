// Client-safe risk constants (NO ".server" suffix) so both the server-side
// engine and the React component can import them. Keep this file free of any
// server-only code (no prisma, no node APIs).

export const BUCKET = {
  HIGH_RISK: "HIGH_RISK",
  NEEDS_ATTENTION: "NEEDS_ATTENTION",
  HEALTHY: "HEALTHY",
  NOT_ENOUGH_DATA: "NOT_ENOUGH_DATA",
};

// `tone` maps each bucket to a Polaris badge tone (Shopify's semantic colors).
export const BUCKET_META = {
  HIGH_RISK: { emoji: "🔴", label: "High risk", tone: "critical" },
  NEEDS_ATTENTION: { emoji: "🟠", label: "Needs attention", tone: "warning" },
  HEALTHY: { emoji: "🟢", label: "Healthy", tone: "success" },
  NOT_ENOUGH_DATA: { emoji: "⚪", label: "Not enough data", tone: "info" },
};

export const BUCKET_ORDER = [
  BUCKET.HIGH_RISK,
  BUCKET.NEEDS_ATTENTION,
  BUCKET.HEALTHY,
  BUCKET.NOT_ENOUGH_DATA,
];
