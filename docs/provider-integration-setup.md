# Provider Integration Setup

## 1. Configure the deployed API

Set `PUBLIC_API_URL` to the public HTTPS API origin only, without a path or `/api/v1` suffix. Then generate and configure:

- `INTEGRATION_TOKEN_ENCRYPTION_KEY`: `openssl rand -hex 32`
- `INTEGRATION_OAUTH_STATE_SECRET`: `openssl rand -hex 32`

Do not rotate the token encryption key while stored OAuth tokens still depend on it. Keep all credentials in deployment environment variables, never in source control or a shared client document.

## 2. Get the exact provider URLs

After deployment, call:

```http
GET /api/v1/integrations/callback-urls
```

Use the returned URLs exactly as shown; the endpoint returns `null` URLs until `PUBLIC_API_URL` is a valid HTTPS origin.

## 3. Stripe

1. Register the returned `stripeWebhookUrl` in Stripe's Developers → Webhooks section.
2. Subscribe to `payment_intent.succeeded`, `payment_intent.payment_failed`, and `charge.refunded`.
3. Copy the endpoint's signing secret into `STRIPE_WEBHOOK_SECRET` in the deployment environment and restart/redeploy.
4. Use Stripe Test mode while testing and use the matching test-mode signing secret.

The handler validates `Stripe-Signature` using the untouched request body and deduplicates event IDs. For payment events to update CRM data, a corresponding Banyan payment must already exist with `provider: "stripe"` and `externalId` set to the Stripe PaymentIntent ID, or its metadata must identify `banyanPaymentId` / `paymentId`. This backend change does not create Stripe PaymentIntents or Checkout Sessions.

## 4. Xero

1. Add the returned `xeroRedirectUri` to the Xero app's OAuth 2.0 redirect URIs.
2. Configure `XERO_CLIENT_ID` and `XERO_CLIENT_SECRET` on the backend.
3. If the authorized user can access multiple Xero organisations, configure `XERO_TENANT_ID` to the intended tenant ID.
4. Call authenticated `GET /api/v1/integrations/xero/connect`. Open the `authorizationUrl` returned in the JSON response and complete consent.

On success, the callback stores the Xero access and refresh tokens encrypted in the existing Integration record. Xero invoice synchronization and token-refresh handling for later API operations are still separate work.

## 5. Google Workspace / Gmail / Calendar

1. Add the returned `googleRedirectUri` to the Google OAuth Web application credentials.
2. Enable Gmail API and Google Calendar API and configure the consent screen/scopes in Google Cloud.
3. Configure `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` on the backend.
4. Call authenticated `GET /api/v1/integrations/google/connect`. Open the returned `authorizationUrl` and complete consent.

Successful consent stores the encrypted token set under the existing `gmail` and `google_calendar` Integration records. Sending mail, inbox synchronization, calendar event synchronization, and token refresh are not implemented by this change.

## 6. WhatsApp Business

1. Configure the returned `whatsappWebhookUrl` in the Meta app's WhatsApp webhook configuration.
2. Use the same chosen verification string for Meta's Verify Token and the backend's `WHATSAPP_VERIFY_TOKEN`.
3. Set Meta's App Secret as `META_APP_SECRET` on the backend.
4. Subscribe to message and message-status notifications.

The GET route validates Meta's verification challenge. The POST route validates `X-Hub-Signature-256` and records accepted payloads as received webhook events. Mapping those events into CRM conversations/messages and sending messages still require separate implementation.

## 7. DocuSign

Add the returned `docusignRedirectUri` to the DocuSign integration's registered redirect URIs for the consent step described in the client document. The callback displays whether a consent response was received. Envelope creation, sending, and signature-status synchronization are not implemented by this change.

## 8. Verification limits

Static JavaScript syntax checks and Stripe signature checks (valid signature, wrong secret, changed body, and stale timestamp) passed during this change. Live provider authorization, webhook delivery, and MongoDB end-to-end tests must be performed after valid provider credentials and a deployed HTTPS API URL are configured.
