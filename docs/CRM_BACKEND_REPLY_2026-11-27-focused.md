# Backend reply: focused test report, 27 Nov 2026 (server items)

For the CRM frontend agent and the owner. F3 is done. F1 has a cause report and a new read-only check; the fix is **waiting for your go-ahead**. Xero needs two settings on Render.

## F1: emails shown as sent but not received

### What production shows (read-only)

| | Day pass balance email | "TEST QA email focus" |
|---|---|---|
| Sent at (HK) | 27 Nov 08:02 | 27 Nov 08:23 |
| Recipient | tester Gmail, `+daypass` address | tester Gmail, `+focus` address |
| Gmail accepted the send | yes (no error returned) | yes, Gmail returned an id |
| Saved Gmail message id | **none**: not stored (see cause 2) | `1a21a630a8093e65` (thread `1a21a630a8093e65`) |
| Where the CRM saved it | timeline Activity only | Conversation + Message, `status: sent` |

**Sending account:** `integration.config.email` and `accountName` are both `info@banyanworkspace.com`. That value comes from Google's userinfo when the account was connected, so the From address **is the signed-in account itself, not an alias**. Both emails used that From address.

**Domain mail records (public DNS):** these look correct.
- SPF includes `_spf.google.com`.
- A Google DKIM key is published at `google._domainkey`.
- DMARC is `p=none`.
- MX points to Google.

So a DNS rejection is unlikely.

### Labels, real From header and bounces: still to be read

The Gmail token in the database is encrypted, and the key exists only on Render. So I couldn't call the Gmail API from here, and I didn't mint a production login to call it through the API.

Instead there is a new **read-only, admin-only** check:

```
GET /api/v1/integrations/google/gmail/diagnostics?ids=1a21a630a8093e65&days=7
```

It returns:
- `account.signedIn` (the Gmail profile) next to `account.configuredFrom`, plus `fromIsSignedInAccount` and `fromIsVerifiedAlias`;
- `sendAs[]`: every send-as address and its verification status;
- `messages[]`: one entry per id, with `labelIds`, `hasSentLabel` and the real `From`, `To`, `Date`, `Subject` and `Message-ID` headers;
- `bounces.items[]`: any mailer-daemon or postmaster messages in the info@ inbox over the last `days` days (1–30), with date, subject and a short snippet.

It only makes GET calls to Gmail (no send, change or delete) and never returns tokens. Please call it once as an admin (`workspace.manage`) and paste me the result; I'll finish the cause from that.

The day pass email has no saved id. If it bounced, it will still show under `bounces`.

### Cause found so far

1. **Delivery:** Gmail accepted both sends from the correct account, and the domain records are fine. That points to the recipient side (spam or Promotions in the tester's Gmail) or a bounce. The check above will tell us which: `SENT` label, real From header, any bounce.
2. **Day pass email missing from the Emails tab:** the Emails tab lists email Conversations and Messages. Server-side emails (day pass balance, low balance, membership renewal reminders, form notifications) go through `sendWorkspaceEmail`, which:
   - throws away Gmail's reply, so the message id and thread id are never saved;
   - writes only a timeline Activity, never a Conversation or Message.

   That's also why there was no id to look up for the 08:02 email.

### Proposed fix (not applied; waiting for your OK)

- `sendWorkspaceEmail` returns Gmail's `{ id, threadId }`.
- Day pass balance and low-balance emails create the same Conversation and outbound Message as the email composer does: `metadata.provider: "gmail"`, `gmailMessageId`, `gmailThreadId`, `to` and `subject`, linked to the contact. So they appear on the Emails tab and can be checked later.
- The timeline Activity stays as it is, now with the Gmail id.

Membership renewal reminders and form notifications would keep their current logging unless you want them on the Emails tab too.

## F3: /memberships validation (done)

`POST /api/v1/memberships` and `PATCH /api/v1/memberships/:id` now return **422** with code `INVALID_MEMBERSHIP` and one of these messages:

| Rule | Message |
|---|---|
| seats a whole number from 1 to 500 | `Seats must be a whole number from 1 to 500.` |
| monthlyValue 0 or more | `Monthly value must be 0 or more.` |
| renewalAt not before startAt | `The renewal date can't be before the start date.` |
| endAt not before startAt | `The end date can't be before the start date.` |
| a date that can't be read | `The start date isn't a valid date.` (and the same for renewal and end) |

- **Updates:** the stored start date counts. For example, changing only `endAt` is checked against the saved `startAt`.
- Only fields sent in the request are checked, so an unrelated update (such as `status`) is never blocked by older data.
- A date can still be cleared by sending `null`.
- Numeric strings (`"12"`) are accepted.

## Xero: Connect Xero button

- **Render env vars:** **not set**. Production says `XERO_CLIENT_ID` and `XERO_CLIENT_SECRET` are missing: calling `GET /integrations/xero/callback` without a code returns 503 `INTEGRATION_NOT_CONFIGURED` and names those two. Until they're added, `GET /integrations/xero/connect` returns the same 503.
  - `INTEGRATION_OAUTH_STATE_SECRET`, `INTEGRATION_TOKEN_ENCRYPTION_KEY` and `PUBLIC_API_URL` are set.
  - Optional: `XERO_TENANT_ID` (only needed if the Xero login can reach more than one organisation), `XERO_SALES_ACCOUNT_CODE` and `XERO_DEFAULT_TAX_TYPE`.
- **Redirect URI:** `/integrations/callback-urls` gives `xeroRedirectUri` = `https://banyan-crm-be-n69x.onrender.com/api/v1/integrations/xero/callback`. I can't see the Xero developer app from here. The owner needs to add this exact URI under the app's redirect URIs, copying the client id and secret from the same app.
- **After both are done:** Connect Xero should open Xero's login. If it fails, check for an exact match between the redirect URI in the Xero app and the one above.

## Tests

`tests/focused-2026-11-27.test.js`: the membership rules (create, update, stored dates, 404) and the Gmail check (admin only, GET calls only, no token in the reply). The full suite passes, 101 of 101.
