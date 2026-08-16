# Progress Tracker — Inventory Risk Monitor

Living checklist of what's done vs pending. Update the boxes as work completes.
Full phase details live in [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md).

**Legend:** ✅ done · 🟡 partial · ⬜ not started
**Last updated:** 2026-08-16

---

## Phase 0 — Get it running ✅ (mostly)

- ✅ Shopify CLI + `shopify app dev` working
- ✅ App installed on dev store (`sonukumar-com.myshopify.com`), OAuth + embedded load OK
- ✅ Dev store has sample products + inventory
- ⬜ Replace `https://example.com` placeholder `application_url` / `redirect_urls` in `shopify.app.toml` — **only needed for production** (dev auto-tunnels via `automatically_update_urls_on_dev`)

## Phase 1 — Data model ✅ (SQLite) / 🟡 (Postgres pending)

- ✅ Multi-tenant schema: `Shop`, `Location`, `Product`, `Variant`, `InventoryLevel`, `SalesDaily`, `RiskScore`, `WebhookEvent`, `SyncState` — all `shop`-scoped
- ✅ Migration created + applied (SQLite)
- ⬜ Switch datasource SQLite → **PostgreSQL** (`provider` + `DATABASE_URL`) — deferred to production
- ⬜ Provision local/prod Postgres

## Phase 2 — Scopes & webhooks 🟡

- ✅ Read scopes added: `read_products, read_inventory, read_locations, read_orders`
- ⬜ Webhook subscriptions in `shopify.app.toml`: `products/create|update|delete`, `inventory_levels/update`, `orders/create`
- ⬜ Webhook route handlers (`app/routes/webhooks.*`): HMAC verify → record in `WebhookEvent` (dedup) → enqueue job (no inline processing)

## Phase 3 — Background processing 🟡 (foundation done)

- ✅ Redis running + BullMQ + ioredis installed
- ✅ Queue + in-process Worker (`app/jobs/queue.server.js`), hot-reload-safe singletons
- ✅ `full-sync` job = paginated GraphQL sync + risk scoring
- ✅ Dedup (one sync per shop via `SyncState`) + retries (3× exponential backoff)
- ✅ "Sync now" enqueues + UI polls status live (queued → running → done)
- ✅ `rollup-sales` — orders → `SalesDaily` velocity (runs inside `full-sync`)
- ⬜ `incremental-sync` job — apply webhook deltas (needs **Phase 2 webhooks**)
- ⬜ Standalone `score` job (currently only runs inside `full-sync`)
- ⬜ Rate-limit handling — read `throttleStatus`, dynamic backoff + retry w/ jitter (currently only reduced query cost)
- ⬜ Scheduled/repeatable jobs — daily score + sales rollup per shop
- ⬜ (Scale) Bulk Operations API for large catalogs instead of paginated queries
- ⬜ (Prod) Extract Worker to a dedicated process/container

## Phase 4 — Risk engine (proprietary core) ✅

- ✅ **Orders sync** → `SalesDaily` (sales velocity source)
- ✅ Pure, isolated engine `app/services/risk-engine.js` (no I/O — testable)
- ✅ v1 signals: days-of-cover (stock-out risk), out-of-stock-while-selling, dead stock, overstock, low-data guard
- ✅ Every flag carries a human-readable reason + a 0–100 score for ranking
- ✅ Tunable thresholds via config (lead time, low-cover, overstock, new-product)
- ✅ Unit tests (`risk-engine.test.js`, `npm test`) — 11 passing
- ⬜ (later) per-merchant configurable thresholds in Settings UI

## Phase 5 — UI (Polaris, embedded) ✅

- ✅ Dashboard: bucket stat cards + prioritized flagged table (all Polaris, validated)
- ✅ Bucket **filters** (Flagged / High risk / Needs attention / Healthy / Not enough data / All)
- ✅ **Detail page** (`/app/variants/:id`): why-flagged reasons, signals table, stock by location, sales-in-window, "Edit in Admin" (App Bridge intent)
- ✅ Empty / loading / ⚪ not-enough-data states
- ⬜ (later) search by product title/SKU, sort controls

## Phase 6 — Notifications ✅ (Slack + Teams)

- ✅ Per-shop notification settings (`Shop.settings` JSON) + Settings page
- ✅ **Slack + Microsoft Teams** — paste any incoming webhook URL, provider auto-detected; "Send test" button
- ✅ Alert only on **transition into high-risk** (not every sync — no spam)
- ✅ SSRF guard (only hooks.slack.com / office.com / logic.azure.com hosts)
- ✅ Sent from the background job; never fails the sync if the channel is down
- ⬜ (later) email channel, per-bucket / frequency preferences, mute
- ⚠️ Teams webhooks need a work/school (org) tenant — personal "Communities" don't support them; Slack works on any account

## Phase 7 — Multi-tenancy, security & reliability 🟡

- ✅ **Isolation test** — proves recompute/queries touch only the target shop (`tenant.test.js`)
- ✅ **Uninstall data purge** — `app/uninstalled` deletes every tenant-scoped row (also = GDPR shop redact)
- ✅ **Webhook idempotency** — `recordWebhookOnce` dedups redelivered webhooks
- ✅ **Health check** route `/healthz` (process + DB ping) for uptime monitors
- ✅ Every DB query is `shop`-scoped (audited); `session.shop` comes from the verified session
- ⬜ Structured logging / error monitoring (currently console)
- ⬜ Load-test large catalog (10k–100k products) + bulk operations
- ⬜ GDPR customer webhooks (`customers/data_request`, `customers/redact`) → App Store (Phase 9)

## Phase 8 — Billing ✅

- ✅ Shopify **Billing API** — recurring "Pro" plan ($9.99/mo, 7-day free trial), test charges in dev
- ✅ **Billing page** (`/app/billing`): status, start-trial (subscribe), cancel
- ✅ `checkAndPersistPlan` writes `Shop.plan`; `isPro(shop)` used by the job (no API call)
- ✅ **Freemium gate**: automated Slack/Teams alerts require Pro (test alert stays free)
- ⬜ (later) `app_subscriptions/update` webhook to keep plan fresh; usage-based billing

---

## Cross-cutting / not yet started
- ⬜ App Store launch (9)

## Recommended next order

1. **Phase 2 webhooks** + `incremental-sync` → auto-fresh data (no manual "Sync now")
2. **Scheduled daily job** + rate-limit backoff → finishes Phase 3
3. Postgres switch (Phase 1) before any real deployment
4. **Phase 9** App Store prep (GDPR webhooks, listing, review)
