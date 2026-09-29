# Banyan CRM API Endpoint Catalog

Base: `/api/v1`

## Auth

- POST `/auth/register`
- POST `/auth/login`
- POST `/auth/refresh`
- POST `/auth/logout`
- GET `/auth/me`
- PATCH `/auth/profile`

## Workspace / team

- GET/PATCH `/workspace`
- GET/POST/PATCH/DELETE `/members`

## Core CRM

- CRUD `/companies`
- CRUD `/contacts`
- CRUD `/pipelines`
- GET/POST `/pipelines/:id/stages`
- PATCH/DELETE `/pipelines/stages/:stageId`
- CRUD `/deals`
- PATCH `/deals/:id/move`
- CRUD `/activities`
- CRUD `/tasks`

## Inbox / communication

- GET `/inbox`
- GET `/inbox/:id`
- POST `/inbox/:id/messages`
- PATCH `/inbox/:id/read`
- PATCH `/inbox/:id/link`
- CRUD `/messages`
- CRUD `/templates`

## Calendar

- GET `/calendar/availability`
- GET `/calendar/events`
- POST `/calendar/holds`
- PATCH `/calendar/bookings/:id/confirm`
- PATCH `/calendar/bookings/:id/cancel`
- CRUD `/calendar-events`
- CRUD `/bookings`

## Commercial

- CRUD `/agreements`
- CRUD `/invoices`
- PATCH `/invoices/:id/pay`
- POST `/invoices/mark-overdue`
- CRUD `/payments`

## Membership

- CRUD `/membership-plans`
- CRUD `/memberships`
- CRUD `/check-ins`

## Loyalty

- CRUD `/loyalty-tiers`
- GET `/loyalty/accounts`
- CRUD `/loyalty-accounts`
- CRUD `/loyalty-ledger`
- CRUD `/loyalty-redemptions`
- POST `/loyalty/adjust`
- POST `/loyalty/redemptions`
- PATCH `/loyalty/redemptions/:id/decision`

Points accrue from paid invoice value at 1 point per HK$100. Payment processing is the trigger, not invoice creation.

## Automation

- GET/POST/PATCH `/automations`
- POST `/automations/:id/execute`
- GET `/automations/:id/executions`

Supported internal actions include creating a task, logging an activity and creating an in-app notification. Provider email/WhatsApp sending is intentionally integration-dependent.

## Integrations / system

- CRUD `/integrations`
- GET/PATCH `/notifications`
- CRUD `/documents`
- GET `/audit-logs`
- GET `/dashboard/overview`
- GET `/dashboard/pipeline`
- GET `/dashboard/revenue`
- POST `/webhooks/:provider`
- GET `/health`
