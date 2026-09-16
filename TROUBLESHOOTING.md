# Troubleshooting

## MongoDB connection fails

Check `.env`:

```text
MONGODB_URI=mongodb://127.0.0.1:27017/banyan_crm
```

For MongoDB Atlas, replace it with your Atlas connection string and ensure your machine/IP is permitted by Atlas network access.

## Environment validation fails

Both JWT secrets must be at least 32 characters:

```text
JWT_ACCESS_SECRET=...
JWT_REFRESH_SECRET=...
```

## CORS error

Set:

```text
CLIENT_URL=http://localhost:5173
```

to the exact origin used by the React frontend.

## Port already in use

Change:

```text
PORT=5000
```

to another available port.
