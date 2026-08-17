import { authenticate, PRO_PLAN } from "../shopify.server";
import prisma from "../db.server";
import { recordWebhookOnce } from "../services/tenant.server";

// app_subscriptions/update → keep Shop.plan in sync with the billing status,
// so the background job's Pro gate stays fresh without polling Shopify.
export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const eventId = request.headers.get("x-shopify-webhook-id");

  const fresh = await recordWebhookOnce({ shop, topic, eventId });
  if (fresh) {
    const status = payload?.app_subscription?.status;
    const active = status === "ACTIVE";
    await prisma.shop.upsert({
      where: { shop },
      create: { shop, plan: active ? PRO_PLAN : null },
      update: { plan: active ? PRO_PLAN : null },
    });
  }

  return new Response();
};
