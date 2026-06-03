const state = {
  items: [],
  user: null,
  lastRefresh: null,
  lastError: null,
  autoRefresh: true,
  filter: '',
  newCount: 0,
  source: '—',
};

const els = {
  accountValue: document.getElementById('accountValue'),
  countValue: document.getElementById('countValue'),
  refreshValue: document.getElementById('refreshValue'),
  statusValue: document.getElementById('statusValue'),
  sourceValue: document.getElementById('sourceValue'),
  newValue: document.getElementById('newValue'),
  setupBanner: document.getElementById('setupBanner'),
  feed: document.getElementById('feed'),
  refreshBtn: document.getElementById('refreshBtn'),
  toggleBtn: document.getElementById('toggleBtn'),
  filterInput: document.getElementById('filterInput'),
  tweetTemplate: document.getElementById('tweetTemplate'),
};

const REFRESH_MS = 30000;

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

function buildAuthorLabel(user) {
  if (!user) return 'Unknown author';
  return `${user.name || user.username || 'Unknown'} @${user.username || 'unknown'}`;
}

function matchesFilter(item, filter) {
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

function renderStats() {
  els.accountValue.textContent = state.user
    ? `@${state.user.username || 'me'}${state.user.name ? ` · ${state.user.name}` : ''}`
    : 'Loading…';
  els.countValue.textContent = String(state.items.length);
  els.refreshValue.textContent = state.lastRefresh ? fmtRelative(state.lastRefresh) : 'Waiting…';
  els.statusValue.textContent = state.lastError ? 'Needs attention' : state.autoRefresh ? 'Live' : 'Paused';
  els.sourceValue.textContent = `Source: ${state.source || '—'}`;
  els.newValue.textContent = `${state.newCount} new since last refresh`;
  els.toggleBtn.textContent = state.autoRefresh ? 'Pause auto refresh' : 'Resume auto refresh';
}

function renderTweet(tweet) {
  const node = els.tweetTemplate.content.firstElementChild.cloneNode(true);
  const avatar = node.querySelector('.avatar');
  const name = node.querySelector('.author-name');
  const handle = node.querySelector('.author-handle');
  const time = node.querySelector('.tweet-time');
  const link = node.querySelector('.tweet-link');
  const text = node.querySelector('.tweet-text');
  const tags = node.querySelector('.tweet-tags');
  const media = node.querySelector('.tweet-media');
  const footer = node.querySelector('.tweet-footer');
  const metrics = node.querySelector('.metrics');
  const id = node.querySelector('.tweet-id');

  if (tweet.author?.profile_image_url) {
    avatar.src = tweet.author.profile_image_url;
  } else {
    avatar.removeAttribute('src');
  }
  avatar.alt = tweet.author?.name || tweet.author?.username || 'Author avatar';

  name.textContent = tweet.author?.name || 'Unknown author';
  handle.textContent = tweet.author?.username ? `@${tweet.author.username}` : '@unknown';
  time.textContent = fmtDate(tweet.created_at);
  link.href = tweet.url;
  text.textContent = escapeText(tweet.text);
  id.textContent = tweet.id;

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
      if (!img.src) {
        continue;
      }
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
      metric.textContent = `${label}: ${value}`;
      metrics.appendChild(metric);
    }
  } else {
    metrics.textContent = 'No metrics available';
  }

  footer.dataset.tweetId = tweet.id;
  return node;
}

function renderFeed() {
  const filtered = state.items.filter((item) => matchesFilter(item, state.filter));
  els.feed.replaceChildren();

  if (!filtered.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = state.items.length ? 'No bookmarks match the current filter.' : 'No bookmarks loaded yet.';
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
  const previousIds = new Set(state.items.map((item) => item.id));
  state.items = payload.items || [];
  state.user = payload.user || null;
  state.lastRefresh = payload.refreshed_at || new Date().toISOString();
  state.lastError = null;
  state.source = payload.source || '—';
  state.newCount = previousIds.size ? state.items.reduce((count, item) => count + (previousIds.has(item.id) ? 0 : 1), 0) : 0;

  renderBanner('', 'info');
  renderStats();
  renderFeed();

  if (state.newCount > 0) {
    renderBanner(`${state.newCount} new bookmark${state.newCount === 1 ? '' : 's'} found on the latest refresh.`);
  }
}

async function refresh() {
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
    renderStats();
    renderBanner(
      `API error: ${state.lastError}. If the token is valid but /2/users/me is unavailable, set X_USER_ID in the environment.`,
      'error'
    );
  } finally {
    els.refreshBtn.disabled = false;
    els.refreshBtn.textContent = 'Refresh now';
    renderStats();
  }
}

els.refreshBtn.addEventListener('click', refresh);
els.toggleBtn.addEventListener('click', () => {
  state.autoRefresh = !state.autoRefresh;
  renderStats();
  renderBanner(state.autoRefresh ? 'Auto refresh resumed.' : 'Auto refresh paused.');
});
els.filterInput.addEventListener('input', (event) => {
  state.filter = event.target.value.trim();
  renderFeed();
});

renderStats();
renderFeed();
refresh();
setInterval(() => {
  if (state.autoRefresh) {
    refresh();
  }
}, REFRESH_MS);
