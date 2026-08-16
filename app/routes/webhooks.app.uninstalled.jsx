import { authenticate } from "../shopify.server";
import { purgeShopData, recordWebhookOnce } from "../services/tenant.server";

export const action = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);
  const eventId = request.headers.get("x-shopify-webhook-id");

  console.log(`Received ${topic} webhook for ${shop}`);

  // Shopify can redeliver webhooks; process each unique delivery once.
  const fresh = await recordWebhookOnce({ shop, topic, eventId });
  if (!fresh) return new Response();

  // Remove every tenant-scoped row for this shop (sessions included).
  await purgeShopData(shop);

  return new Response();
};
