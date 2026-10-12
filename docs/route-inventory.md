# Banyan API Route Inventory

All route modules in `src/routes` are now reachable from `src/app.js`.

## Primary API

- `/api/v1/health`
- `/api/v1/auth`
- `/api/v1/workspace`
- `/api/v1/members`
- `/api/v1/companies`
- `/api/v1/contacts`
- `/api/v1/pipelines`
- `/api/v1/deals`
- `/api/v1/activities`
- `/api/v1/tasks`
- `/api/v1/inbox`
- `/api/v1/conversations`
- `/api/v1/messages`
- `/api/v1/templates`
- `/api/v1/calendar`
- `/api/v1/calendar-events`
- `/api/v1/bookings`
- `/api/v1/agreements`
- `/api/v1/invoices`
- `/api/v1/payments`
- `/api/v1/membership-plans`
- `/api/v1/memberships`
- `/api/v1/check-ins`
- `/api/v1/loyalty`
- `/api/v1/loyalty-tiers`
- `/api/v1/loyalty-accounts`
- `/api/v1/loyalty-ledger`
- `/api/v1/loyalty-redemptions`
- `/api/v1/automations`
- `/api/v1/integrations`
- `/api/v1/notifications`
- `/api/v1/documents`
- `/api/v1/audit-logs`
- `/api/v1/dashboard`
- `/api/v1/webhooks`

## Explicitly exposed additional route modules

These modules previously existed but were not mounted by `app.js`. They are now available without shadowing the primary routes:

- `company.routes.js` → `/api/v1/company`
- `contact.routes.js` → `/api/v1/contact`
- `activity.routes.js` → `/api/v1/activity`
- `task.routes.js` → `/api/v1/task`
- `pipelines.routes.js` → `/api/v1/pipelines-resource`
- `pipelineStages.routes.js` → `/api/v1/pipeline-stages`
- `templates.routes.js` → `/api/v1/templates-resource`
- `notifications.routes.js` → `/api/v1/notifications-resource`

## Additional fixes

- Calendar specialized endpoints are now exposed under `/api/v1/calendar`:
  - `GET /availability`
  - `GET /events`
  - `POST /hold`
  - `PATCH /:id/confirm`
  - `PATCH /:id/cancel`
  - plus standard CalendarEvent CRUD
- Invoice specialized actions are ordered before generic CRUD so `POST /mark-overdue` is reachable.
- Primary company/contact routes now expose archive actions before generic `/:id` CRUD.
