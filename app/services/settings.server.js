import prisma from "../db.server";

// Per-shop settings live as a JSON string on Shop.settings. Shape:
//   { teams: { enabled: boolean, webhookUrl: string } }

export async function getShopSettings(shop) {
  const row = await prisma.shop.findUnique({ where: { shop } });
  if (!row?.settings) return {};
  try {
    return JSON.parse(row.settings);
  } catch {
    return {};
  }
}

export async function saveShopSettings(shop, settings) {
  await prisma.shop.upsert({
    where: { shop },
    create: { shop, settings: JSON.stringify(settings) },
    update: { settings: JSON.stringify(settings) },
  });
  return settings;
}
