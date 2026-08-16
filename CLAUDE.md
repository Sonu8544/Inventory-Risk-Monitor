@AGENTS.md

# Inventory Risk Monitor — Product Vision

A multi-tenant Shopify SaaS app that turns a store's own commerce data into
**actionable inventory decisions**. Instead of yet another analytics dashboard,
the product answers one question:

> "What inventory should I look at right now — and why?"

## Core concept

Analyze signals from the connected Shopify store and classify inventory into
risk buckets, always with a human-readable reason for the flag (never just a
red/green dot):

- 🔴 **High-risk inventory**
- 🟠 **Needs attention**
- 🟢 **Healthy / moving well**
- ⚪ **Not enough data** to make a reliable decision

The differentiator is NOT connecting to Shopify — it's the **decision/scoring
engine** built on top of the data. That logic is the proprietary core of the
product and should be treated as the highest-value part of the codebase.

## Target tech stack (goal state)

Shopify Admin GraphQL API · Shopify Webhooks · React · Shopify Polaris ·
Node.js · PostgreSQL · Prisma · Redis · background/async job processing ·
automated notifications. Multi-tenant SaaS with **per-store data isolation**.

## Current repo vs. goal (IMPORTANT — there is a gap)

The repo today is still the **stock Shopify React Router template** — none of the
inventory-risk functionality exists yet. Known differences to reconcile:

| Area | Goal | Repo today |
|------|------|-----------|
| Framework | React + Node | React Router 7 (Shopify template) |
| Database | PostgreSQL | SQLite (`prisma/schema.prisma`) |
| Redis / async jobs | Yes | Not present |
| Risk/scoring engine | Core feature | Not built (only a demo `productCreate` action in `app/routes/app._index.jsx`) |
| Access scopes | Inventory/products **read** | `write_products, write_metaobjects, write_metaobject_definitions` only |
| Webhooks | inventory/product updates | only `app/uninstalled`, `app/scopes_update` |

When building features, prefer extending the existing React Router + Prisma
setup unless there's a deliberate decision to migrate. Add read scopes and
inventory/product webhooks before wiring the risk engine.

## Roadmap (product experiment, not just a portfolio project)

Problem → MVP → real merchant feedback → iteration → monetization → scale.
Next stages: real merchant validation, improve the decision engine, more
actionable recommendations, AI-assisted insights (only where it adds real
business value), Shopify App Store launch.
