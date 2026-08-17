import { authenticate } from "../shopify.server";
import { purgeShopData } from "../services/tenant.server";

// GDPR shop/redact — 48h after uninstall. Purge all data for the shop.
export const action = async ({ request }) => {
  const { shop } = await authenticate.webhook(request);
  await purgeShopData(shop);
  return new Response();
};
