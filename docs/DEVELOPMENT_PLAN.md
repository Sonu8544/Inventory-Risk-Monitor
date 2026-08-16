# Inventory Risk Monitor — Development Plan

Step-by-step roadmap from the current stock template to a production, multi-tenant
Shopify SaaS. See `CLAUDE.md` for the product vision.

## Guiding decisions

- **Keep React Router 7 + Prisma** (the existing template). It already gives us a
  React frontend + Node server. A rewrite to raw Express/React is unnecessary risk.
- **Swap the datasource** SQLite → PostgreSQL (needed for multi-tenant + concurrency).
- **Add Redis + a job queue** (BullMQ) for sync and scoring, so webhooks stay fast.
- **The risk/scoring engine is the proprietary core** — build it as an isolated,
  well-tested module (`app/services/risk/`), easy to iterate without touching UI/IO.
- Ship an MVP first, then harden. Each phase should leave the app runnable.

---

## Phase 0 — Get it running (foundation)

Goal: install the app on a real dev store and see the template working.

1. Install Shopify CLI and run `shopify app dev`; press `P` to open + install on a dev store.
2. Confirm OAuth, embedded load, and the demo "Generate a product" action all work.
3. Create a Shopify **development store** with sample products + inventory (or import a dataset).
4. Set `application_url` / `redirect_urls` off the placeholder `https://example.com`
   once the tunnel URL is known (`shopify.app.toml`).

Exit criteria: app installs and loads inside Admin.

## Phase 1 — Data model & Postgres

Goal: multi-tenant schema that can hold a store's inventory snapshot + history.

1. In `prisma/schema.prisma`, change datasource `provider = "postgresql"`, `url = env("DATABASE_URL")`.
2. Add a local Postgres (Docker) + set `DATABASE_URL`.
3. Model the domain (all rows scoped by `shop` for tenant isolation):
   - `Shop` — installed store, plan, settings.
   - `Product` / `Variant` — mirror of Shopify product/variant + inventory levels per location.
   - `InventoryLevel` — variant × location available quantity.
   - `SalesDaily` — per-variant daily units sold (rollup used for velocity).
   - `RiskScore` — latest bucket + score + reasons per variant, with `computedAt`.
   - `WebhookEvent` — dedup log (topic + Shopify event id) for idempotency.
   - `SyncState` — per-shop cursor/last-sync bookkeeping.
4. `prisma migrate dev` to create tables. Keep the existing `Session` model.

Exit criteria: migrations apply on Postgres; schema supports the risk engine's inputs.

## Phase 2 — Scopes & webhooks

Goal: request the right data access and react to store changes.

1. In `shopify.app.toml`, update `scopes` to add reads:
   `read_products,read_inventory,read_locations,read_orders` (keep writes only if a
   feature needs them). Re-auth the app to apply.
2. Add webhook subscriptions (`shopify.app.toml`):
   - `products/create`, `products/update`, `products/delete`
   - `inventory_levels/update`
   - `orders/create` (drives sales velocity)
3. Add matching route handlers under `app/routes/webhooks.*` modeled on the existing
   `webhooks.app.uninstalled.jsx`. Each handler: verify HMAC (handled by the library),
   record in `WebhookEvent` for dedup, then enqueue a job (do NOT process inline).

Exit criteria: webhook payloads arrive, are deduped, and enqueue background work.

## Phase 3 — Background processing (Redis + queue)

Goal: keep requests/webhooks fast; do heavy work async.

1. Add Redis (Docker) + `DATABASE`/`REDIS_URL` env. Add BullMQ.
2. Create a worker process (`app/jobs/`) with queues:
   - `initial-sync` — full backfill of products/inventory/orders on install (paginated
     GraphQL with cursor + rate-limit backoff).
   - `incremental-sync` — apply webhook deltas.
   - `rollup-sales` — build `SalesDaily` from orders.
   - `score` — run the risk engine per variant/shop.
3. Handle Shopify **GraphQL rate limits** (cost-based throttling): read `throttleStatus`,
   back off, retry with jitter.
4. Schedule a daily `score` + `rollup-sales` run per shop (repeatable job).

Exit criteria: install triggers a full sync; ongoing webhooks update data; scoring runs on a schedule.

## Phase 4 — Risk engine (the core / proprietary)

Goal: turn raw data into a bucket + reasons per variant. Isolated & tested.

1. Build `app/services/risk/` as pure functions: `inputs -> { bucket, score, reasons[] }`.
2. Buckets: 🔴 high-risk · 🟠 needs attention · 🟢 healthy · ⚪ not enough data.
3. Candidate signals (final weights/thresholds are the private secret sauce — keep them
   configurable, not hard-coded in UI):
   - **Days of cover** = on-hand ÷ avg daily velocity (stockout risk when low).
   - **Overstock** = very high days-of-cover + declining velocity.
   - **Dead / stale stock** = inventory on hand but ~no sales in N days.
   - **Reorder-point breach** vs. lead time.
   - **Low-data guard** = new product / insufficient sales history → ⚪ bucket.
4. Every flag carries a human-readable **reason** ("12 days of cover, selling ~8/day,
   will stock out in ~4 days") — never a bare red/green.
5. Unit-test the engine hard with fixture datasets (this is the highest-value code).

Exit criteria: `RiskScore` rows populate with bucket + score + reasons; tests green.

## Phase 5 — UI (Polaris, embedded)

Goal: the "what should I look at right now?" experience.

1. Rebuild `app/routes/app._index.jsx` as the **dashboard**: counts per bucket, then a
   prioritized list (highest risk first) of flagged variants with their reason.
2. Filters: by bucket, by location, search. Sort by score.
3. Product/variant **detail page**: the signals behind the flag, velocity/cover trend,
   and a link to edit in Admin (App Bridge `intents.invoke`).
4. Empty/loading states, and a clear ⚪ "not enough data yet" experience during first sync.

Exit criteria: a merchant can open the app and immediately see what needs attention and why.

## Phase 6 — Notifications

Goal: bring merchants back when something needs action.

1. Detect bucket transitions (🟢/🟠 → 🔴) during scoring.
2. Send automated notifications (email to start; optionally Slack/Shopify Admin later).
3. Per-shop notification settings (thresholds, frequency, mute).

Exit criteria: a store owner is alerted when an item becomes high-risk.

## Phase 7 — Multi-tenancy, security & reliability hardening

1. Verify **every** DB query is scoped by `shop`; add tests that cross-tenant reads fail.
2. Idempotent webhooks (dedup already in Phase 2) + retry safety.
3. Handle `app/uninstalled` → purge/anonymize shop data; `scopes_update` → adjust sync.
4. Structured logging, error monitoring, health checks, per-shop sync status page.
5. Load-test the sync path against a large catalog (e.g. 100K products) — batching + backoff.

Exit criteria: clean install/uninstall/reinstall; no cross-tenant leakage; large catalogs sync.

## Phase 8 — Billing

1. Integrate Shopify **Billing API** (recurring app subscription, with a free trial).
2. Gate premium features/limits by plan; handle upgrade/downgrade/cancel.

Exit criteria: a merchant can subscribe and be billed through Shopify.

## Phase 9 — App Store launch

1. App listing: name, icon, screenshots, pricing, privacy policy, GDPR webhooks
   (`customers/data_request`, `customers/redact`, `shop/redact`).
2. Meet Shopify App Store review requirements; performance + Lighthouse checks.
3. Submit for review; iterate on feedback.

Exit criteria: app is live (or in review) on the Shopify App Store.

---

## Suggested MVP cut (fastest path to real feedback)

Phases 0–5 with a **narrow** risk engine (start with just **stockout risk via days-of-cover**
+ the ⚪ low-data guard). Skip overstock/dead-stock, notifications, and billing for v1.
Ship, get merchant feedback, then expand the engine.

## Milestone order (checklist)

- [ ] P0 App runs on a dev store
- [ ] P1 Postgres schema + migrations
- [ ] P2 Read scopes + webhooks enqueue jobs
- [ ] P3 Redis queue + initial/incremental sync + scheduled scoring
- [ ] P4 Risk engine (stockout MVP) + tests
- [ ] P5 Dashboard + detail UI
- [ ] --- MVP shippable here ---
- [ ] P6 Notifications
- [ ] P7 Hardening (tenancy/security/scale)
- [ ] P8 Billing
- [ ] P9 App Store launch
