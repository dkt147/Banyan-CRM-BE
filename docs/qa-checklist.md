# Banyan Backend QA Checklist

## Local setup

- [ ] MongoDB is reachable
- [ ] `.env` created from `.env.example`
- [ ] `npm install` completed
- [ ] `npm run seed` completed
- [ ] `npm run dev` starts on port 5000

## Auth

- [ ] Register workspace + admin
- [ ] Login
- [ ] Access protected endpoint with Bearer token
- [ ] Refresh token rotation
- [ ] Logout revokes refresh token
- [ ] Inactive user is rejected

## Tenant isolation

- [ ] Workspace A cannot read Workspace B records
- [ ] Workspace A cannot update Workspace B records
- [ ] Workspace A cannot delete Workspace B records

## CRM

- [ ] Company CRUD
- [ ] Contact CRUD
- [ ] Pipeline/stage CRUD
- [ ] Deal creation and stage movement
- [ ] Activity logging
- [ ] Task completion and snooze

## Communication

- [ ] Conversation list/detail
- [ ] Send internal message record
- [ ] Mark read
- [ ] Link conversation to contact/deal
- [ ] Template CRUD

## Calendar

- [ ] Availability conflict detection
- [ ] Hold slot
- [ ] Confirm booking
- [ ] Cancel booking
- [ ] Calendar event CRUD

## Commercial

- [ ] Agreement CRUD/status lifecycle
- [ ] Invoice CRUD
- [ ] Mark invoice paid
- [ ] Payment record
- [ ] Overdue invoice update

## Membership + loyalty

- [ ] Membership plan CRUD
- [ ] Membership CRUD
- [ ] Check-in CRUD
- [ ] Loyalty account creation
- [ ] Paid invoice awards 1 point per HK$100
- [ ] Duplicate payment event does not award points twice
- [ ] Tier recalculation
- [ ] Redemption request
- [ ] Redemption approval/decline
- [ ] Ledger balance remains consistent

## Automation

- [ ] Rule CRUD
- [ ] Enable/disable rule
- [ ] Execute rule
- [ ] Task action
- [ ] Activity action
- [ ] Notification action
- [ ] Execution log

## Integrations

- [ ] Integration record CRUD
- [ ] Webhook event is idempotent
- [ ] Provider credentials are configured outside source code

## Dashboard

- [ ] Overview metrics
- [ ] Pipeline metrics
- [ ] Revenue metrics
