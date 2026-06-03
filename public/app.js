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
  tweetTemplate: document.getElementById('tweetTemplate'),
};

function fmtDate(v) {
  if (!v) return '';
  return new Date(v).toLocaleDateString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
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
    const r = await fetch(`/api/bookmarks?limit=50&t=${Date.now()}`, { cache: 'no-store' });
    const p = await r.json().catch(() => ({}));
    if (!r.ok || !p.ok) throw new Error(p?.error?.message || `HTTP ${r.status}`);
    updateState(p);
  } catch (e) {
    state.lastError = e.message;
    banner(`Error: ${state.lastError}`, 'error');
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
