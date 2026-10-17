# Banyan CRM Backend — Complete Non-AI API

This is the complete non-AI backend foundation for the Banyan Workspace CRM React application.

## Stack

- Node.js 20+
- Express 5
- MongoDB + Mongoose
- JWT access/refresh authentication
- Zod validation
- Helmet, CORS and rate limiting
- bcryptjs

## Scope implemented

- Authentication and refresh-token rotation
- Workspace / organization tenancy
- Team members and role permissions
- Companies and contacts
- Pipelines and stages
- Deals and stage movement
- Activities and tasks
- Inbox conversations and messages
- Email templates
- Calendar events and booking holds
- Agreements / signature lifecycle data
- Invoices and payments
- Membership plans and memberships
- Check-ins
- Loyalty tiers, accounts, ledger and redemptions
- Automation rules and execution engine
- Integrations / connection records
- Notifications
- Documents / attachments metadata
- Audit logs
- Dashboard analytics
- Provider webhook ingestion boundary

AI functionality is intentionally excluded and can be added later without changing the core CRM data model.

## Important integration boundary

Provider credentials are configured outside the source code. The backend includes Stripe-hosted Checkout and PaymentIntent creation, plus signed webhook processing; Xero OAuth, token refresh and draft invoice sync; shared Google OAuth for Gmail and Calendar, Gmail send/inbox sync and Calendar event sync; WhatsApp Cloud API sending and webhook-to-CRM message sync; and DocuSign JWT authentication, consent flow, envelope sending and status checks. These additions use the existing CRM resource/model architecture and keep generic CRUD routes available.

Live provider flows still require credentials, one-time OAuth/consent steps where applicable, provider-dashboard webhook/redirect registration and testing against each client's sandbox/test account. WordPress and access-control integrations are not included in the current confirmed client scope.

## Setup

1. Copy `.env.example` to `.env`.
2. Set a MongoDB connection string.
3. Generate long random JWT secrets.
4. Install dependencies:

```bash
npm install
```

5. Start development server:

```bash
npm run dev
```

API base URL:

```text
http://localhost:5000/api/v1
```

## Test Stripe payments and webhooks locally

1. Use Stripe Test-mode keys in `.env` (`STRIPE_SECRET_KEY=sk_test_...`). Ensure `CLIENT_URL=http://localhost:5173` and the React dev server is running on that URL.
2. Start MongoDB and the backend (`npm run dev`), then start the CRM (`npm run dev` in the frontend project).
3. Install and sign in to the Stripe CLI, then forward events into the local backend:

```bash
stripe login
stripe listen --forward-to localhost:5000/api/v1/webhooks/stripe
```

4. Copy the `whsec_...` secret printed by `stripe listen` into backend `.env` as `STRIPE_WEBHOOK_SECRET`, then restart the backend. The CLI secret is for that local listener session; do not use it as the production Dashboard webhook secret.
5. In Banyan CRM, open **Invoices**, click **Pay with Stripe** for an `awaiting` or `overdue` invoice, and use Stripe's test card `4242 4242 4242 4242`, any future expiry, any CVC and any postal code.
6. Stripe Checkout redirects back to Banyan. The Invoices page polls the backend briefly; after the signed webhook arrives, the payment should show `succeeded` on Payments and the invoice should show `paid`.

Use test keys and test card numbers only. A bare `stripe trigger payment_intent.succeeded` event does not represent a Banyan invoice and will be ignored if it has no matching Banyan payment metadata; test the end-to-end flow through the CRM instead.

For detailed step-by-step local Stripe test setup (including Stripe CLI webhooks), see [`docs/stripe-local-testing.md`](docs/stripe-local-testing.md).

## Seed development data

After MongoDB is running:

```bash
npm run seed
```

The seed creates an admin account and the four prototype pipelines plus default loyalty tiers.

Development credentials:

```text
Email: admin@banyan.local
Password: ChangeMe123!
```

Change the password immediately in a real environment.

## Security model

Every protected business record carries `workspaceId`. The authenticated user also exposes:

```text
req.user
req.workspaceId
```

This prevents users from reading or mutating records belonging to another Banyan workspace.

Roles:

- admin — workspace administration
- manager — team and operational management
- operator — day-to-day CRM operations

## Frontend integration

The React frontend should replace mock actions with REST calls while keeping the current UI information architecture. The API uses JSON and returns a consistent envelope:

```json
{
  "success": true,
  "data": {}
}
```

Errors use:

```json
{
  "success": false,
  "code": "VALIDATION_ERROR",
  "message": "Validation failed.",
  "details": []
}
```

## Validation

Auth requests use Zod validation. Mongoose validation and the global error handler protect all other resources. Additional endpoint-specific validation can be tightened as frontend payloads are wired into the API.

## AI exclusion

No AI scoring, summarization, enrichment, recommendations or AI automation is executed by this backend. AI-related frontend copy/data can remain UI-only until the later AI phase.

## Canonical route policy

The backend exposes one canonical route module per CRM domain. Redundant legacy aliases were removed from the mounted application:

- `/companies`
- `/contacts`
- `/activities`
- `/tasks`
- `/pipelines`
- `/templates`
- `/notifications`

The specialized workflow routes are mounted before generic parameter routes where necessary (calendar and invoices) so action endpoints cannot be shadowed.

The following remain backend infrastructure rather than standalone CRM screens:

- `/` API root
- `/health`
- `/webhooks/:provider`

All other mounted domains are represented in the CRM UI.

## Provider integration endpoints

After deployment, set `PUBLIC_API_URL` to the public HTTPS API origin without `/api/v1`. `GET /api/v1/integrations/callback-urls` returns exact callback/webhook URLs for provider dashboards.

| Service           | Endpoints                                                                                                                                                                                                                                                |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stripe            | `POST /payments/stripe/checkout-sessions`; `POST /payments/stripe/payment-intents`; `POST /webhooks/stripe`                                                                                                                                                                                         |
| Xero              | `GET /integrations/xero/connect`; `GET /integrations/xero/callback`; `POST /integrations/xero/invoices/:invoiceId/sync`; `GET /integrations/xero/invoices/:invoiceId`; `GET /integrations/xero/status`                                                   |
| Google Gmail      | `GET /integrations/google/connect`; `GET /integrations/google/callback`; `POST /integrations/google/gmail/send`; `POST /integrations/google/gmail/sync`; `GET /integrations/google/gmail/messages`; `GET /integrations/google/gmail/messages/:messageId` |
| Google Calendar   | Same Google OAuth grant as Gmail; `GET /integrations/google/calendar/events`; `POST /integrations/google/calendar/events/:eventId/sync`                                                                                                                  |
| WhatsApp Business | `POST /integrations/whatsapp/messages`; `GET /webhooks/whatsapp`; `POST /webhooks/whatsapp`                                                                                                                                                              |
| DocuSign          | `GET /integrations/docusign/consent-url`; `GET /integrations/docusign/callback`; `POST /integrations/docusign/agreements/:agreementId/send`; `GET /integrations/docusign/agreements/:agreementId/status`                                                 |

All paths are relative to `/api/v1`. Operational endpoints are authenticated except provider callback/webhook endpoints.

See [`docs/provider-integration-setup.md`](docs/provider-integration-setup.md) for environment variables, setup steps, request bodies and limitations. Keys alone do not bypass initial OAuth/consent or provider dashboard webhook registration.

## Gmail & Google Calendar local development

The CRM's Integrations, Inbox, and Calendar pages share one Google OAuth Web application. See `docs/google-gmail-calendar-local-setup.md` for the complete Google Cloud Console and `.env` setup guide. For local development, leave `PUBLIC_API_URL` blank, configure the exact frontend origin in `CLIENT_URL`, and register `http://localhost:5000/api/v1/integrations/google/callback` as the OAuth redirect URI. OAuth tokens are encrypted before being stored.


## Public website enquiry capture

The Banyan Workspace marketing form can submit to `POST /api/v1/public/enquiries` to create/update a Contact and create website-sourced Deals in their matching CRM pipelines. Configure `PUBLIC_WEBSITE_URL`, `PUBLIC_ENQUIRY_WORKSPACE_SLUG` (or `PUBLIC_ENQUIRY_WORKSPACE_ID`), and `CORS_ALLOWED_ORIGINS` in the backend environment.

See [`docs/website-enquiry-integration.md`](docs/website-enquiry-integration.md) for the form contract and deployment checklist. After deploying, run `npm run setup:website-enquiries` once against the target workspace to ensure Won/Lost stages are configured.
