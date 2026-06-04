const state = {
  items: [],
  user: null,
  lastRefresh: null,
  lastError: null,
  newCount: 0,
  source: '—',
  health: null,
  isRefreshing: false,
  previousIds: new Set(),
  settingsOpen: false,
  refreshInterval: 0,
  intervalId: null,
};

const els = {
  accountValue: document.getElementById('accountValue'),
  countValue: document.getElementById('countValue'),
  newValue: document.getElementById('newValue'),
  refreshValue: document.getElementById('refreshValue'),
  statusValue: document.getElementById('statusValue'),
  sourceValue: document.getElementById('sourceValue'),
  liveDot: document.getElementById('liveDot'),
  setupBanner: document.getElementById('setupBanner'),
  feed: document.getElementById('feed'),
  refreshBtn: document.getElementById('refreshBtn'),
  filterInput: document.getElementById('filterInput'),
  settingsBtn: document.getElementById('settingsBtn'),
  settingsMenu: document.getElementById('settingsMenu'),
  intervalSelect: document.getElementById('intervalSelect'),
  tokenInput: document.getElementById('tokenInput'),
  refreshTokenInput: document.getElementById('refreshTokenInput'),
  saveTokenBtn: document.getElementById('saveTokenBtn'),
  tokenStatus: document.getElementById('tokenStatus'),
  tweetTemplate: document.getElementById('tweetTemplate'),
};

// ── Token persistence (localStorage) ────────────────────────────
function getClientToken() { return localStorage.getItem('x_access_token') || ''; }
function setClientToken(t) {
  if (t) localStorage.setItem('x_access_token', t);
  else localStorage.removeItem('x_access_token');
}
function getClientRefreshToken() { return localStorage.getItem('x_refresh_token') || ''; }
function setClientRefreshToken(t) {
  if (t) localStorage.setItem('x_refresh_token', t);
  else localStorage.removeItem('x_refresh_token');
}

// ── Translation ──────────────────────────────────────────────────
const translateCache = new Map();

async function translateText(text, from) {
  if (!text || !from || from === 'en' || from === 'und') return null;
  const key = `${from}:${text.slice(0, 100)}`;
  if (translateCache.has(key)) return translateCache.get(key);
  try {
    const r = await fetch(
      `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(from)}&tl=en&dt=t&q=${encodeURIComponent(text.slice(0, 2000))}`
    );
    if (!r.ok) return null;
    const data = await r.json();
    const t = (data[0] || []).map(p => p[0]).filter(Boolean).join(' ');
    if (t && t !== text) { translateCache.set(key, t); return t; }
    return null;
  } catch { return null; }
}

async function renderTranslateBtn(el, tweet) {
  if (!tweet.lang || tweet.lang === 'en' || tweet.lang === 'und') return;
  const original = tweet.text;
  // Auto-translate in the background
  const result = await translateText(original, tweet.lang);
  if (result) {
    el.textContent = result;
    // Add an indicator showing it was translated
    const info = document.createElement('span');
    info.className = 'translated-marker';
    info.textContent = `EN (from ${tweet.lang.toUpperCase()})`;
    el.parentNode.insertBefore(info, el.nextSibling);
  }
}

function fmtDate(v) {
  if (!v) return '';
  try { return new Date(v).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); }
  catch { return new Date(v).toLocaleDateString() + ' ' + new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
}

function fmtRel(v) {
  if (!v) return '';
  const d = Date.now() - new Date(v).getTime();
  const m = Math.round(d / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function dot(kind) {
  els.liveDot.className = `dot dot-${kind}`;
}

function banner(msg, kind) {
  if (!msg) { els.setupBanner.classList.add('hidden'); els.setupBanner.textContent = ''; return; }
  els.setupBanner.textContent = msg;
  els.setupBanner.classList.remove('hidden');
  els.setupBanner.style.background = kind === 'error' ? '#fff0ef' : '#e9f7ff';
}

function renderStats() {
  els.accountValue.textContent = state.user ? `@${state.user.username}` : '—';
  els.countValue.textContent = String(state.items.length);
  els.newValue.textContent = String(state.newCount);
  els.sourceValue.textContent = state.source || '—';
  const label = state.lastError ? 'Error' : state.isRefreshing ? 'Syncing…' : state.lastRefresh ? 'Live' : 'Waiting';
  els.statusValue.textContent = label;
  els.refreshValue.textContent = state.lastRefresh ? fmtRel(state.lastRefresh) : '—';
  if (state.lastError) dot('error');
  else if (!state.health?.ready) dot('warn');
  else if (state.isRefreshing) dot('ok');
  else if (state.lastRefresh) dot('ok');
  else dot('idle');
}

function matchesFilter(item, f) {
  if (!f) return true;
  const h = [item.text, item.author?.name, item.author?.username].filter(Boolean).join(' ').toLowerCase();
  return h.includes(f.toLowerCase());
}

function renderFeed() {
  const filtered = state.items.filter(i => matchesFilter(i, state.filter));
  els.feed.replaceChildren();
  if (!filtered.length) {
    const e = document.createElement('p');
    e.className = 'empty';
    e.textContent = state.items.length ? 'No bookmarks match the search.' : 'No bookmarks loaded yet.';
    els.feed.appendChild(e);
    return;
  }
  const frag = document.createDocumentFragment();
  for (const item of filtered) frag.appendChild(renderTweet(item));
  els.feed.appendChild(frag);
}

function renderTweet(tweet) {
  const n = els.tweetTemplate.content.firstElementChild.cloneNode(true);
  const a = n.querySelector('.avatar');
  a.src = tweet.author?.profile_image_url || '';
  a.alt = tweet.author?.name || '';
  n.querySelector('.author-name').textContent = tweet.author?.name || 'Unknown';
  n.querySelector('.handle').textContent = tweet.author?.username ? `@${tweet.author.username}` : '';
  n.querySelector('.time').textContent = fmtDate(tweet.created_at);
  n.querySelector('.age').textContent = fmtRel(tweet.created_at);
  n.querySelector('.x-link').href = tweet.url;
  n.querySelector('.text').textContent = tweet.text || '';
  renderTranslateBtn(n.querySelector('.text'), tweet);

  const isNew = state.previousIds.size > 0 && !state.previousIds.has(tweet.id);
  n.querySelector('.new-marker').classList.toggle('hidden', !isNew);

  const tags = n.querySelector('.tags');
  const labels = { replied_to: 'Reply', quoted: 'Quote', retweeted: 'Repost' };
  const seen = new Set();
  for (const ref of tweet.referenced_tweets || []) {
    const l = labels[ref.type];
    if (l && !seen.has(l)) { seen.add(l); const t = document.createElement('span'); t.className = 'tag'; t.textContent = l; tags.appendChild(t); }
  }
  if (tweet.media?.length) { const t = document.createElement('span'); t.className = 'tag'; t.textContent = `${tweet.media.length} 📎`; tags.appendChild(t); }
  if (tweet.lang) { const t = document.createElement('span'); t.className = 'tag'; t.textContent = tweet.lang.toUpperCase(); tags.appendChild(t); }
  if (!tags.children.length) tags.style.display = 'none';

  const media = n.querySelector('.media');
  if (tweet.media?.length) {
    for (const m of tweet.media) {
      const d = document.createElement('div'); d.className = 'media-item';
      const img = document.createElement('img'); img.loading = 'lazy';
      img.alt = m.alt_text || ''; img.src = m.url || m.preview_image_url || '';
      if (img.src) { d.appendChild(img); media.appendChild(d); }
    }
  } else { media.remove(); }

  const metrics = n.querySelector('.metrics');
  const pm = tweet.public_metrics || {};
  const entries = [['💬', pm.reply_count], ['🔁', pm.retweet_count], ['❤️', pm.like_count], ['💭', pm.quote_count]].filter(([, v]) => typeof v === 'number');
  if (entries.length) for (const [l, v] of entries) { const s = document.createElement('span'); s.className = 'metric'; s.textContent = `${l} ${v}`; metrics.appendChild(s); }
  return n;
}

function updateState(payload) {
  state.previousIds = new Set(state.items.map(i => i.id));
  state.items = payload.items || [];
  state.user = payload.user || null;
  state.lastRefresh = payload.refreshed_at || new Date().toISOString();
  state.lastError = null;
  state.source = payload.source || '—';
  state.newCount = state.previousIds.size ? state.items.reduce((c, i) => c + (state.previousIds.has(i.id) ? 0 : 1), 0) : 0;

  // Save auto-refreshed tokens from server. X rotates refresh tokens on every refresh.
  if (payload.refreshed_token) setClientToken(payload.refreshed_token);
  if (payload.refreshed_refresh_token) setClientRefreshToken(payload.refreshed_refresh_token);
  if (payload.refreshed_token || payload.refreshed_refresh_token) tokenBanner('token auto-refreshed ✓');

  if (state.newCount > 0) banner(`${state.newCount} new`);
  else banner('');
  renderStats();
  renderFeed();
}

async function refresh() {
  state.isRefreshing = true;
  els.refreshBtn.disabled = true;
  renderStats();
  try {
    const token = getClientToken();
    const refreshToken = getClientRefreshToken();
    const headers = {};
    if (token) headers['X-Access-Token'] = token;
    if (refreshToken) headers['X-Refresh-Token'] = refreshToken;
    const r = await fetch(`/api/bookmarks?limit=50&t=${Date.now()}`, { cache: 'no-store', headers });
    const p = await r.json().catch(() => ({}));
    if (!r.ok || !p.ok) {
      const isAuth = p?.error?.is_auth_error || r.status === 401;
      if (isAuth) {
        banner(
          'Token expired. Generate a new one at developer.x.com → your app → User Auth → Generate → paste in ⚙ settings',
          'error'
        );
        tokenBanner('expired — paste new token in settings ⚙', 'error');
      }
      throw new Error(p?.error?.message || `HTTP ${r.status}`);
    }
    updateState(p);
  } catch (e) {
    state.lastError = e.message;
    if (!e.message.includes('Token expired')) banner(`Error: ${state.lastError}`, 'error');
  } finally {
    state.isRefreshing = false;
    els.refreshBtn.disabled = false;
    renderStats();
  }
}

async function checkHealth() {
  try {
    const r = await fetch(`/api/health?t=${Date.now()}`, { cache: 'no-store' });
    state.health = await r.json();
  } catch { state.health = { ok: false, ready: false }; }
  renderStats();
  if (!state.health?.ready) banner('Set X_ACCESS_TOKEN to start.', 'error');
}

function startInterval(ms) {
  if (state.intervalId) { clearInterval(state.intervalId); state.intervalId = null; }
  if (ms > 0) state.intervalId = setInterval(refresh, ms);
}

// ── Token UI ────────────────────────────────────────────────────
function tokenBanner(msg, kind) {
  if (!els.tokenStatus) return;
  els.tokenStatus.textContent = msg || '';
  els.tokenStatus.style.color = kind === 'error' ? '#b44852' : 'var(--muted)';
}

function saveToken() {
  const accessVal = els.tokenInput?.value?.trim() || '';
  const refreshVal = els.refreshTokenInput?.value?.trim() || '';
  if (!accessVal && !refreshVal) { tokenBanner('paste an access or refresh token first', 'error'); return; }
  if (accessVal) setClientToken(accessVal);
  if (refreshVal) setClientRefreshToken(refreshVal);
  if (els.tokenInput) els.tokenInput.value = '';
  if (els.refreshTokenInput) els.refreshTokenInput.value = '';
  tokenBanner(refreshVal ? 'saved with auto-refresh ✓' : 'access token saved ✓');
  setTimeout(() => { els.settingsOpen = false; els.settingsMenu.classList.add('hidden'); }, 800);
}

// Load saved token into the field indicator
document.addEventListener('DOMContentLoaded', () => {
  if (getClientToken() || getClientRefreshToken()) tokenBanner(getClientRefreshToken() ? 'auto-refresh token set ✓' : 'custom access token set ✓');
});

els.saveTokenBtn.addEventListener('click', saveToken);
els.tokenInput?.addEventListener('keydown', e => { if (e.key === 'Enter') saveToken(); });
els.refreshTokenInput?.addEventListener('keydown', e => { if (e.key === 'Enter') saveToken(); });

els.refreshBtn.addEventListener('click', refresh);
els.filterInput.addEventListener('input', e => { state.filter = e.target.value.trim(); renderFeed(); });
els.settingsBtn.addEventListener('click', () => {
  state.settingsOpen = !state.settingsOpen;
  els.settingsMenu.classList.toggle('hidden', !state.settingsOpen);
});
els.intervalSelect.addEventListener('change', () => {
  const v = parseInt(els.intervalSelect.value, 10);
  state.refreshInterval = v;
  startInterval(v);
});
document.addEventListener('click', e => {
  if (!e.target.closest('.settings-wrap')) {
    state.settingsOpen = false;
    els.settingsMenu.classList.add('hidden');
  }
});
document.addEventListener('keydown', e => {
  if (e.key === '/' && !e.metaKey && !e.ctrlKey && !(e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
    e.preventDefault(); els.filterInput.focus();
  }
});

renderStats();
renderFeed();
checkHealth().then(refresh);
