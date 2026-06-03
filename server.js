import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function loadEnvFile(dotenvPath = resolve(process.cwd(), '.env')) {
  if (!existsSync(dotenvPath)) return;
  const raw = readFileSync(dotenvPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const key = match[1];
    if (process.env[key] !== undefined) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    value = value.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t');
    process.env[key] = value;
  }
}

loadEnvFile();

const PORT = Number(process.env.PORT || 8787);
const PUBLIC_DIR = resolve(fileURLToPath(new URL('./public/', import.meta.url)));
const API_BASES = unique([
  normalizeBase(process.env.X_API_BASE_URL || 'https://api.x.com'),
  'https://api.twitter.com',
]);
const ACCESS_TOKEN = process.env.X_ACCESS_TOKEN || process.env.X_USER_ACCESS_TOKEN || '';
const USER_ID = process.env.X_USER_ID || '';
const USERNAME = process.env.X_USERNAME || '';
const DEFAULT_LIMIT = clampNumber(process.env.BOOKMARK_LIMIT, 50, 1, 100);
const CACHE_TTL_MS = clampNumber(process.env.CACHE_TTL_MS, 15000, 0, 300000);

let userCache = null;
let bookmarksCache = new Map();

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeBase(value) {
  return String(value || '').replace(/\/$/, '');
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function text(res, status, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendError(res, status, message, details = {}) {
  json(res, status, {
    ok: false,
    error: {
      message,
      ...details,
    },
  });
}

function apiUrl(base, path, query = {}) {
  const url = new URL(path, `${base}/`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

async function fetchJson(path, { query = {}, base, signal } = {}) {
  if (!ACCESS_TOKEN) {
    throw new Error('Missing X_ACCESS_TOKEN. Set it to your OAuth 2.0 user access token.');
  }

  const bases = base ? [base] : API_BASES;
  let lastError;

  for (const apiBase of bases) {
    const url = apiUrl(apiBase, path, query);
    try {
      const response = await fetch(url, {
        signal,
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          'User-Agent': 'x-bookmarks-dashboard/0.1',
        },
      });

      const raw = await response.text();
      let body = null;
      if (raw) {
        try {
          body = JSON.parse(raw);
        } catch {
          body = { raw };
        }
      }

      if (!response.ok) {
        const message = body?.detail || body?.title || response.statusText || 'Request failed';
        const error = new Error(message);
        error.status = response.status;
        error.body = body;
        error.url = url;
        lastError = error;
        if (response.status === 404 && apiBase !== bases[bases.length - 1]) {
          continue;
        }
        throw error;
      }

      return { data: body, url, base: apiBase };
    } catch (error) {
      lastError = error;
      if (apiBase !== bases[bases.length - 1]) {
        continue;
      }
    }
  }

  throw lastError || new Error('X API request failed');
}

async function resolveCurrentUser() {
  const now = Date.now();
  if (userCache && userCache.expires > now) {
    return userCache.value;
  }

  if (USER_ID) {
    try {
      const lookup = await fetchJson(`/2/users/${USER_ID}`, {
        query: {
          'user.fields': ['id', 'name', 'profile_image_url', 'username', 'verified'].join(','),
        },
      });
      const user = lookup.data?.data;
      if (user?.id) {
        user.source = 'env';
        userCache = { value: user, expires: now + CACHE_TTL_MS };
        return user;
      }
    } catch {
      // Fall through to the lightweight env-backed placeholder below.
    }

    const user = {
      id: USER_ID,
      username: USERNAME || 'me',
      name: USERNAME || 'You',
      source: 'env',
    };
    userCache = { value: user, expires: now + CACHE_TTL_MS };
    return user;
  }

  try {
    const result = await fetchJson('/2/users/me');
    const user = result.data?.data;
    if (!user?.id) {
      throw new Error('X /2/users/me returned no user id.');
    }
    user.source = 'api';
    userCache = { value: user, expires: now + CACHE_TTL_MS };
    return user;
  } catch (error) {
    if (!USERNAME) {
      throw new Error(
        'Unable to resolve the authenticated user. Set X_USER_ID or X_USERNAME, or confirm that your token can call /2/users/me.'
      );
    }

    const lookup = await fetchJson(`/2/users/by/username/${encodeURIComponent(USERNAME)}`);
    const user = lookup.data?.data;
    if (!user?.id) {
      throw new Error(`Unable to resolve @${USERNAME} to a user id.`);
    }
    user.source = 'username';
    userCache = { value: user, expires: now + CACHE_TTL_MS };
    return user;
  }
}

function buildTweetUrl(tweetId) {
  return `https://x.com/i/web/status/${tweetId}`;
}

function buildMediaMap(includes = {}) {
  const media = new Map();
  for (const item of includes.media || []) {
    media.set(item.media_key, item);
  }
  return media;
}

function buildUserMap(includes = {}) {
  const users = new Map();
  for (const item of includes.users || []) {
    users.set(item.id, item);
  }
  return users;
}

function normalizeTweet(tweet, includes = {}) {
  const mediaMap = buildMediaMap(includes);
  const userMap = buildUserMap(includes);
  const author = userMap.get(tweet.author_id) || null;
  const attachments = tweet.attachments?.media_keys || [];
  const media = attachments
    .map((key) => mediaMap.get(key))
    .filter(Boolean)
    .map((item) => ({
      media_key: item.media_key,
      type: item.type,
      url: item.url || null,
      preview_image_url: item.preview_image_url || null,
      alt_text: item.alt_text || null,
      width: item.width || null,
      height: item.height || null,
    }));

  return {
    id: tweet.id,
    text: tweet.text || '',
    url: buildTweetUrl(tweet.id),
    created_at: tweet.created_at || null,
    lang: tweet.lang || null,
    possibly_sensitive: Boolean(tweet.possibly_sensitive),
    author: author
      ? {
          id: author.id,
          name: author.name || author.username || 'Unknown',
          username: author.username || 'unknown',
          profile_image_url: author.profile_image_url || null,
          verified: Boolean(author.verified),
        }
      : null,
    public_metrics: tweet.public_metrics || null,
    referenced_tweets: tweet.referenced_tweets || [],
    media,
  };
}

async function fetchBookmarksPage(userId, limit, paginationToken) {
  const query = {
    max_results: String(Math.min(100, Math.max(limit, 50))),
    'tweet.fields': [
      'attachments',
      'author_id',
      'created_at',
      'entities',
      'lang',
      'possibly_sensitive',
      'public_metrics',
      'referenced_tweets',
      'text',
    ].join(','),
    expansions: [
      'author_id',
      'attachments.media_keys',
      'referenced_tweets.id',
      'referenced_tweets.id.author_id',
    ].join(','),
    'media.fields': ['alt_text', 'height', 'media_key', 'preview_image_url', 'type', 'url', 'width'].join(','),
    'user.fields': ['id', 'name', 'profile_image_url', 'username', 'verified'].join(','),
  };

  if (paginationToken) {
    query.pagination_token = paginationToken;
  }

  return fetchJson(`/2/users/${userId}/bookmarks`, { query });
}

async function getBookmarks(limit = DEFAULT_LIMIT) {
  const cacheKey = String(limit);
  const now = Date.now();
  const cached = bookmarksCache.get(cacheKey);
  if (cached && cached.expires > now) {
    return { ...cached.value, cached: true };
  }

  const user = await resolveCurrentUser();
  const items = [];
  let paginationToken = null;
  let lastResponse = null;

  while (items.length < limit) {
    const page = await fetchBookmarksPage(user.id, limit, paginationToken);
    lastResponse = page;
    const data = page.data?.data || [];
    const includes = page.data?.includes || {};
    for (const tweet of data) {
      items.push(normalizeTweet(tweet, includes));
      if (items.length >= limit) {
        break;
      }
    }
    paginationToken = page.data?.meta?.next_token || null;
    if (!paginationToken || !data.length) {
      break;
    }
  }

  const deduped = [];
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    deduped.push(item);
  }

  const result = {
    ok: true,
    refreshed_at: new Date().toISOString(),
    user,
    count: deduped.length,
    items: deduped,
    pagination_token: lastResponse?.data?.meta?.next_token || null,
    source: lastResponse?.base || API_BASES[0],
  };

  bookmarksCache.set(cacheKey, {
    value: result,
    expires: now + CACHE_TTL_MS,
  });

  return { ...result, cached: false };
}

async function serveStatic(pathname, res) {
  const safePath = pathname === '/' ? '/index.html' : pathname;
  const filePath = resolve(join(PUBLIC_DIR, `.${safePath}`));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendError(res, 400, 'Invalid path');
    return;
  }

  try {
    const body = await readFile(filePath);
    const type = MIME_TYPES[extname(filePath)] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': 'no-store',
      'Content-Length': body.length,
    });
    res.end(body);
  } catch {
    sendError(res, 404, 'Not found');
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === '/api/health') {
      json(res, 200, {
        ok: true,
        ready: Boolean(ACCESS_TOKEN),
        has_user_id: Boolean(USER_ID),
        has_username: Boolean(USERNAME),
        api_base: API_BASES[0],
        default_limit: DEFAULT_LIMIT,
        cache_ttl_ms: CACHE_TTL_MS,
      });
      return;
    }

    if (url.pathname === '/api/bookmarks') {
      const limit = clampNumber(url.searchParams.get('limit'), DEFAULT_LIMIT, 1, 100);
      try {
        const data = await getBookmarks(limit);
        json(res, 200, data);
      } catch (error) {
        sendError(res, error.status || 500, error.message || 'Failed to fetch bookmarks', {
          detail: error.body || null,
          hint: ACCESS_TOKEN
            ? 'Set X_USER_ID if /2/users/me is not available for your token.'
            : 'Set X_ACCESS_TOKEN to your OAuth 2.0 user access token.',
        });
      }
      return;
    }

    if (url.pathname.startsWith('/api/')) {
      sendError(res, 404, 'Unknown API route');
      return;
    }

    await serveStatic(url.pathname, res);
  } catch (error) {
    sendError(res, 500, error.message || 'Server error');
  }
});

server.listen(PORT, () => {
  console.log(`X Bookmarks Dashboard listening on http://localhost:${PORT}`);
  console.log(`API base: ${API_BASES[0]}`);
});
