# Banyan Room Booking plugin: partner blocks endpoint

**For:** the WordPress plugin maintainer (Banyan Room Booking on banyanworkspace.com).
**Why:** a partner adds meetings directly in the shared Library Google Calendar. WordPress doesn't know about them, so the website can sell the same hours. The CRM already reads those partner events. It needs a way to turn them into **blocked time in WordPress**, the same as WP Admin → Room Bookings → Block time, but automatically.

The CRM side is built and switched off. It starts working once these two endpoints exist and an admin turns on "Block partner events in WordPress" in the CRM.

## Endpoints (token-protected, like `GET /bookings`)

Both endpoints require the header `X-Banyan-Token: <API token>`. Return 401/403 without it.

### `POST /wp-json/banyan/v1/blocks`

```json
{
  "room": "library",
  "date": "2026-11-23",
  "start": 14,
  "hours": 2,
  "reason": "Partner: Board meeting",
  "external_id": "gcal:abc123:2026-11-23"
}
```

| Field | Rules |
|---|---|
| `room` | `small` · `medium` · `library` |
| `date` | `YYYY-MM-DD`, an open day (Mon–Fri). The 90-day window **doesn't apply** to blocks. |
| `start` | int 9–17 |
| `hours` | int ≥ 1, `start + hours ≤ 18` |
| `reason` | string, max 200. Store it as the block's notes (shown in WP Admin and in `GET /bookings`). |
| `external_id` | string, max 120. **Idempotency key**: if a block with this `external_id` already exists, return it (200) and don't create another. |

Responses:
- **201** (or 200 when it already exists): `{ "ref": "BNY-XXXXXX" }`. Create a booking row with `status = blocked`, `channel = admin`, `first_name = "Blocked"` and `notes = reason`, exactly like a manual block. It must show in `/availability` and `GET /bookings`.
- **409**: `{ "message": "…", "conflicts": ["BNY-…"] }` when any hour overlaps a **paid or pending** booking. Use the same lock and clash check as `/checkout`. Don't create a partial block. The CRM shows these clashes to staff.
- **400**: `{ "message": "…" }` for validation errors.

### `DELETE /wp-json/banyan/v1/blocks/{ref}`

- Deletes or cancels the block **only if** its status is `blocked`. Return **200** `{ "ok": true }`.
- **404** if no such ref; **409** if the ref is not a block (the CRM never asks to delete a customer booking).

## Notes

- Include `external_id` in the `GET /bookings` payload (`booking.external_id`), so the CRM can reconcile.
- Blocks created this way can be removed by hand in WP Admin as usual. The CRM recreates a block only if the partner event still exists and changes.
- CRM behaviour, for reference: every 10 minutes it reads partner events (not its own booking events, not events marked "free") in the room calendars for the next 90 days. It rounds them outwards to whole hours within 09:00–18:00 on weekdays, then calls `POST /blocks` and `DELETE /blocks/{ref}` for the differences. Until `POST /blocks` exists, the CRM receives a 404 `rest_no_route`, stops, and retries every 6 hours.
