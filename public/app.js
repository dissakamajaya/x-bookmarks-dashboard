const REFRESH_MS = 30000;
const POPULAR_THRESHOLD = 100;

const state = {
  items: [],
  user: null,
  lastRefresh: null,
  lastError: null,
  autoRefresh: true,
  filter: '',
  filterMode: 'all',
  newCount: 0,
  source: '—',
  health: null,
  isRefreshing: false,
  previousIds: new Set(),
};

const els = {
  accountValue: document.getElementById('accountValue'),
  accountSubtext: document.getElementById('accountSubtext'),
  countValue: document.getElementById('countValue'),
  countSubtext: document.getElementById('countSubtext'),
  refreshValue: document.getElementById('refreshValue'),
  statusValue: document.getElementById('statusValue'),
  sourceValue: document.getElementById('sourceValue'),
  newValue: document.getElementById('newValue'),
  newSubtext: document.getElementById('newSubtext'),
  readyValue: document.getElementById('readyValue'),
  nextPulseValue: document.getElementById('nextPulseValue'),
  nextRefreshValue: document.getElementById('nextRefreshValue'),
  lastUpdatedValue: document.getElementById('lastUpdatedValue'),
  resultsHeading: document.getElementById('resultsHeading'),
  resultsMeta: document.getElementById('resultsMeta'),
  liveChip: document.getElementById('liveChip'),
  setupBanner: document.getElementById('setupBanner'),
  feed: document.getElementById('feed'),
  refreshBtn: document.getElementById('refreshBtn'),
  toggleBtn: document.getElementById('toggleBtn'),
  filterInput: document.getElementById('filterInput'),
  clearFilterBtn: document.getElementById('clearFilterBtn'),
  quickFilters: document.getElementById('quickFilters'),
  tweetTemplate: document.getElementById('tweetTemplate'),
};

function fmtDate(value) {
  if (!value) return 'Unknown time';
  const date = new Date(value);
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function fmtRelative(value) {
  if (!value) return 'just now';
  const diff = Date.now() - new Date(value).getTime();
  const mins = Math.round(diff / 60000);
  if (Math.abs(mins) < 1) return 'just now';
  if (Math.abs(mins) < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (Math.abs(hours) < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function escapeText(text) {
  return String(text || '');
}

function totalEngagement(tweet) {
  const metrics = tweet.public_metrics || {};
  return (metrics.reply_count || 0) + (metrics.retweet_count || 0) + (metrics.like_count || 0) + (metrics.quote_count || 0);
}

function matchesTextFilter(item, filter) {
  if (!filter) return true;
  const haystack = [
    item.text,
    item.author?.name,
    item.author?.username,
    item.public_metrics ? Object.values(item.public_metrics).join(' ') : '',
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(filter.toLowerCase());
}

function matchesModeFilter(item, mode) {
  if (mode === 'media') return Boolean(item.media?.length);
  if (mode === 'notes') return !item.media?.length;
  if (mode === 'popular') return totalEngagement(item) >= POPULAR_THRESHOLD;
  return true;
}

function getFilteredItems() {
  return state.items.filter((item) => matchesTextFilter(item, state.filter) && matchesModeFilter(item, state.filterMode));
}

function renderBanner(message, kind = 'info') {
  if (!message) {
    els.setupBanner.classList.add('hidden');
    els.setupBanner.textContent = '';
    els.setupBanner.classList.remove('error');
    return;
  }

  els.setupBanner.textContent = message;
  els.setupBanner.classList.remove('hidden');
  els.setupBanner.classList.toggle('error', kind === 'error');
}

function setLiveChip(text, kind) {
  els.liveChip.textContent = text;
  els.liveChip.className = `live-chip live-chip-${kind}`;
}

function renderHealth() {
  if (!state.health) {
    els.readyValue.textContent = 'Checking…';
    return;
  }

  if (state.health.ready) {
    els.readyValue.textContent = 'Token configured';
  } else {
    els.readyValue.textContent = 'Setup needed';
  }
}

function renderFilterControls() {
  els.clearFilterBtn.classList.toggle('hidden', !state.filter);
  for (const button of els.quickFilters.querySelectorAll('[data-filter-mode]')) {
    const active = button.dataset.filterMode === state.filterMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
}

function renderStats() {
  const filtered = getFilteredItems();
  const hasActiveFilters = Boolean(state.filter) || state.filterMode !== 'all';
  const ready = Boolean(state.health?.ready);
  const paused = !state.autoRefresh;
  const statusLabel = state.lastError ? 'Needs attention' : paused ? 'Paused' : state.isRefreshing ? 'Syncing…' : 'Live';

  els.accountValue.textContent = state.user
    ? `@${state.user.username || 'me'}`
    : ready
      ? 'Waiting for account…'
      : 'Not configured';
  els.accountSubtext.textContent = state.user?.name
    ? state.user.name
    : ready
      ? 'Authenticated session detected'
      : 'Add your X token in the environment';
  els.countValue.textContent = String(filtered.length);
  els.countSubtext.textContent = hasActiveFilters
    ? `${state.items.length} total in the full queue`
    : 'Visible in your queue';
  els.refreshValue.textContent = state.lastRefresh ? `Last sync ${fmtRelative(state.lastRefresh)}` : 'Waiting for first sync';
  els.statusValue.textContent = statusLabel;
  els.sourceValue.textContent = state.source || '—';
  els.newValue.textContent = String(state.newCount);
  els.newSubtext.textContent =
    state.newCount > 0 ? 'Highlighted with an accent rail in the feed' : 'No new bookmarks in the latest sync';
  els.toggleBtn.textContent = state.autoRefresh ? 'Pause auto refresh' : 'Resume auto refresh';
  els.nextPulseValue.textContent = state.autoRefresh ? 'Within 30 seconds' : 'Manual refresh only';
  els.nextRefreshValue.textContent = state.autoRefresh ? 'Auto refresh every 30s' : 'Auto refresh paused';
  els.lastUpdatedValue.textContent = state.lastRefresh ? `Updated ${fmtDate(state.lastRefresh)}` : 'No completed sync yet';

  if (state.lastError) {
    setLiveChip('API needs attention', 'error');
  } else if (!ready) {
    setLiveChip('Configuration needed', 'warn');
  } else if (paused) {
    setLiveChip('Auto refresh paused', 'warn');
  } else if (state.isRefreshing) {
    setLiveChip('Refreshing queue', 'ok');
  } else if (state.lastRefresh) {
    setLiveChip('Live bookmark stream', 'ok');
  } else {
    setLiveChip('Waiting for first sync', 'idle');
  }
}

function renderTweet(tweet) {
  const node = els.tweetTemplate.content.firstElementChild.cloneNode(true);
  const avatar = node.querySelector('.avatar');
  const name = node.querySelector('.author-name');
  const handle = node.querySelector('.author-handle');
  const time = node.querySelector('.tweet-time');
  const age = node.querySelector('.tweet-age');
  const link = node.querySelector('.tweet-link');
  const text = node.querySelector('.tweet-text');
  const tags = node.querySelector('.tweet-tags');
  const media = node.querySelector('.tweet-media');
  const metrics = node.querySelector('.metrics');
  const id = node.querySelector('.tweet-id');
  const newMarker = node.querySelector('.new-marker');
  const isNew = state.previousIds.size > 0 && !state.previousIds.has(tweet.id);

  if (tweet.author?.profile_image_url) {
    avatar.src = tweet.author.profile_image_url;
  } else {
    avatar.removeAttribute('src');
  }
  avatar.alt = tweet.author?.name || tweet.author?.username || 'Author avatar';

  name.textContent = tweet.author?.name || 'Unknown author';
  handle.textContent = tweet.author?.username ? `@${tweet.author.username}` : '@unknown';
  time.textContent = fmtDate(tweet.created_at);
  age.textContent = fmtRelative(tweet.created_at);
  link.href = tweet.url;
  text.textContent = escapeText(tweet.text);
  id.textContent = `ID ${tweet.id}`;

  node.classList.toggle('is-new', isNew);
  newMarker.classList.toggle('hidden', !isNew);

  const labelMap = new Map([
    ['replied_to', 'Reply'],
    ['quoted', 'Quote'],
    ['retweeted', 'Repost'],
  ]);
  const seenLabels = new Set();
  for (const ref of tweet.referenced_tweets || []) {
    const label = labelMap.get(ref.type);
    if (!label || seenLabels.has(label)) continue;
    seenLabels.add(label);
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = label;
    tags.appendChild(tag);
  }

  if (tweet.media?.length) {
    const mediaTag = document.createElement('span');
    mediaTag.className = 'tag';
    mediaTag.textContent = `${tweet.media.length} media`;
    tags.appendChild(mediaTag);
  }

  if (tweet.possibly_sensitive) {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = 'Sensitive';
    tags.appendChild(tag);
  }

  if (tweet.lang) {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = tweet.lang.toUpperCase();
    tags.appendChild(tag);
  }

  if (totalEngagement(tweet) >= POPULAR_THRESHOLD) {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = 'Popular';
    tags.appendChild(tag);
  }

  if (!tags.children.length) {
    tags.style.display = 'none';
  }

  if (tweet.media?.length) {
    for (const item of tweet.media) {
      const mediaItem = document.createElement('div');
      mediaItem.className = 'media-item';
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.alt = item.alt_text || `${item.type || 'media'} from X`;
      img.src = item.url || item.preview_image_url || '';
      if (!img.src) continue;
      mediaItem.appendChild(img);
      media.appendChild(mediaItem);
    }
  } else {
    media.remove();
  }

  const metricsList = tweet.public_metrics || {};
  const metricEntries = [
    ['Replies', metricsList.reply_count],
    ['Reposts', metricsList.retweet_count],
    ['Likes', metricsList.like_count],
    ['Quotes', metricsList.quote_count],
  ].filter(([, value]) => typeof value === 'number');

  if (metricEntries.length) {
    for (const [label, value] of metricEntries) {
      const metric = document.createElement('span');
      metric.className = 'metric';
      metric.textContent = `${label} ${value}`;
      metrics.appendChild(metric);
    }
  } else {
    metrics.textContent = 'No metrics available';
  }

  return node;
}

function renderFeed() {
  const filtered = getFilteredItems();
  els.feed.replaceChildren();

  els.resultsHeading.textContent = state.filterMode === 'all' ? 'Latest bookmarks' : `Latest bookmarks · ${state.filterMode}`;
  if (!state.items.length) {
    els.resultsMeta.textContent = 'No bookmarks loaded yet.';
  } else if (!filtered.length) {
    els.resultsMeta.textContent = 'No bookmarks match the current view.';
  } else {
    els.resultsMeta.textContent = `${filtered.length} showing of ${state.items.length}`;
  }

  if (!filtered.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = state.items.length
      ? 'No bookmarks match this search or quick view. Clear the filters to return to the full queue.'
      : 'No bookmarks loaded yet. Run the first sync after your X token is configured.';
    els.feed.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const item of filtered) {
    fragment.appendChild(renderTweet(item));
  }
  els.feed.appendChild(fragment);
}

function updateState(payload) {
  state.previousIds = new Set(state.items.map((item) => item.id));
  state.items = payload.items || [];
  state.user = payload.user || null;
  state.lastRefresh = payload.refreshed_at || new Date().toISOString();
  state.lastError = null;
  state.source = payload.source || '—';
  state.newCount = state.previousIds.size
    ? state.items.reduce((count, item) => count + (state.previousIds.has(item.id) ? 0 : 1), 0)
    : 0;

  renderBanner(state.newCount > 0 ? `${state.newCount} new bookmark${state.newCount === 1 ? '' : 's'} moved to the top of the queue.` : '');
  renderFilterControls();
  renderStats();
  renderFeed();
}

async function refreshHealth() {
  try {
    const response = await fetch(`/api/health?t=${Date.now()}`, { cache: 'no-store' });
    const payload = await response.json();
    state.health = payload;
  } catch {
    state.health = {
      ok: false,
      ready: false,
    };
  }

  renderHealth();
  renderStats();

  if (!state.health?.ready) {
    renderBanner('Configuration needed: set X_ACCESS_TOKEN first. If /2/users/me is unavailable, also set X_USER_ID or X_USERNAME.');
  }
}

async function refresh() {
  state.isRefreshing = true;
  els.refreshBtn.disabled = true;
  els.refreshBtn.textContent = 'Refreshing…';
  renderStats();

  try {
    const response = await fetch(`/api/bookmarks?limit=50&t=${Date.now()}`, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' },
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) {
      const message = payload?.error?.message || `Request failed with ${response.status}`;
      throw new Error(message);
    }

    updateState(payload);
  } catch (error) {
    state.lastError = error.message || 'Unknown error';
    renderBanner(
      `API error: ${state.lastError}. If the token is valid but /2/users/me is unavailable, set X_USER_ID in the environment.`,
      'error'
    );
  } finally {
    state.isRefreshing = false;
    els.refreshBtn.disabled = false;
    els.refreshBtn.textContent = 'Refresh now';
    renderStats();
    renderFeed();
  }
}

function setFilterMode(mode) {
  state.filterMode = mode;
  renderFilterControls();
  renderStats();
  renderFeed();
}

els.refreshBtn.addEventListener('click', refresh);
els.toggleBtn.addEventListener('click', () => {
  state.autoRefresh = !state.autoRefresh;
  renderStats();
  renderBanner(state.autoRefresh ? 'Auto refresh resumed. New bookmarks will be highlighted when the next sync completes.' : 'Auto refresh paused. Use Refresh now to sync manually.');
});
els.filterInput.addEventListener('input', (event) => {
  state.filter = event.target.value.trim();
  renderFilterControls();
  renderStats();
  renderFeed();
});
els.clearFilterBtn.addEventListener('click', () => {
  state.filter = '';
  els.filterInput.value = '';
  renderFilterControls();
  renderStats();
  renderFeed();
  els.filterInput.focus();
});
els.quickFilters.addEventListener('click', (event) => {
  const button = event.target.closest('[data-filter-mode]');
  if (!button) return;
  setFilterMode(button.dataset.filterMode);
});

document.addEventListener('keydown', (event) => {
  if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
  const target = event.target;
  if (target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
    return;
  }
  event.preventDefault();
  els.filterInput.focus();
  els.filterInput.select();
});

renderFilterControls();
renderHealth();
renderStats();
renderFeed();
refreshHealth().then(refresh);

setInterval(() => {
  renderStats();
}, 60000);

setInterval(() => {
  if (state.autoRefresh) {
    refresh();
  }
}, REFRESH_MS);
