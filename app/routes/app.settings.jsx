import { Form, useActionData, useLoaderData, useNavigation, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getShopSettings, saveShopSettings } from "../services/settings.server";
import { sendTestAlert } from "../services/notify.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const settings = await getShopSettings(session.shop);
  return {
    webhookUrl: settings.notify?.webhookUrl ?? "",
    enabled: Boolean(settings.notify?.enabled),
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const fd = await request.formData();
  const intent = fd.get("intent");
  const settings = await getShopSettings(shop);

  if (intent === "save") {
    const webhookUrl = String(fd.get("webhookUrl") || "").trim();
    const enabled = ["true", "on"].includes(String(fd.get("enabled")));
    settings.notify = { ...(settings.notify ?? {}), webhookUrl, enabled };
    await saveShopSettings(shop, settings);
    return { ok: true, message: "Settings saved." };
  }

  if (intent === "test") {
    try {
      if (!settings.notify?.webhookUrl) {
        return { ok: false, message: "Save a webhook URL first." };
      }
      await sendTestAlert({ webhookUrl: settings.notify.webhookUrl, shop });
      return { ok: true, message: "Test alert sent — check your Teams channel." };
    } catch (error) {
      return { ok: false, message: String(error?.message ?? error) };
    }
  }

  return { ok: false, message: "Unknown action." };
};

export default function Settings() {
  const { webhookUrl, enabled } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  return (
    <s-page heading="Settings">
      {actionData && (
        <s-banner
          heading={actionData.ok ? "Success" : "Something went wrong"}
          tone={actionData.ok ? "success" : "critical"}
        >
          <s-paragraph>{actionData.message}</s-paragraph>
        </s-banner>
      )}

      <s-section heading="Alert notifications (Slack or Teams)">
        <s-paragraph>
          Get an alert in Slack or Microsoft Teams whenever a product turns{" "}
          <s-text type="strong">high-risk</s-text>. Paste your incoming webhook
          URL below — the channel is detected automatically.
        </s-paragraph>

        <Form method="post">
          <input type="hidden" name="intent" value="save" />
          <s-stack direction="block" gap="base">
            <s-text-field
              label="Webhook URL"
              name="webhookUrl"
              value={webhookUrl}
              placeholder="https://hooks.slack.com/… or …logic.azure.com/…"
            />
            <s-switch
              label="Enable alerts"
              name="enabled"
              value="true"
              {...(enabled ? { checked: true } : {})}
            />
            <s-button
              type="submit"
              variant="primary"
              {...(busy ? { loading: true } : {})}
            >
              Save
            </s-button>
          </s-stack>
        </Form>

        <Form method="post">
          <input type="hidden" name="intent" value="test" />
          <s-button type="submit" variant="secondary">
            Send test alert
          </s-button>
        </Form>
      </s-section>

      <s-section slot="aside" heading="How to get a Slack webhook">
        <s-ordered-list>
          <s-list-item>
            Go to api.slack.com/apps → Create New App → From scratch.
          </s-list-item>
          <s-list-item>
            Enable “Incoming Webhooks”, then “Add New Webhook to Workspace”.
          </s-list-item>
          <s-list-item>Pick a channel, copy the URL, paste it here.</s-list-item>
        </s-ordered-list>
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
