# Local Development Guide

## Running the App Locally

```bash
npm start
```

The app will start at `http://localhost:3000` and automatically use SQLite for data storage.

## Testing Authentication & Usernames Locally

On localhost, the app **bypasses GitHub OAuth** and allows you to test the full auth flow without external dependencies.

### Create a Dev User

POST to `/api/dev/login` with username and displayName:

```bash
curl -X POST http://localhost:3000/api/dev/login \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","displayName":"Test User"}'
```

Response includes a base64-encoded principal you can use for testing.

### Set Username

Once authenticated (or on localhost), POST to `/api/user`:

```bash
curl -X POST http://localhost:3000/api/user \
  -H "Content-Type: application/json" \
  -d '{"username":"mynewusername"}'
```

### Get Current User Info

```bash
curl http://localhost:3000/api/me
```

Returns:
```json
{
  "isAuthenticated": false,
  "displayName": "Local User",
  "username": null,
  "loginUrl": "/.auth/login/github?...",
  "logoutUrl": "/.auth/logout?..."
}
```

## Local vs. Production Behavior

| Feature | Local | Production |
|---------|-------|-----------|
| Database | SQLite (`data/listflair.sqlite`) | Azure SQL |
| Image Cache | Local filesystem | Azure Blob Storage |
| Auth Required | No (bypassed) | Yes (GitHub OAuth) |
| Username Modal | Shows on `/api/user` POST (optional) | Shows on first login |

## Database Schema

### SQLite Tables

**users** — Local username registry per account
```
owner_key TEXT (primary key)
username TEXT (unique)
created_at TEXT
updated_at TEXT
```

**entries** — User's board items
```
id INTEGER (primary key)
name TEXT
category TEXT
created_at TEXT
image_url TEXT
image_status TEXT
...
owner_key TEXT (references user)
```

## Testing Workflow

1. Start server: `npm start`
2. Open `http://localhost:3000`
3. (Optional) Create test user via `/api/dev/login` endpoint
4. Add/edit board items
5. Check SQLite: `data/listflair.sqlite` for stored data

## Troubleshooting

**Username modal not showing?**
- Ensure `/api/user` endpoint returned the username successfully
- Check browser console for errors
- Verify `usernameModal` element exists in HTML

**"Username already taken" error?**
- Each username must be globally unique
- Try a different username or clear `data/listflair.sqlite` to reset

**Port 3000 already in use?**
- Set `PORT` env var: `$env:PORT=3001; npm start`
