// Outbound alerts via an incoming-webhook URL. Supports BOTH Microsoft Teams
// (Adaptive Card) and Slack (text payload) — the provider is auto-detected from
// the URL host, so the merchant just pastes whichever they use.
//
// Light SSRF guard: we only POST to known webhook hosts, since the URL is
// merchant-supplied and we call it from the server.

function providerFor(hostname) {
  if (hostname === "hooks.slack.com") return "slack";
  if (
    hostname.endsWith(".webhook.office.com") || // legacy O365 connector
    hostname.endsWith(".logic.azure.com") || // Power Automate "Workflows"
    hostname.endsWith(".logic.azure.us")
  ) {
    return "teams";
  }
  return null;
}

function assertWebhookUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error("Invalid webhook URL");
  }
  if (u.protocol !== "https:") throw new Error("Webhook URL must be https");
  const provider = providerFor(u.hostname);
  if (!provider) {
    throw new Error(
      "URL must be a Slack (hooks.slack.com) or Microsoft Teams (office.com / logic.azure.com) webhook",
    );
  }
  return provider;
}

// Teams Adaptive Card wrapped for the "Post to channel via webhook" trigger.
function teamsPayload({ title, lines }) {
  return {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.4",
          body: [
            { type: "TextBlock", size: "Large", weight: "Bolder", text: title, wrap: true },
            ...lines.map((text) => ({ type: "TextBlock", text, wrap: true })),
          ],
        },
      },
    ],
  };
}

// Slack incoming-webhook payload (Markdown-ish text).
function slackPayload({ title, lines }) {
  return { text: [`*${title}*`, ...lines].join("\n") };
}

async function postAlert(webhookUrl, message) {
  const provider = assertWebhookUrl(webhookUrl);
  const payload =
    provider === "slack" ? slackPayload(message) : teamsPayload(message);

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Webhook returned ${res.status}: ${body.slice(0, 200)}`);
  }
}

/** Alert about items that just turned high-risk. */
export async function sendHighRiskAlert({ webhookUrl, shop, items }) {
  const title = `⚠️ ${items.length} item(s) newly high-risk — ${shop}`;
  const lines = items.slice(0, 20).map((i) => {
    const variant =
      i.variantTitle && i.variantTitle !== "Default Title"
        ? ` — ${i.variantTitle}`
        : "";
    return `• ${i.productTitle}${variant}: ${i.reason}`;
  });
  if (items.length > 20) lines.push(`…and ${items.length - 20} more`);
  await postAlert(webhookUrl, { title, lines });
}

/** Send a test message so the merchant can confirm the connection. */
export async function sendTestAlert({ webhookUrl, shop }) {
  await postAlert(webhookUrl, {
    title: "✅ Inventory Risk Monitor connected",
    lines: [`Test alert from ${shop}. Notifications are working.`],
  });
}
