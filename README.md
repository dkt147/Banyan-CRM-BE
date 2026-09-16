# Banyan CRM Backend — Phase 1

Production-oriented foundation for the Banyan Workspace CRM.

## Stack

- Node.js
- Express.js
- MongoDB
- Mongoose
- JWT access + refresh authentication
- bcryptjs
- Zod validation
- Helmet
- CORS
- express-rate-limit
- cookie-parser
- Morgan

## Phase 1 scope

- Express application foundation
- Environment validation
- MongoDB connection
- Security middleware
- Centralized error handling
- Health endpoint
- User model
- Refresh-token model with correct TTL index
- Register
- Login
- Refresh-token rotation
- Logout
- Current-user endpoint
- HTTP-only refresh cookie
- Bearer access-token authentication

## Setup

1. Copy `.env.example` to `.env`.
2. Set `MONGODB_URI`.
3. Generate two strong JWT secrets (at least 32 characters).
4. Install dependencies:

```bash
npm install
```

5. Start development server:

```bash
npm run dev
```

API:

```text
http://localhost:5000
```

Health:

```text
GET http://localhost:5000/api/v1/health
```

## Auth endpoints

```text
POST /api/v1/auth/register
POST /api/v1/auth/login
POST /api/v1/auth/refresh
POST /api/v1/auth/logout
GET  /api/v1/auth/me
```

### Register

```json
{
  "name": "Banyan Admin",
  "email": "admin@example.com",
  "password": "StrongPassword123!",
  "role": "admin"
}
```

### Login

```json
{
  "email": "admin@example.com",
  "password": "StrongPassword123!"
}
```

Login returns an access token and sets the refresh token as an HTTP-only cookie.

## Important security notes

- Never commit `.env`.
- Use long random JWT secrets.
- In production use HTTPS and `COOKIE_SECURE=true`.
- If frontend/backend are on different sites, review SameSite/secure cookie settings.
- Refresh tokens are stored hashed in MongoDB.
- Refresh-token rotation revokes the previous token.
- The refresh-token TTL index uses `expiresAt` with `expireAfterSeconds: 0`.

## Next phase

Phase 2 should build the CRM core around the latest Banyan prototype:

- Companies
- Contacts
- Pipelines
- Pipeline stages
- Deals
- Activities
- Tasks

The prototype remains the source of truth for UI and business workflow.
