# Phase 1 API Quick Reference

Base URL: `http://localhost:5000/api/v1`

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | No | Health/database status |
| POST | `/auth/register` | No | Create user |
| POST | `/auth/login` | No | Login |
| POST | `/auth/refresh` | Refresh cookie | Rotate refresh token |
| POST | `/auth/logout` | Refresh cookie | Revoke refresh token |
| GET | `/auth/me` | Bearer | Current user |

For protected routes:

```text
Authorization: Bearer <accessToken>
```
