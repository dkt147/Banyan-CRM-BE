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
Gmail, WhatsApp Business, Google Calendar, Xero, Stripe, DocuSign, WordPress and access-control systems are represented by internal integration/webhook models and API boundaries. Provider credentials and live API calls are intentionally not hard-coded. They can be connected when the client provides the required credentials and provider-specific requirements.

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
