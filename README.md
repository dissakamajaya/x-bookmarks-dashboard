# X Bookmarks Dashboard

Local dashboard for the latest bookmarked posts on X.

## What it does

- fetches the authenticated user's bookmarks from the official X API
- keeps the latest 50 items on screen
- polls on a fixed interval so the feed feels live
- shows author, timestamp, text, metrics, and media
- highlights newly added bookmarks on the next refresh

## Setup

```bash
cd tools/x-bookmarks-dashboard
cp .env.example .env
```

Fill in at least:

- `X_ACCESS_TOKEN` for your OAuth 2.0 user access token

If the token cannot call `GET /2/users/me`, set one of these too:

- `X_USER_ID`
- `X_USERNAME`

## Run

```bash
npm start
```

Open:

```bash
http://localhost:8787
```

## Notes

- The dashboard calls `GET /2/users/{id}/bookmarks` and uses `Authorization: Bearer <OAuth 2.0 user access token>`.
- The app polls every 30 seconds by default.

- `X_API_BASE_URL` defaults to `https://api.x.com` and falls back to `https://api.twitter.com`.
