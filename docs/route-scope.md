# Banyan route scope

## Canonical CRM domains

auth, workspace, members, companies, contacts, pipelines/stages, deals, activities, tasks, inbox, templates, calendar/events/bookings, agreements, invoices, payments, membership plans, memberships, check-ins, loyalty, automations, integrations, notifications, documents, audit logs, dashboard.

## Infrastructure

health and provider webhooks remain backend-only.

## Removed redundant/out-of-scope aliases

The previous duplicate controller/resource aliases were removed:
company.routes.js, contact.routes.js, activity.routes.js, task.routes.js, pipelines.routes.js, pipelineStages.routes.js, templates.routes.js, notifications.routes.js, conversations.routes.js, messages.routes.js.

The CRM inbox workflow owns conversation/message behavior, so raw duplicate CRUD routes were not retained as separate public API surfaces.
