import prisma from "../db.server";

// Admin GraphQL query validated against the 2026-07 Admin schema.
// Pulls products + variants + inventory levels (per location) in one paginated pass.
//
// Page sizes are kept small so a single query stays under Shopify's cost limit
// (max 1000 points per query). Cost scales with first-values multiplied across
// nested connections, so we page products in small batches rather than fetching
// 50 at a time. We still paginate over ALL products via the cursor loop below.
const SYNC_PRODUCTS_QUERY = `#graphql
  query SyncProducts($cursor: String) {
    products(first: 20, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        title
        handle
        status
        productType
        vendor
        createdAt
        variants(first: 100) {
          nodes {
            id
            sku
            title
            price
            createdAt
            inventoryItem {
              inventoryLevels(first: 10) {
                nodes {
                  location { id name }
                  quantities(names: ["available"]) { name quantity }
                }
              }
            }
          }
        }
      }
    }
  }`;

function availableFromQuantities(quantities) {
  const q = (quantities || []).find((x) => x.name === "available");
  return q ? q.quantity : 0;
}

/**
 * Full backfill of a store's products, variants, locations and inventory levels
 * into our multi-tenant tables. Every write is scoped by `shop`.
 *
 * @param {{ admin: any, shop: string }} args
 * @returns {Promise<{products:number, variants:number, inventoryLevels:number}>}
 */
export async function syncInventory({ admin, shop }) {
  await prisma.shop.upsert({
    where: { shop },
    create: { shop },
    update: {},
  });

  await prisma.syncState.upsert({
    where: { shop_resource: { shop, resource: "products" } },
    create: { shop, resource: "products", status: "running" },
    update: { status: "running", error: null },
  });

  const counts = { products: 0, variants: 0, inventoryLevels: 0 };

  try {
    let cursor = null;
    let hasNextPage = true;

    while (hasNextPage) {
      const response = await admin.graphql(SYNC_PRODUCTS_QUERY, {
        variables: { cursor },
      });
      const body = await response.json();
      const conn = body?.data?.products;
      if (!conn) {
        throw new Error(
          `Unexpected products response: ${JSON.stringify(body?.errors ?? body)}`,
        );
      }

      for (const p of conn.nodes) {
        const product = await prisma.product.upsert({
          where: { shop_shopifyProductId: { shop, shopifyProductId: p.id } },
          create: {
            shop,
            shopifyProductId: p.id,
            title: p.title,
            handle: p.handle,
            status: p.status,
            productType: p.productType,
            vendor: p.vendor,
            shopifyCreatedAt: p.createdAt ? new Date(p.createdAt) : null,
          },
          update: {
            title: p.title,
            handle: p.handle,
            status: p.status,
            productType: p.productType,
            vendor: p.vendor,
          },
        });
        counts.products += 1;

        for (const v of p.variants.nodes) {
          const variant = await prisma.variant.upsert({
            where: {
              shop_shopifyVariantId: { shop, shopifyVariantId: v.id },
            },
            create: {
              shop,
              shopifyVariantId: v.id,
              productId: product.id,
              sku: v.sku,
              title: v.title,
              price: v.price ?? null,
              shopifyCreatedAt: v.createdAt ? new Date(v.createdAt) : null,
            },
            update: {
              productId: product.id,
              sku: v.sku,
              title: v.title,
              price: v.price ?? null,
            },
          });
          counts.variants += 1;

          const levels = v.inventoryItem?.inventoryLevels?.nodes ?? [];
          for (const level of levels) {
            const locationId = level.location.id;

            await prisma.location.upsert({
              where: {
                shop_shopifyLocationId: { shop, shopifyLocationId: locationId },
              },
              create: {
                shop,
                shopifyLocationId: locationId,
                name: level.location.name,
              },
              update: { name: level.location.name },
            });

            await prisma.inventoryLevel.upsert({
              where: {
                shop_variantId_locationId: {
                  shop,
                  variantId: variant.id,
                  locationId,
                },
              },
              create: {
                shop,
                variantId: variant.id,
                locationId,
                available: availableFromQuantities(level.quantities),
              },
              update: {
                available: availableFromQuantities(level.quantities),
              },
            });
            counts.inventoryLevels += 1;
          }
        }
      }

      hasNextPage = conn.pageInfo.hasNextPage;
      cursor = conn.pageInfo.endCursor;
    }

    await prisma.syncState.update({
      where: { shop_resource: { shop, resource: "products" } },
      data: { status: "done", lastSyncedAt: new Date(), cursor: null },
    });
  } catch (error) {
    await prisma.syncState.update({
      where: { shop_resource: { shop, resource: "products" } },
      data: { status: "error", error: String(error?.message ?? error) },
    });
    throw error;
  }

  return counts;
}

// Admin GraphQL query for orders + line items (validated against 2026-07).
const SYNC_ORDERS_QUERY = `#graphql
  query SyncOrders($cursor: String, $query: String) {
    orders(first: 20, after: $cursor, query: $query, sortKey: CREATED_AT) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        createdAt
        lineItems(first: 100) {
          nodes {
            quantity
            variant { id }
          }
        }
      }
    }
  }`;

// Truncate an ISO timestamp to a UTC midnight Date (the day bucket).
function dayKeyUTC(iso) {
  const d = new Date(iso);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Roll up recent order line items into per-variant daily unit sales
 * (`SalesDaily`), which drives sales velocity for the risk engine. Idempotent:
 * re-aggregates the whole window and replaces SalesDaily rows within it, so
 * repeated syncs never double-count.
 *
 * @param {{ admin: any, shop: string, windowDays?: number }} args
 * @returns {Promise<{orders:number, salesRows:number}>}
 */
export async function syncSales({ admin, shop, windowDays = 60 }) {
  await prisma.syncState.upsert({
    where: { shop_resource: { shop, resource: "orders" } },
    create: { shop, resource: "orders", status: "running" },
    update: { status: "running", error: null },
  });

  try {
    // Orders reference variants by Shopify gid; map those to our Variant.id.
    const variants = await prisma.variant.findMany({
      where: { shop },
      select: { id: true, shopifyVariantId: true },
    });
    const variantIdByGid = new Map(
      variants.map((v) => [v.shopifyVariantId, v.id]),
    );

    const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    const cutoffDay = dayKeyUTC(cutoff.toISOString());
    const queryFilter = `created_at:>=${cutoff.toISOString()}`;

    const agg = new Map(); // `${variantId}|${dayISO}` -> unitsSold
    let orderCount = 0;
    let cursor = null;
    let hasNextPage = true;

    while (hasNextPage) {
      const response = await admin.graphql(SYNC_ORDERS_QUERY, {
        variables: { cursor, query: queryFilter },
      });
      const body = await response.json();
      const conn = body?.data?.orders;
      if (!conn) {
        throw new Error(
          `Unexpected orders response: ${JSON.stringify(body?.errors ?? body)}`,
        );
      }

      for (const order of conn.nodes) {
        orderCount += 1;
        const dayISO = dayKeyUTC(order.createdAt).toISOString();
        for (const li of order.lineItems.nodes) {
          const gid = li.variant?.id;
          if (!gid) continue;
          const variantId = variantIdByGid.get(gid);
          if (!variantId) continue; // line item for a variant we don't track
          const key = `${variantId}|${dayISO}`;
          agg.set(key, (agg.get(key) ?? 0) + (li.quantity ?? 0));
        }
      }

      hasNextPage = conn.pageInfo.hasNextPage;
      cursor = conn.pageInfo.endCursor;
    }

    const rows = [];
    for (const [key, unitsSold] of agg.entries()) {
      const [variantId, dayISO] = key.split("|");
      rows.push({ shop, variantId, date: new Date(dayISO), unitsSold });
    }

    // Idempotent replace: clear the window, then insert the fresh aggregates.
    await prisma.$transaction([
      prisma.salesDaily.deleteMany({
        where: { shop, date: { gte: cutoffDay } },
      }),
      ...(rows.length ? [prisma.salesDaily.createMany({ data: rows })] : []),
    ]);

    await prisma.syncState.update({
      where: { shop_resource: { shop, resource: "orders" } },
      data: { status: "done", lastSyncedAt: new Date(), cursor: null },
    });

    return { orders: orderCount, salesRows: rows.length };
  } catch (error) {
    await prisma.syncState.update({
      where: { shop_resource: { shop, resource: "orders" } },
      data: { status: "error", error: String(error?.message ?? error) },
    });
    throw error;
  }
}
