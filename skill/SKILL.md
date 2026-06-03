---
name: x-bookmarks
description: Fetch latest bookmarked posts from X/Twitter. Install once, then use /bookmark
version: 1.0.0
author: EXP Research
metadata:
  hermes:
    tags: [x, twitter, bookmarks, social-media]
    commands:
      bookmark: "x-bookmarks"
---

# x-bookmarks

Fetch your latest bookmarked posts from X/Twitter directly inside Hermes.

## Install

```bash
hermes skills install https://raw.githubusercontent.com/dissakamajaya/x-bookmarks-dashboard/main/skill/SKILL.md
```

## Setup

You need an X OAuth 2.0 user access token with these scopes:

- `bookmark.read`
- `tweet.read`
- `users.read`

Generate one at [developer.x.com](https://developer.x.com/en/portal/dashboard) → your app → *User authentication settings* → *OAuth 2.0* → generate token.

Add the token to `~/.hermes/.env`:

```env
X_ACCESS_TOKEN=***
```

(Optional) Pre-set your username if `/2/users/me` isn't available:

```env
X_USERNAME=your_handle
```

## Usage

Once installed and configured, use in any Hermes chat:

```
/bookmark
```

This fetches the latest 10 bookmarks and prints them with author, timestamp, text, and link.

### Options (via quick command)

You can also run the CLI directly:

```bash
python3 ~/.hermes/skills/*/x-bookmarks/scripts/x-bookmarks --limit 20 --json
```

### As a standalone CLI

The script is also available as a standalone tool:

```bash
# Download
curl -sL https://raw.githubusercontent.com/dissakamajaya/x-bookmarks-dashboard/main/scripts/x-bookmarks -o x-bookmarks
chmod +x x-bookmarks

# Run with your token
./x-bookmarks --token 'your_access_token' --limit 10
```

## How it works

1. Resolves the authenticated user via `GET /2/users/me`
2. Fetches bookmarks from `GET /2/users/{id}/bookmarks`
3. Expands author profiles and media
4. Prints a clean terminal-friendly list

## Files

| File | Purpose |
|------|---------|
| `SKILL.md` | Hermes skill definition (this file) |
| `scripts/x-bookmarks` | Standalone Python CLI |
