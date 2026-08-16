import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
  useRouteError,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate, PRO_PLAN } from "../shopify.server";
import prisma from "../db.server";
import { checkAndPersistPlan, BILLING_IS_TEST } from "../services/billing.server";

const PRICE = "9.99";
const TRIAL_DAYS = 7;

export const loader = async ({ request }) => {
  const { billing, session } = await authenticate.admin(request);
  const { subscribed, subscription } = await checkAndPersistPlan({
    billing,
    shop: session.shop,
  });
  return {
    subscribed,
    subscription: subscription
      ? { id: subscription.id, name: subscription.name, status: subscription.status }
      : null,
  };
};

export const action = async ({ request }) => {
  const { billing, session } = await authenticate.admin(request);
  const intent = (await request.formData()).get("intent");

  if (intent === "subscribe") {
    const returnUrl = new URL("/app/billing", request.url).toString();
    try {
      // On success this THROWS a redirect Response to Shopify's confirmation page.
      await billing.request({ plan: PRO_PLAN, isTest: BILLING_IS_TEST, returnUrl });
      return null;
    } catch (error) {
      if (error instanceof Response) throw error; // the success redirect
      const detail = error?.errorData
        ? JSON.stringify(error.errorData)
        : String(error?.message ?? error);
      return { ok: false, message: `Billing failed: ${detail}` };
    }
  }

  if (intent === "cancel") {
    const { appSubscriptions } = await billing.check({
      plans: [PRO_PLAN],
      isTest: BILLING_IS_TEST,
    });
    const sub = appSubscriptions?.[0];
    if (sub) {
      await billing.cancel({
        subscriptionId: sub.id,
        isTest: BILLING_IS_TEST,
        prorate: true,
      });
      await prisma.shop.update({
        where: { shop: session.shop },
        data: { plan: null },
      });
    }
    return { ok: true, message: "Subscription cancelled." };
  }

  return null;
};

export default function Billing() {
  const { subscribed, subscription } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  return (
    <s-page heading="Billing">
      {actionData?.message && (
        <s-banner
          heading={actionData.ok ? "Done" : "Billing error"}
          tone={actionData.ok ? "success" : "critical"}
        >
          <s-paragraph>{actionData.message}</s-paragraph>
        </s-banner>
      )}

      <s-section heading="Plan">
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-text type="strong">Pro — ${PRICE}/month</s-text>
            <s-badge tone={subscribed ? "success" : "neutral"}>
              {subscribed ? `Active${subscription?.status ? ` (${subscription.status})` : ""}` : "Not subscribed"}
            </s-badge>
          </s-stack>
          <s-paragraph color="subdued">
            Includes a {TRIAL_DAYS}-day free trial. Unlocks automated Slack /
            Teams high-risk alerts.
          </s-paragraph>

          {!subscribed && (
            <Form method="post">
              <input type="hidden" name="intent" value="subscribe" />
              <s-button
                type="submit"
                variant="primary"
                {...(busy ? { loading: true } : {})}
              >
                Start {TRIAL_DAYS}-day free trial
              </s-button>
            </Form>
          )}

          {subscribed && (
            <Form method="post">
              <input type="hidden" name="intent" value="cancel" />
              <s-button
                type="submit"
                variant="secondary"
                {...(busy ? { loading: true } : {})}
              >
                Cancel subscription
              </s-button>
            </Form>
          )}
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Pro features">
        <s-unordered-list>
          <s-list-item>Automated Slack / Teams high-risk alerts</s-list-item>
          <s-list-item>Priority support</s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
