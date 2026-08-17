import { authenticate } from "../shopify.server";

// GDPR customers/redact. We store NO customer PII, so nothing to delete.
export const action = async ({ request }) => {
  await authenticate.webhook(request);
  return new Response();
};
