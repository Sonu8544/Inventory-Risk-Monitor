import { authenticate } from "../shopify.server";

// GDPR customers/data_request. We store NO customer PII (only aggregated
// per-variant daily sales counts), so there is no customer data to return.
export const action = async ({ request }) => {
  await authenticate.webhook(request);
  return new Response();
};
