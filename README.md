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
Provider credentials are configured outside the source code. This backend now includes Stripe webhook signature verification and handling for supported payment events, Xero OAuth connect/callback, Google OAuth connect/callback for Gmail and Calendar, WhatsApp webhook verification/signature checking/event capture, and a DocuSign consent callback. These routes provide the provider setup endpoints without changing the existing CRM resource architecture.

The wider provider workflows are not yet complete: Stripe PaymentIntent/checkout creation, Xero invoice synchronization and token refresh, Gmail sending/inbox synchronization, Google Calendar event synchronization and token refresh, WhatsApp message sending/CRM synchronization, and DocuSign envelope creation/status synchronization still require provider-specific implementation and testing. WordPress and access-control integrations remain future work.

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

## Provider callback and webhook endpoints

After deployment, set `PUBLIC_API_URL` to the public HTTPS API origin without `/api/v1` (for example `https://api.example.com`). The read-only endpoint `GET /api/v1/integrations/callback-urls` returns the exact URLs derived from that value.

| Provider | URL path | Purpose |
| --- | --- | --- |
| Stripe | `POST /api/v1/webhooks/stripe` | Verifies Stripe signatures against the raw request body, deduplicates events, and applies supported payment-status events to a matching Banyan payment/invoice. |
| Xero | `GET /api/v1/integrations/xero/callback` | OAuth 2.0 callback; the authenticated `GET /api/v1/integrations/xero/connect` endpoint returns the provider authorization URL. |
| Google Workspace / Calendar | `GET /api/v1/integrations/google/callback` | OAuth 2.0 callback; the authenticated `GET /api/v1/integrations/google/connect` endpoint returns the provider authorization URL. One authorization saves Gmail and Google Calendar integration records. |
| WhatsApp Business | `GET /api/v1/webhooks/whatsapp` and `POST /api/v1/webhooks/whatsapp` | Verifies Meta's webhook challenge and request signature, then stores received event payloads. Message synchronization/sending is a separate integration task. |
| DocuSign | `GET /api/v1/integrations/docusign/callback` | Receives and displays the DocuSign JWT-consent redirect result. Actual envelope sending/signature synchronization still requires provider API implementation. |

### Provider environment variables

- `STRIPE_WEBHOOK_SECRET`: signing secret copied from the configured Stripe webhook endpoint. Keep separate secrets for test and production deployments.
- `XERO_CLIENT_ID` and `XERO_CLIENT_SECRET`: Xero OAuth application credentials.
- `XERO_TENANT_ID` (optional): select a specific organisation when the authorized Xero user has access to more than one.
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`: Google OAuth application credentials for Gmail and Google Calendar.
- `WHATSAPP_VERIFY_TOKEN`: a random verification string entered in Meta's webhook settings.
- `META_APP_SECRET`: Meta app secret used to verify `X-Hub-Signature-256` on WhatsApp webhook requests.
- `INTEGRATION_TOKEN_ENCRYPTION_KEY`: exactly 32 bytes represented as 64 hexadecimal characters. Generate one with `openssl rand -hex 32`; do not change it after tokens have been stored unless existing tokens are migrated.
- `INTEGRATION_OAUTH_STATE_SECRET`: a separate long random secret used to sign short-lived OAuth state tokens. Generate it with `openssl rand -hex 32`.

Register the exact deployed callback/webhook URLs with each provider. Do not use localhost URLs in a provider's cloud configuration. OAuth state is signed and expires after 10 minutes. OAuth tokens are encrypted using AES-256-GCM before they are stored in the existing Integration model.

The provider controllers use Node's built-in `fetch` and crypto APIs; no new NPM dependency is required. Provider secrets must be configured in the deployment environment and must not be committed or placed in a shared document.
