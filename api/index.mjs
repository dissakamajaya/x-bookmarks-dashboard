import { readFileSync, existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Env ──────────────────────────────────────────────────────────
function loadEnvFile(dotenvPath = resolve(process.cwd(), '.env')) {
  if (!existsSync(dotenvPath)) return;
  const raw = readFileSync(dotenvPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const m = t.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    if (process.env[m[1]] !== undefined) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    v = v.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t');
    process.env[m[1]] = v;
  }
}
loadEnvFile();

// ── Config ───────────────────────────────────────────────────────
const ACCESS_TOKEN = process.env.X_ACCESS_TOKEN || process.env.X_USER_ACCESS_TOKEN || '';
const USER_ID_ENV = process.env.X_USER_ID || '';
const USERNAME_ENV = process.env.X_USERNAME || '';
const DEFAULT_LIMIT = clamp(process.env.BOOKMARK_LIMIT, 50, 1, 100);
const CACHE_TTL_MS = clamp(process.env.CACHE_TTL_MS, 15000, 0, 300000);
const API_BASES = unique([normalizeBase(process.env.X_API_BASE_URL || 'https://api.x.com'), 'https://api.twitter.com']);
const PUBLIC_DIR = resolve(fileURLToPath(new URL('../public/', import.meta.url)));

let userCache = null;
let bookmarksCache = new Map();

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

// ── Helpers ──────────────────────────────────────────────────────
function clamp(v, fallback, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}
function unique(arr) { return [...new Set(arr.filter(Boolean))]; }
function normalizeBase(v) { return String(v || '').replace(/\/$/, ''); }
function apiUrl(base, path, query = {}) {
  const u = new URL(path, `${base}/`);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, v);
  }
  return u.toString();
}
function buildTweetUrl(id) { return `https://x.com/i/web/status/${id}`; }

async function fetchJson(path, { query = {}, base, signal } = {}) {
  if (!ACCESS_TOKEN) throw new Error('Missing X_ACCESS_TOKEN.');
  const bases = base ? [base] : API_BASES;
  let lastError;
  for (const apiBase of bases) {
    const url = apiUrl(apiBase, path, query);
    try {
      const resp = await fetch(url, { signal, headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'User-Agent': 'x-bookmarks-dashboard/0.1' } });
      const raw = await resp.text();
      let body = null;
      if (raw) {
        try { body = JSON.parse(raw); } catch { body = { raw }; }
      }
      if (!resp.ok) {
        const msg = body?.detail || body?.title || resp.statusText || 'Request failed';
        const err = new Error(msg);
        err.status = resp.status; err.body = body; err.url = url;
        lastError = err;
        if (resp.status === 404 && apiBase !== bases[bases.length - 1]) continue;
        throw err;
      }
      return { data: body, url, base: apiBase };
    } catch (e) {
      lastError = e;
      if (apiBase !== bases[bases.length - 1]) continue;
    }
  }
  throw lastError || new Error('X API request failed');
}

async function resolveCurrentUser() {
  const now = Date.now();
  if (userCache && userCache.expires > now) return userCache.value;

  if (USER_ID_ENV) {
    try {
      const lookup = await fetchJson(`/2/users/${USER_ID_ENV}`, { query: { 'user.fields': 'id,name,profile_image_url,username,verified' } });
      const u = lookup.data?.data;
      if (u?.id) { u.source = 'env'; userCache = { value: u, expires: now + CACHE_TTL_MS }; return u; }
    } catch { /* fall through */ }
    const u = { id: USER_ID_ENV, username: USERNAME_ENV || 'me', name: USERNAME_ENV || 'You', source: 'env' };
    userCache = { value: u, expires: now + CACHE_TTL_MS };
    return u;
  }

  try {
    const r = await fetchJson('/2/users/me');
    const u = r.data?.data;
    if (!u?.id) throw new Error('/2/users/me returned no id.');
    u.source = 'api';
    userCache = { value: u, expires: now + CACHE_TTL_MS };
    return u;
  } catch (e) {
    if (!USERNAME_ENV) throw new Error('Set X_USERNAME or X_USER_ID to resolve user.');
    const lookup = await fetchJson(`/2/users/by/username/${encodeURIComponent(USERNAME_ENV)}`);
    const u = lookup.data?.data;
    if (!u?.id) throw new Error(`Cannot resolve @${USERNAME_ENV}.`);
    u.source = 'username';
    userCache = { value: u, expires: now + CACHE_TTL_MS };
    return u;
  }
}

function normalizeTweet(tweet, includes = {}) {
  const mediaMap = new Map((includes.media || []).map(m => [m.media_key, m]));
  const userMap = new Map((includes.users || []).map(u => [u.id, u]));
  const author = userMap.get(tweet.author_id) || null;
  const media = (tweet.attachments?.media_keys || []).map(k => mediaMap.get(k)).filter(Boolean).map(m => ({
    media_key: m.media_key, type: m.type, url: m.url || null, preview_image_url: m.preview_image_url || null,
    alt_text: m.alt_text || null, width: m.width || null, height: m.height || null,
  }));
  return {
    id: tweet.id, text: tweet.text || '', url: buildTweetUrl(tweet.id), created_at: tweet.created_at || null,
    lang: tweet.lang || null, possibly_sensitive: Boolean(tweet.possibly_sensitive),
    author: author ? { id: author.id, name: author.name || author.username, username: author.username, profile_image_url: author.profile_image_url || null, verified: Boolean(author.verified) } : null,
    public_metrics: tweet.public_metrics || null, referenced_tweets: tweet.referenced_tweets || [], media,
  };
}

// ── Route handlers ───────────────────────────────────────────────

async function handleHealth() {
  return { ok: true, ready: Boolean(ACCESS_TOKEN), has_user_id: Boolean(USER_ID_ENV), has_username: Boolean(USERNAME_ENV), api_base: API_BASES[0], default_limit: DEFAULT_LIMIT, cache_ttl_ms: CACHE_TTL_MS };
}

async function handleBookmarks(limit) {
  limit = clamp(limit, DEFAULT_LIMIT, 1, 100);
  const cacheKey = String(limit);
  const now = Date.now();
  const cached = bookmarksCache.get(cacheKey);
  if (cached && cached.expires > now) return { ...cached.value, cached: true };

  const user = await resolveCurrentUser();
  const items = [];
  let paginationToken = null, lastResponse = null;

  while (items.length < limit) {
    const query = {
      max_results: String(Math.min(100, Math.max(limit, 50))),
      'tweet.fields': 'attachments,author_id,created_at,entities,lang,possibly_sensitive,public_metrics,referenced_tweets,text',
      expansions: 'author_id,attachments.media_keys,referenced_tweets.id,referenced_tweets.id.author_id',
      'media.fields': 'alt_text,height,media_key,preview_image_url,type,url,width',
      'user.fields': 'id,name,profile_image_url,username,verified',
    };
    if (paginationToken) query.pagination_token = paginationToken;
    const page = await fetchJson(`/2/users/${user.id}/bookmarks`, { query });
    lastResponse = page;
    const data = page.data?.data || [];
    const includes = page.data?.includes || {};
    for (const tw of data) {
      items.push(normalizeTweet(tw, includes));
      if (items.length >= limit) break;
    }
    paginationToken = page.data?.meta?.next_token || null;
    if (!paginationToken || !data.length) break;
  }

  const seen = new Set();
  const deduped = items.filter(item => { if (seen.has(item.id)) return false; seen.add(item.id); return true; });

  const result = { ok: true, refreshed_at: new Date().toISOString(), user, count: deduped.length, items: deduped, pagination_token: lastResponse?.data?.meta?.next_token || null, source: lastResponse?.base || API_BASES[0] };
  bookmarksCache.set(cacheKey, { value: result, expires: now + CACHE_TTL_MS });
  return { ...result, cached: false };
}

async function serveStatic(pathname) {
  const safePath = pathname === '/' ? '/index.html' : pathname;
  const filePath = resolve(join(PUBLIC_DIR, `.${safePath}`));
  if (!filePath.startsWith(PUBLIC_DIR)) return { status: 400, body: 'Invalid path' };
  try {
    const { readFile } = await import('node:fs/promises');
    const body = await readFile(filePath);
    return { status: 200, body, contentType: MIME[extname(filePath)] || 'application/octet-stream' };
  } catch {
    return { status: 404, body: 'Not found' };
  }
}

// ── Main handler (Vercel serverless entry) ───────────────────────
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let result;

    if (url.pathname === '/api/health') {
      result = await handleHealth();
    } else if (url.pathname === '/api/bookmarks') {
      result = await handleBookmarks(url.searchParams.get('limit'));
    } else if (url.pathname.startsWith('/api/')) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: false, error: 'Unknown route' }));
      return;
    } else {
      const file = await serveStatic(url.pathname);
      res.statusCode = file.status;
      if (file.contentType) res.setHeader('Content-Type', file.contentType);
      res.setHeader('Cache-Control', 'no-store');
      res.end(file.body);
      return;
    }

    const body = JSON.stringify(result);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(body);
  } catch (error) {
    res.statusCode = error.status || 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ok: false,
      error: { message: error.message || 'Server error', detail: error.body || null,
        hint: ACCESS_TOKEN ? 'Set X_USERNAME or X_USER_ID if /2/users/me is unavailable.' : 'Set X_ACCESS_TOKEN.' },
    }));
  }
}
