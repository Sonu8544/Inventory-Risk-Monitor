import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { recordWebhookOnce } from "../services/tenant.server";

// products/delete → remove the product (variants/inventory/scores cascade).
export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const eventId = request.headers.get("x-shopify-webhook-id");

  const fresh = await recordWebhookOnce({ shop, topic, eventId });
  if (fresh) {
    const gid =
      payload?.admin_graphql_api_id ??
      (payload?.id ? `gid://shopify/Product/${payload.id}` : null);
    if (gid) {
      await prisma.product.deleteMany({
        where: { shop, shopifyProductId: gid },
      });
    }
  }

  return new Response();
};
