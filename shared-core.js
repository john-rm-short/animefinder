/* ==========================================================================
   AnimeFinder Web Suite — shared-core.js
   Unified storage, IndexedDB cache, GitHub Gist auto-sync with tombstones,
   AniList GraphQL client, 3-layer live-taxonomy Find Vibe, 11-platform
   normalization, multi-source enrichment, and accessible Detail Modal.
   ========================================================================== */

(function (global) {
  'use strict';

  const STATE_KEY = 'animefinder_state_v1';
  const DB_NAME = 'AnimeFinderCacheDB';
  const DB_VERSION = 2;
  const GIST_FILENAME = 'animefinder-sync.json';
  const LEGACY_GIST_FILENAME = 'animefinder-state.json';

  const TTL_DYNAMIC = 20 * 60 * 1000;      // 20 min for live feeds
  const TTL_STABLE = 24 * 60 * 60 * 1000;  // 24 hours for taxonomy & metadata

  const WATCHLIST_STATUSES = [
    'Watching',
    'Plan to Watch',
    'Completed',
    'On Hold',
    'Dropped'
  ];

  const DUB_OPTIONS = ['', 'Dubbed', 'Simuldub', 'Sub Only'];

  // Centralized 11-platform registry resolving Crunchyroll/HIDIVE bias
  const PLATFORM_CONFIG = [
    {
      id: 'crunchyroll',
      name: 'Crunchyroll',
      licensedBy: 'Crunchyroll',
      aliases: ['crunchyroll', 'funimation'],
      domains: ['crunchyroll.com', 'funimation.com'],
      color: '#f97316',
      freeWithAds: false,
      dubLikely: true
    },
    {
      id: 'hidive',
      name: 'HIDIVE',
      licensedBy: 'HIDIVE',
      aliases: ['hidive', 'sentai'],
      domains: ['hidive.com'],
      color: '#38bdf8',
      freeWithAds: false,
      dubLikely: true
    },
    {
      id: 'netflix',
      name: 'Netflix',
      licensedBy: 'Netflix',
      aliases: ['netflix'],
      domains: ['netflix.com'],
      color: '#ef4444',
      freeWithAds: false,
      dubLikely: true
    },
    {
      id: 'prime',
      name: 'Prime Video',
      licensedBy: 'Amazon Prime Video',
      aliases: ['amazon', 'prime video', 'amazon prime video', 'amazon video'],
      domains: ['amazon.com', 'primevideo.com'],
      color: '#60a5fa',
      freeWithAds: false,
      dubLikely: false
    },
    {
      id: 'hulu',
      name: 'Hulu',
      licensedBy: 'Hulu',
      aliases: ['hulu'],
      domains: ['hulu.com'],
      color: '#34d399',
      freeWithAds: false,
      dubLikely: true
    },
    {
      id: 'disney',
      name: 'Disney+',
      licensedBy: 'Disney Plus',
      aliases: ['disney+', 'disney plus', 'disneyplus', 'star+'],
      domains: ['disneyplus.com'],
      color: '#818cf8',
      freeWithAds: false,
      dubLikely: true
    },
    {
      id: 'tubi',
      name: 'Tubi',
      licensedBy: 'Tubi TV',
      aliases: ['tubi', 'tubi tv'],
      domains: ['tubitv.com'],
      color: '#c084fc',
      freeWithAds: true,
      dubLikely: false
    },
    {
      id: 'retrocrush',
      name: 'RetroCrush',
      licensedBy: 'RetroCrush',
      aliases: ['retrocrush', 'retro crush'],
      domains: ['retrocrush.tv'],
      color: '#fb7185',
      freeWithAds: true,
      dubLikely: false
    },
    {
      id: 'pluto',
      name: 'Pluto TV',
      licensedBy: 'Pluto TV',
      aliases: ['pluto', 'pluto tv'],
      domains: ['pluto.tv'],
      color: '#fbbf24',
      freeWithAds: true,
      dubLikely: false
    },
    {
      id: 'youtube',
      name: 'YouTube',
      licensedBy: 'YouTube',
      aliases: ['youtube', 'muse asia', 'ani-one', 'gundaminfo'],
      domains: ['youtube.com', 'youtu.be'],
      color: '#f87171',
      freeWithAds: true,
      dubLikely: false
    },
    {
      id: 'oceanveil',
      name: 'OceanVeil',
      licensedBy: 'OceanVeil',
      aliases: ['oceanveil', 'ocean veil'],
      domains: ['oceanveil.net'],
      color: '#2dd4bf',
      freeWithAds: false,
      dubLikely: false
    }
  ];

  const PLATFORM_BY_ID = Object.fromEntries(PLATFORM_CONFIG.map(p => [p.id, p]));

  // --------------------------------------------------------------------------
  // Utilities
  // --------------------------------------------------------------------------
  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function stripHtml(html) {
    if (!html) return '';
    return String(html)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&quot;/g, '"')
      .replace(/&#039;|&apos;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function getDisplayTitle(anime) {
    if (!anime) return 'Untitled';
    if (typeof anime.title === 'string') return anime.title;
    return anime.title?.english || anime.title?.romaji || anime.title?.native || 'Untitled';
  }

  function getCover(anime) {
    if (!anime) return '';
    if (typeof anime.cover === 'string') return anime.cover;
    return anime.coverImage?.large || anime.coverImage?.extraLarge || anime.coverImage?.medium || '';
  }

  function normalizeStatus(status) {
    if (!status) return 'Plan to Watch';
    const s = String(status).trim();
    if (s.toLowerCase() === 'paused' || s.toLowerCase() === 'on hold') return 'On Hold';
    if (s.toLowerCase() === 'current' || s.toLowerCase() === 'watching' || s.toLowerCase() === 'repeating') return 'Watching';
    if (s.toLowerCase() === 'planning' || s.toLowerCase() === 'plan to watch') return 'Plan to Watch';
    if (s.toLowerCase() === 'completed') return 'Completed';
    if (s.toLowerCase() === 'dropped') return 'Dropped';
    return WATCHLIST_STATUSES.includes(s) ? s : 'Plan to Watch';
  }

  function formatCompactNumber(n) {
    if (!n && n !== 0) return '—';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return String(n);
  }

  function formatRelativeCountdown(unixSec) {
    const diffSec = unixSec - Math.floor(Date.now() / 1000);
    const abs = Math.abs(diffSec);
    const hrs = Math.floor(abs / 3600);
    const mins = Math.floor((abs % 3600) / 60);
    if (diffSec <= 0) {
      if (hrs < 1) return `${Math.max(1, mins)}m ago`;
      if (hrs < 24) return `${hrs}h ago`;
      const days = Math.floor(hrs / 24);
      return `${days}d ${hrs % 24}h ago`;
    }
    if (hrs < 1) return `in ${Math.max(1, mins)}m`;
    if (hrs < 24) return `in ${hrs}h ${mins}m`;
    const days = Math.floor(hrs / 24);
    return `in ${days}d ${hrs % 24}h`;
  }

  function toast(message, type = 'info', duration = 3400) {
    let stack = document.getElementById('af-toast-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.id = 'af-toast-stack';
      stack.className = 'toast-stack';
      stack.setAttribute('aria-live', 'polite');
      document.body.appendChild(stack);
    }
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    stack.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity 0.25s';
      setTimeout(() => el.remove(), 260);
    }, duration);
  }

  // Modern UTF-8 safe Base64 codec (P1: TextEncoder / TextDecoder)
  function encodeBase64Utf8(str) {
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function decodeBase64Utf8(b64) {
    const binary = atob(b64.trim());
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  }

  // --------------------------------------------------------------------------
  // Shared IndexedDB Cache (AnimeFinderCacheDB v2: apiCache + vectors)
  // --------------------------------------------------------------------------
  let dbPromise = null;

  function openCacheDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      if (!('indexedDB' in global)) {
        resolve(null);
        return;
      }
      try {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (ev) => {
          const db = ev.target.result;
          if (!db.objectStoreNames.contains('apiCache')) {
            db.createObjectStore('apiCache', { keyPath: 'key' });
          }
          if (!db.objectStoreNames.contains('vectors')) {
            db.createObjectStore('vectors', { keyPath: 'id' });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    return dbPromise;
  }

  function isEmptyCachePayload(data) {
    if (data == null) return true;
    if (Array.isArray(data) && data.length === 0) return true;
    if (typeof data === 'object' && Object.keys(data).length === 0) return true;
    return false;
  }

  async function cacheGet(key) {
    const db = await openCacheDB();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction('apiCache', 'readonly');
        const req = tx.objectStore('apiCache').get(key);
        req.onsuccess = () => {
          const rec = req.result;
          if (!rec) return resolve(null);
          if (rec.ttl && Date.now() - rec.ts > rec.ttl) {
            return resolve(null);
          }
          resolve(rec.data);
        };
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  async function cacheSet(key, data, ttl = TTL_DYNAMIC) {
    if (isEmptyCachePayload(data)) return false; // Never poison cache with empty/failed responses
    const db = await openCacheDB();
    if (!db) return false;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction('apiCache', 'readwrite');
        tx.objectStore('apiCache').put({ key, data, ts: Date.now(), ttl });
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  }

  async function vectorGet(id) {
    const db = await openCacheDB();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction('vectors', 'readonly');
        const req = tx.objectStore('vectors').get(Number(id));
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  async function vectorSet(id, vector, textHash) {
    if (!vector || !vector.length) return false;
    const db = await openCacheDB();
    if (!db) return false;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction('vectors', 'readwrite');
        tx.objectStore('vectors').put({
          id: Number(id),
          vector: Array.from(vector),
          textHash: textHash || '',
          ts: Date.now()
        });
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  }

  async function cacheStats() {
    const db = await openCacheDB();
    if (!db) return { apiCount: 0, vectorCount: 0 };
    const countStore = (name) => new Promise((resolve) => {
      try {
        const tx = db.transaction(name, 'readonly');
        const req = tx.objectStore(name).count();
        req.onsuccess = () => resolve(req.result || 0);
        req.onerror = () => resolve(0);
      } catch {
        resolve(0);
      }
    });
    const [apiCount, vectorCount] = await Promise.all([countStore('apiCache'), countStore('vectors')]);
    return { apiCount, vectorCount };
  }

  async function cacheClear(clearVectors = false) {
    const db = await openCacheDB();
    if (!db) return;
    const stores = clearVectors ? ['apiCache', 'vectors'] : ['apiCache'];
    await Promise.all(stores.map((name) => new Promise((resolve) => {
      try {
        const tx = db.transaction(name, 'readwrite');
        tx.objectStore(name).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    })));
  }

  // --------------------------------------------------------------------------
  // Shared localStorage State + Non-Destructive Save + Tombstone Conflict Merge
  // --------------------------------------------------------------------------
  const stateListeners = new Set();
  const syncStatusListeners = new Set();
  let currentSyncStatus = { state: 'local', label: 'Local Storage' };
  let gistPushTimer = null;

  function defaultState() {
    return {
      version: 2,
      updatedAt: 0,
      watchlist: {},
      tombstones: {},
      overrides: {},
      settings: {
        tmdbKey: '',
        gistToken: '',
        gistId: '',
        gistFilename: GIST_FILENAME,
        gistAutoSync: true,
        lastGistSync: 0,
        anilistUsername: ''
      }
    };
  }

  function readRawState() {
    try {
      const raw = localStorage.getItem(STATE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function sanitizeState(raw) {
    const base = defaultState();
    const out = { ...raw };
    out.version = 2;
    out.updatedAt = Number(raw.updatedAt) || 0;
    out.watchlist = {};
    if (raw.watchlist && typeof raw.watchlist === 'object') {
      for (const [k, item] of Object.entries(raw.watchlist)) {
        if (!item || typeof item !== 'object') continue;
        const id = Number(item.id || k);
        if (!id) continue;
        out.watchlist[id] = {
          id,
          title: item.title || 'Untitled',
          cover: item.cover || '',
          format: item.format || '',
          episodes: item.episodes ?? null,
          averageScore: item.averageScore ?? null,
          popularity: item.popularity ?? null,
          seasonYear: item.seasonYear ?? null,
          genres: Array.isArray(item.genres) ? item.genres : [],
          status: normalizeStatus(item.status),
          rating: Number(item.rating) || 0,
          progress: Math.max(0, Number(item.progress) || 0),
          notes: typeof item.notes === 'string' ? item.notes : '',
          dubOverride: item.dubOverride || '',
          customPlatforms: Array.isArray(item.customPlatforms) ? item.customPlatforms : [],
          customFreeWithAds: Boolean(item.customFreeWithAds),
          updatedAt: Number(item.updatedAt) || out.updatedAt || Date.now()
        };
      }
    }
    out.tombstones = (raw.tombstones && typeof raw.tombstones === 'object') ? { ...raw.tombstones } : {};
    out.overrides = (raw.overrides && typeof raw.overrides === 'object') ? { ...raw.overrides } : {};

    // Harmonize legacy gistConfig / gist shapes if present
    const legacyGist = raw.gistConfig || raw.gist || {};
    out.settings = {
      ...base.settings,
      ...(raw.settings || {}),
      gistToken: (raw.settings?.gistToken ?? legacyGist.token ?? ''),
      gistId: (raw.settings?.gistId ?? legacyGist.gistId ?? legacyGist.id ?? ''),
      gistFilename: GIST_FILENAME,
      gistAutoSync: raw.settings?.gistAutoSync !== undefined ? Boolean(raw.settings.gistAutoSync) : true,
      tmdbKey: raw.settings?.tmdbKey ?? raw.tmdbKey ?? '',
      lastGistSync: Number(raw.settings?.lastGistSync || 0),
      anilistUsername: raw.settings?.anilistUsername || ''
    };
    return out;
  }

  function getState() {
    return sanitizeState(readRawState());
  }

  // Non-destructive save: preserves any unknown keys already stored by extensions/tabs
  function saveState(nextState, { triggerGist = false, notify = true } = {}) {
    const existingRaw = readRawState();
    const merged = {
      ...existingRaw,
      ...nextState,
      version: 2,
      updatedAt: Date.now()
    };
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(merged));
    } catch (e) {
      console.error('Failed saving state:', e);
      toast('Storage quota exceeded — consider exporting a JSON backup.', 'error');
    }
    const clean = sanitizeState(merged);
    if (notify) {
      stateListeners.forEach(fn => {
        try { fn(clean); } catch (err) { console.error(err); }
      });
    }
    updateNavBadges(clean);
    if (triggerGist) {
      scheduleGistAutoPush();
    }
    return clean;
  }

  function onStateChange(fn) {
    stateListeners.add(fn);
    return () => stateListeners.delete(fn);
  }

  function setSyncStatus(state, label) {
    currentSyncStatus = { state, label };
    syncStatusListeners.forEach(fn => {
      try { fn(currentSyncStatus); } catch {}
    });
    const pill = document.getElementById('af-sync-pill');
    if (pill) {
      pill.dataset.state = state;
      const textEl = pill.querySelector('.sync-label');
      if (textEl) textEl.textContent = label;
    }
  }

  function onSyncStatus(fn) {
    syncStatusListeners.add(fn);
    fn(currentSyncStatus);
    return () => syncStatusListeners.delete(fn);
  }

  // Live cross-tab storage event listener (P0)
  global.addEventListener('storage', (ev) => {
    if (ev.key === STATE_KEY) {
      const clean = getState();
      updateNavBadges(clean);
      stateListeners.forEach(fn => {
        try { fn(clean); } catch (err) { console.error(err); }
      });
    }
  });

  // Watchlist & Override Mutations
  function upsertWatchlistItem(anime, patch = {}) {
    const state = getState();
    const id = Number(anime?.id || patch.id);
    if (!id) return null;
    const prev = state.watchlist[id] || {};
    const prevOvr = state.overrides[id] || {};
    const now = Date.now();
    const nextItem = {
      id,
      title: getDisplayTitle(anime) || prev.title || 'Untitled',
      cover: getCover(anime) || prev.cover || '',
      format: anime?.format || prev.format || '',
      episodes: anime?.episodes ?? prev.episodes ?? null,
      averageScore: anime?.averageScore ?? prev.averageScore ?? null,
      popularity: anime?.popularity ?? prev.popularity ?? null,
      seasonYear: anime?.seasonYear ?? prev.seasonYear ?? null,
      genres: Array.isArray(anime?.genres) && anime.genres.length ? anime.genres : (prev.genres || []),
      status: normalizeStatus(patch.status ?? prev.status ?? 'Plan to Watch'),
      rating: patch.rating !== undefined ? Number(patch.rating) : (prev.rating || 0),
      progress: patch.progress !== undefined ? Math.max(0, Number(patch.progress)) : (prev.progress || 0),
      notes: patch.notes !== undefined ? String(patch.notes) : (prev.notes || ''),
      dubOverride: patch.dubOverride !== undefined ? patch.dubOverride : (prev.dubOverride ?? prevOvr.dubOverride ?? ''),
      customPlatforms: patch.customPlatforms !== undefined ? patch.customPlatforms : (prev.customPlatforms ?? prevOvr.customPlatforms ?? []),
      customFreeWithAds: patch.customFreeWithAds !== undefined ? Boolean(patch.customFreeWithAds) : Boolean(prev.customFreeWithAds ?? prevOvr.customFreeWithAds),
      updatedAt: now
    };

    state.watchlist[id] = nextItem;
    delete state.tombstones[id]; // Revive if previously tombstoned

    // Mirror overrides cleanly
    state.overrides[id] = {
      dubOverride: nextItem.dubOverride,
      customPlatforms: nextItem.customPlatforms,
      customFreeWithAds: nextItem.customFreeWithAds,
      updatedAt: now
    };

    saveState(state, { triggerGist: true });
    return nextItem;
  }

  function removeWatchlistItem(animeId) {
    const state = getState();
    const id = Number(animeId);
    if (!id) return;
    delete state.watchlist[id];
    state.tombstones[id] = Date.now(); // P1 per-record deletion tombstone
    saveState(state, { triggerGist: true });
  }

  function updateOverrides(animeId, patch = {}) {
    const state = getState();
    const id = Number(animeId);
    if (!id) return;
    const now = Date.now();
    const prev = state.overrides[id] || {};
    const next = {
      dubOverride: patch.dubOverride !== undefined ? patch.dubOverride : (prev.dubOverride || ''),
      customPlatforms: patch.customPlatforms !== undefined ? patch.customPlatforms : (prev.customPlatforms || []),
      customFreeWithAds: patch.customFreeWithAds !== undefined ? Boolean(patch.customFreeWithAds) : Boolean(prev.customFreeWithAds),
      updatedAt: now
    };
    state.overrides[id] = next;
    if (state.watchlist[id]) {
      state.watchlist[id] = { ...state.watchlist[id], ...next, updatedAt: now };
    }
    saveState(state, { triggerGist: true });
  }

  function updateSettings(patch) {
    const state = getState();
    state.settings = {
      ...state.settings,
      ...patch,
      gistFilename: GIST_FILENAME
    };
    saveState(state, { triggerGist: false });
    if (state.settings.gistToken && state.settings.gistId) {
      setSyncStatus('synced', 'Gist Ready');
    } else {
      setSyncStatus('local', 'Local Storage');
    }
    return state.settings;
  }

  // Conflict-Safe Merge (timestamped items + deletion tombstones)
  function mergeRemotePayload(remoteRaw) {
    const local = getState();
    const remote = sanitizeState(remoteRaw || {});
    const mergedWatchlist = {};
    const mergedTombstones = { ...local.tombstones };

    // Merge tombstones keeping latest deletion timestamp
    for (const [id, ts] of Object.entries(remote.tombstones || {})) {
      const nTs = Number(ts) || 0;
      if (!mergedTombstones[id] || nTs > mergedTombstones[id]) {
        mergedTombstones[id] = nTs;
      }
    }

    const allIds = new Set([
      ...Object.keys(local.watchlist),
      ...Object.keys(remote.watchlist)
    ]);

    for (const id of allIds) {
      const l = local.watchlist[id];
      const r = remote.watchlist[id];
      const tombTs = Number(mergedTombstones[id] || 0);

      let winner = null;
      if (l && r) {
        winner = (Number(r.updatedAt) || 0) > (Number(l.updatedAt) || 0) ? r : l;
      } else {
        winner = l || r;
      }
      const winTs = Number(winner?.updatedAt || 0);
      if (winner && winTs >= tombTs) {
        mergedWatchlist[id] = { ...winner, status: normalizeStatus(winner.status) };
        if (winTs > tombTs) delete mergedTombstones[id];
      }
    }

    // Merge overrides
    const mergedOverrides = { ...local.overrides };
    for (const [id, rOvr] of Object.entries(remote.overrides || {})) {
      const lOvr = mergedOverrides[id];
      if (!lOvr || (Number(rOvr.updatedAt) || 0) > (Number(lOvr.updatedAt) || 0)) {
        mergedOverrides[id] = rOvr;
      }
    }

    local.watchlist = mergedWatchlist;
    local.tombstones = mergedTombstones;
    local.overrides = mergedOverrides;
    return local;
  }

  // --------------------------------------------------------------------------
  // Unified GitHub Gist Auto-Sync (Boot Auto-Pull + 1.5s Debounced Auto-Push)
  // --------------------------------------------------------------------------
  function buildPortableSyncPayload(state, includeSecrets = false) {
    const payload = {
      version: 2,
      updatedAt: state.updatedAt || Date.now(),
      watchlist: state.watchlist,
      tombstones: state.tombstones,
      overrides: state.overrides
    };
    if (includeSecrets) {
      payload.settings = state.settings;
    }
    return payload;
  }

  async function gistPull({ silent = false } = {}) {
    const state = getState();
    const { gistToken, gistId } = state.settings;
    if (!gistToken || !gistId) {
      if (!silent) toast('Configure GitHub PAT & Gist ID first.', 'warn');
      return null;
    }
    setSyncStatus('syncing', 'Syncing...');
    try {
      const res = await fetch(`https://api.github.com/gists/${encodeURIComponent(gistId)}`, {
        headers: {
          Authorization: `Bearer ${gistToken}`,
          Accept: 'application/vnd.github+json'
        }
      });
      if (!res.ok) throw new Error(`GitHub API ${res.status}`);
      const gist = await res.json();
      const fileObj = gist.files?.[GIST_FILENAME] || gist.files?.[LEGACY_GIST_FILENAME];
      if (!fileObj || !fileObj.content) {
        setSyncStatus('synced', 'Gist Synced');
        return state;
      }
      const remoteData = JSON.parse(fileObj.content);
      const merged = mergeRemotePayload(remoteData);
      merged.settings.lastGistSync = Date.now();
      saveState(merged, { triggerGist: false });
      setSyncStatus('synced', 'Gist Synced');
      if (!silent) toast(`Pulled ${Object.keys(merged.watchlist).length} watchlist titles from Gist.`, 'success');
      return merged;
    } catch (err) {
      console.error('Gist pull error:', err);
      setSyncStatus('error', 'Sync Error');
      if (!silent) toast(`Gist pull failed: ${err.message}`, 'error');
      return null;
    }
  }

  async function gistPush({ silent = false } = {}) {
    const state = getState();
    const { gistToken, gistId } = state.settings;
    if (!gistToken || !gistId) {
      if (!silent) toast('Configure GitHub PAT & Gist ID first.', 'warn');
      return false;
    }
    setSyncStatus('syncing', 'Pushing...');
    try {
      const body = {
        description: 'AnimeFinder Web Suite — Synced Watchlist & Overrides',
        files: {
          [GIST_FILENAME]: {
            content: JSON.stringify(buildPortableSyncPayload(state, false), null, 2)
          }
        }
      };
      const res = await fetch(`https://api.github.com/gists/${encodeURIComponent(gistId)}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${gistToken}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error(`GitHub API ${res.status}`);
      state.settings.lastGistSync = Date.now();
      saveState(state, { triggerGist: false, notify: false });
      setSyncStatus('synced', 'Gist Synced');
      if (!silent) toast('Pushed Watchlist & overrides to Private Gist.', 'success');
      return true;
    } catch (err) {
      console.error('Gist push error:', err);
      setSyncStatus('error', 'Sync Error');
      if (!silent) toast(`Gist push failed: ${err.message}`, 'error');
      return false;
    }
  }

  async function gistCreateNew(token) {
    if (!token) {
      toast('Enter a GitHub Personal Access Token (gist scope) first.', 'warn');
      return null;
    }
    setSyncStatus('syncing', 'Creating Gist...');
    try {
      const state = getState();
      const res = await fetch('https://api.github.com/gists', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          description: 'AnimeFinder Web Suite — Synced Watchlist & Overrides',
          public: false,
          files: {
            [GIST_FILENAME]: {
              content: JSON.stringify(buildPortableSyncPayload(state, false), null, 2)
            }
          }
        })
      });
      if (!res.ok) throw new Error(`GitHub API ${res.status}`);
      const created = await res.json();
      updateSettings({ gistToken: token, gistId: created.id, gistAutoSync: true, lastGistSync: Date.now() });
      setSyncStatus('synced', 'Gist Synced');
      toast(`Created private Gist (${created.id.slice(0, 8)}...)!`, 'success');
      return created.id;
    } catch (err) {
      setSyncStatus('error', 'Sync Error');
      toast(`Could not create Gist: ${err.message}`, 'error');
      return null;
    }
  }

  function scheduleGistAutoPush() {
    const { gistToken, gistId, gistAutoSync } = getState().settings;
    if (!gistToken || !gistId || !gistAutoSync) return;
    if (gistPushTimer) clearTimeout(gistPushTimer);
    setSyncStatus('syncing', 'Queued...');
    gistPushTimer = setTimeout(() => {
      gistPushTimer = null;
      gistPush({ silent: true });
    }, 1500); // P0: 1.5s debounced auto-push
  }

  // Sync Codes & #sync= URL Hash (never exposes PAT or TMDB key)
  function generateSyncCode() {
    const payload = buildPortableSyncPayload(getState(), false);
    return encodeBase64Utf8(JSON.stringify(payload));
  }

  function applySyncCode(code) {
    const decoded = decodeBase64Utf8(code);
    const parsed = JSON.parse(decoded);
    const merged = mergeRemotePayload(parsed);
    saveState(merged, { triggerGist: true });
    return merged;
  }

  function checkHashSyncOnBoot() {
    const hash = global.location.hash || '';
    if (!hash.startsWith('#sync=')) return;
    try {
      const encoded = decodeURIComponent(hash.slice(6));
      if (!encoded) return;
      const merged = applySyncCode(encoded);
      history.replaceState(null, '', global.location.pathname + global.location.search);
      toast(`Merged ${Object.keys(merged.watchlist).length} watchlist entries from #sync link!`, 'success');
    } catch (err) {
      console.error('Invalid #sync hash:', err);
      toast('Could not decode #sync link.', 'error');
    }
  }

  // --------------------------------------------------------------------------
  // 11-Platform Streaming Detection & Dub Classifier
  // --------------------------------------------------------------------------
  function detectPlatforms(anime, extraStreaming = []) {
    const found = new Set();
    const state = getState();
    const id = Number(anime?.id);
    const ovr = (id && (state.overrides[id] || state.watchlist[id])) || null;

    // 1. User overrides
    if (ovr?.customPlatforms?.length) {
      ovr.customPlatforms.forEach(pid => {
        if (PLATFORM_BY_ID[pid]) found.add(pid);
      });
    }

    // 2. AniList externalLinks (inspect ALL links regardless of type enum)
    const links = Array.isArray(anime?.externalLinks) ? anime.externalLinks : [];
    for (const link of links) {
      const site = String(link.site || '').toLowerCase();
      const url = String(link.url || '').toLowerCase();
      for (const p of PLATFORM_CONFIG) {
        if (
          p.aliases.some(a => site.includes(a)) ||
          p.domains.some(d => url.includes(d))
        ) {
          found.add(p.id);
        }
      }
    }

    // 3. Extra streaming sources (Jikan /streaming, TMDB US Watch Providers)
    for (const name of extraStreaming) {
      const lower = String(name || '').toLowerCase();
      for (const p of PLATFORM_CONFIG) {
        if (p.aliases.some(a => lower.includes(a))) {
          found.add(p.id);
        }
      }
    }

    return Array.from(found).map(pid => PLATFORM_BY_ID[pid]).filter(Boolean);
  }

  function isFreeWithAds(anime, platforms) {
    const state = getState();
    const id = Number(anime?.id);
    const ovr = id && (state.overrides[id] || state.watchlist[id]);
    if (ovr?.customFreeWithAds) return true;
    const list = platforms || detectPlatforms(anime);
    return list.some(p => p.freeWithAds);
  }

  function classifyDub(anime, platforms) {
    const state = getState();
    const id = Number(anime?.id);
    const ovr = id && (state.overrides[id] || state.watchlist[id]);
    if (ovr?.dubOverride) return ovr.dubOverride;

    const list = platforms || detectPlatforms(anime);
    const hasDubPlatform = list.some(p => p.dubLikely);
    const pop = Number(anime?.popularity || 0);
    const status = anime?.status;

    if (status === 'RELEASING' && hasDubPlatform && pop >= 18000) return 'Simuldub';
    if (hasDubPlatform && pop >= 25000) return 'Dubbed';
    if (list.some(p => p.id === 'netflix' || p.id === 'disney') && pop >= 8000) return 'Dubbed';
    return 'Sub Only';
  }

  // --------------------------------------------------------------------------
  // AniList GraphQL Client
  // --------------------------------------------------------------------------
  const MEDIA_CARD_FIELDS = `
    id
    idMal
    title { romaji english native }
    coverImage { large medium color }
    bannerImage
    format
    status
    episodes
    duration
    season
    seasonYear
    averageScore
    meanScore
    popularity
    favourites
    genres
    isAdult
    description(asHtml: false)
    studios(isMain: true) { nodes { id name } }
    tags { name rank isMediaSpoiler isGeneralSpoiler }
    externalLinks { site url type }
    nextAiringEpisode { airingAt timeUntilAiring episode }
    staff(perPage: 8, sort: RELEVANCE) {
      edges {
        role
        node { id name { full } }
      }
    }
  `;

  async function anilistQuery(query, variables = {}, { cacheKey = null, ttl = TTL_DYNAMIC } = {}) {
    if (cacheKey) {
      const cached = await cacheGet(cacheKey);
      if (cached) return cached;
    }

    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch('https://graphql.anilist.co', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json'
          },
          body: JSON.stringify({ query, variables })
        });

        if (res.status === 429) {
          const waitMs = (Number(res.headers.get('Retry-After')) || 2) * 1000;
          await new Promise(r => setTimeout(r, Math.min(waitMs, 4000)));
          continue;
        }
        const json = await res.json();
        if (!res.ok || json.errors) {
          const msg = json.errors?.[0]?.message || `AniList HTTP ${res.status}`;
          throw new Error(msg);
        }
        if (cacheKey && json.data) {
          await cacheSet(cacheKey, json.data, ttl);
        }
        return json.data;
      } catch (err) {
        lastErr = err;
        if (attempt < 2) await new Promise(r => setTimeout(r, 600 * (attempt + 1)));
      }
    }
    throw lastErr || new Error('AniList request failed');
  }

  async function fetchAnimeById(id) {
    const query = `query ($id: Int) { Media(id: $id, type: ANIME) { ${MEDIA_CARD_FIELDS} } }`;
    const data = await anilistQuery(query, { id: Number(id) }, {
      cacheKey: `anilist_media_${id}`,
      ttl: TTL_STABLE
    });
    return data?.Media || null;
  }

  async function searchAnimeQuick(term, perPage = 10) {
    if (!term || !term.trim()) return [];
    const query = `
      query ($search: String, $perPage: Int) {
        Page(page: 1, perPage: $perPage) {
          media(search: $search, type: ANIME, isAdult: false, sort: [SEARCH_MATCH, POPULARITY_DESC]) {
            ${MEDIA_CARD_FIELDS}
          }
        }
      }
    `;
    const data = await anilistQuery(query, { search: term.trim(), perPage }, {
      cacheKey: `anilist_search_${term.trim().toLowerCase()}_${perPage}`,
      ttl: TTL_DYNAMIC
    });
    return data?.Page?.media || [];
  }

  // --------------------------------------------------------------------------
  // Live-Taxonomy Find Vibe (3-Layer Pipeline)
  // --------------------------------------------------------------------------
  const MOOD_LEXICON = {
    cozy: ['Iyashikei', 'Slice of Life', 'Cute Girls Doing Cute Things', 'Rural', 'Food', 'Camping'],
    comfy: ['Iyashikei', 'Slice of Life', 'Food', 'Found Family'],
    wholesome: ['Iyashikei', 'Slice of Life', 'Found Family', 'Coming of Age'],
    bleak: ['Tragedy', 'Psychological', 'Dystopian', 'Post-Apocalyptic', 'Denpa', 'Despair'],
    dark: ['Psychological', 'Tragedy', 'Thriller', 'Gore', 'Noir', 'Dystopian'],
    surreal: ['Surreal Comedy', 'Avant Garde', 'Psychological', 'Meta', 'Philosophy', 'Dream'],
    trippy: ['Avant Garde', 'Psychological', 'Denpa', 'Urban Fantasy'],
    noir: ['Noir', 'Detective', 'Crime', 'Cyberpunk', 'Mystery', 'Psychological'],
    'slow-burn': ['Iyashikei', 'Drama', 'Mystery', 'Philosophy', 'Slice of Life', 'Seinen'],
    'slow burn': ['Iyashikei', 'Drama', 'Mystery', 'Philosophy', 'Seinen'],
    'mind-bending': ['Psychological', 'Time Manipulation', 'Philosophy', 'Mystery', 'Sci-Fi', 'Memory Manipulation'],
    'mind bending': ['Psychological', 'Time Manipulation', 'Philosophy', 'Mystery', 'Sci-Fi'],
    melancholic: ['Drama', 'Tragedy', 'Iyashikei', 'Post-Apocalyptic', 'Coming of Age', 'Ghost'],
    bittersweet: ['Drama', 'Romance', 'Coming of Age', 'Tragedy', 'Slice of Life'],
    cyberpunk: ['Cyberpunk', 'Sci-Fi', 'Dystopian', 'Augmented Reality', 'Artificial Intelligence', 'Noir'],
    gritty: ['Seinen', 'Crime', 'Noir', 'Military', 'Anti-Hero', 'Revenge'],
    dreamy: ['Fantasy', 'Iyashikei', 'Supernatural', 'Philosophy', 'Surreal Comedy'],
    chaotic: ['Slapstick', 'Parody', 'Surreal Comedy', 'Comedy', 'Ensemble Cast'],
    philosophical: ['Philosophy', 'Psychological', 'Existentialism', 'Sci-Fi', 'Cyberpunk'],
    gothic: ['Vampire', 'Horror', 'Supernatural', 'Historical', 'Dark Fantasy'],
    atmospheric: ['Iyashikei', 'Mystery', 'Supernatural', 'Post-Apocalyptic', 'Rural', 'Philosophy'],
    folklore: ['Youkai', 'Mythology', 'Supernatural', 'Historical', 'Rural'],
    nostalgic: ['Coming of Age', 'Rural', 'Slice of Life', 'Historical', 'Classic Literature'],
    epic: ['Adventure', 'Action', 'Fantasy', 'Space Opera', 'Politics', 'War'],
    spooky: ['Horror', 'Ghost', 'Supernatural', 'Mystery', 'Youkai'],
    absurd: ['Surreal Comedy', 'Parody', 'Slapstick', 'Meta', 'Comedy'],
    weird: ['Avant Garde', 'Denpa', 'Surreal Comedy', 'Psychological'],
    chill: ['Iyashikei', 'Slice of Life', 'Travel', 'Outdoor Activities', 'Music'],
    jazzy: ['Music', 'Noir', 'Crime', 'Space', 'Episodic']
  };

  async function getTaxonomy() {
    const cached = await cacheGet('anilist_taxonomy_v1');
    if (cached && cached.genres?.length && cached.tags?.length) return cached;

    const query = `
      query {
        GenreCollection
        MediaTagCollection {
          name
          description
          category
          isAdult
        }
      }
    `;
    const data = await anilistQuery(query, {}, { cacheKey: 'anilist_taxonomy_raw', ttl: TTL_STABLE });
    const genres = (data?.GenreCollection || []).filter(g => g !== 'Hentai');
    const tags = (data?.MediaTagCollection || [])
      .filter(t => !t.isAdult)
      .map(t => ({ name: t.name, description: t.description || '', category: t.category || '' }));

    const taxonomy = { genres, tags };
    await cacheSet('anilist_taxonomy_v1', taxonomy, TTL_STABLE);
    return taxonomy;
  }

  function singularize(word) {
    if (word.endsWith('ies') && word.length > 4) return word.slice(0, -3) + 'y';
    if (word.endsWith('es') && word.length > 4) return word.slice(0, -2);
    if (word.endsWith('s') && !word.endsWith('ss') && word.length > 3) return word.slice(0, -1);
    return word;
  }

  function parseVibePrompt(prompt, taxonomy) {
    const raw = String(prompt || '').trim();
    const lower = raw.toLowerCase();
    const genreMap = new Map(taxonomy.genres.map(g => [g.toLowerCase(), g]));
    const tagMap = new Map(taxonomy.tags.map(t => [t.name.toLowerCase(), t.name]));
    const tagSingularMap = new Map(taxonomy.tags.map(t => [singularize(t.name.toLowerCase()), t.name]));

    const matchedGenres = new Set();
    const matchedTags = new Set();
    const layersUsed = [];
    let decadeRange = null;

    // Decade detection (e.g. 90s, 1980s, 2000s, 70s)
    const decMatch = lower.match(/\b(19[6-9]0|20[0-2]0|[6-9]0)s\b/);
    if (decMatch) {
      let yr = parseInt(decMatch[1], 10);
      if (yr < 100) yr += 1900;
      decadeRange = { start: yr * 10000, end: (yr + 9) * 10000 + 1231, label: `${yr}s` };
    }

    const cleanWords = lower.replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(Boolean);
    const ngrams = new Set();
    ngrams.add(lower);
    for (let i = 0; i < cleanWords.length; i++) {
      ngrams.add(cleanWords[i]);
      ngrams.add(singularize(cleanWords[i]));
      if (i + 1 < cleanWords.length) {
        const bi = `${cleanWords[i]} ${cleanWords[i + 1]}`;
        ngrams.add(bi);
        ngrams.add(singularize(bi));
      }
      if (i + 2 < cleanWords.length) {
        ngrams.add(`${cleanWords[i]} ${cleanWords[i + 1]} ${cleanWords[i + 2]}`);
      }
    }

    // Layer 1: Canonical & Singular/Plural Matching
    let layer1Hit = false;
    for (const candidate of ngrams) {
      if (genreMap.has(candidate)) {
        matchedGenres.add(genreMap.get(candidate));
        layer1Hit = true;
      }
      if (tagMap.has(candidate)) {
        matchedTags.add(tagMap.get(candidate));
        layer1Hit = true;
      } else if (tagSingularMap.has(candidate) && candidate.length > 3) {
        matchedTags.add(tagSingularMap.get(candidate));
        layer1Hit = true;
      }
    }
    if (layer1Hit) layersUsed.push('L1:Canonical');

    // Layer 2: Taxonomy-Verified Mood Lexicon
    let layer2Hit = false;
    for (const [mood, expansions] of Object.entries(MOOD_LEXICON)) {
      if (lower.includes(mood)) {
        for (const term of expansions) {
          const tl = term.toLowerCase();
          if (genreMap.has(tl)) {
            matchedGenres.add(genreMap.get(tl));
            layer2Hit = true;
          } else if (tagMap.has(tl)) {
            matchedTags.add(tagMap.get(tl));
            layer2Hit = true;
          }
        }
      }
    }
    if (layer2Hit) layersUsed.push('L2:MoodLexicon');

    // Layer 3: Tag-Description Fallback when no direct tag/mood match
    if (matchedGenres.size === 0 && matchedTags.size === 0 && cleanWords.length > 0) {
      const stop = new Set(['anime', 'show', 'series', 'movie', 'like', 'with', 'about', 'that', 'from', 'very', 'good', 'best', 'vibe', 'mood']);
      const meaningful = cleanWords.filter(w => w.length >= 4 && !stop.has(w));
      const scored = [];
      for (const t of taxonomy.tags) {
        const desc = (t.description + ' ' + t.name).toLowerCase();
        let score = 0;
        for (const w of meaningful) {
          if (desc.includes(w)) score += 1;
        }
        if (score > 0) scored.push({ name: t.name, score });
      }
      scored.sort((a, b) => b.score - a.score);
      scored.slice(0, 4).forEach(s => matchedTags.add(s.name));
      if (matchedTags.size > 0) layersUsed.push('L3:TagDescFallback');
    }

    return {
      raw,
      genres: Array.from(matchedGenres),
      tags: Array.from(matchedTags),
      decadeRange,
      layersUsed
    };
  }

  async function fetchVibeCandidates(parsed, { limit = 26, maxPopularity = null } = {}) {
    const genres = parsed.genres || [];
    const tags = parsed.tags || [];
    const dec = parsed.decadeRange;

    const buildQuery = (useMinRank) => {
      const parts = [];
      const vars = {};
      const dateArgs = dec ? `, startDate_greater: ${dec.start}, startDate_lesser: ${dec.end}` : '';
      const popArgs = maxPopularity ? `, popularity_lesser: ${maxPopularity}` : '';

      if (tags.length > 0) {
        vars.tags = tags.slice(0, 5);
        const minRankArg = useMinRank ? ', minimumTagRank: 55' : '';
        parts.push(`byTags: Page(page: 1, perPage: 24) { media(type: ANIME, isAdult: false, tag_in: $tags${minRankArg}${dateArgs}${popArgs}, sort: [SCORE_DESC, POPULARITY_DESC]) { ${MEDIA_CARD_FIELDS} } }`);
      }
      if (genres.length > 0) {
        vars.genres = genres.slice(0, 4);
        parts.push(`byGenres: Page(page: 1, perPage: 24) { media(type: ANIME, isAdult: false, genre_in: $genres${dateArgs}${popArgs}, sort: [SCORE_DESC, POPULARITY_DESC]) { ${MEDIA_CARD_FIELDS} } }`);
      }
      if (tags.length > 0 && genres.length > 0) {
        parts.push(`combined: Page(page: 1, perPage: 20) { media(type: ANIME, isAdult: false, tag_in: $tags, genre_in: $genres${dateArgs}${popArgs}, sort: [SCORE_DESC, POPULARITY_DESC]) { ${MEDIA_CARD_FIELDS} } }`);
      }
      if (parts.length === 0) {
        vars.search = parsed.raw || 'anime';
        parts.push(`fallback: Page(page: 1, perPage: 24) { media(type: ANIME, isAdult: false, search: $search${dateArgs}${popArgs}, sort: [SEARCH_MATCH, SCORE_DESC]) { ${MEDIA_CARD_FIELDS} } }`);
      }

      const varDefs = [];
      if (vars.tags) varDefs.push('$tags: [String]');
      if (vars.genres) varDefs.push('$genres: [String]');
      if (vars.search) varDefs.push('$search: String');
      const header = varDefs.length ? `query (${varDefs.join(', ')})` : 'query';
      return { query: `${header} { ${parts.join('\n')} }`, vars };
    };

    const collectUnique = (data) => {
      const map = new Map();
      for (const bucket of Object.values(data || {})) {
        for (const m of (bucket?.media || [])) {
          if (m && m.id && !map.has(m.id)) map.set(m.id, m);
        }
      }
      return Array.from(map.values());
    };

    const cacheId = `vibe_${(parsed.raw || '').toLowerCase()}_${tags.join(',')}_${genres.join(',')}_${dec?.label || ''}_${maxPopularity || 'all'}`;
    let { query, vars } = buildQuery(true);
    let data = await anilistQuery(query, vars, { cacheKey: cacheId, ttl: TTL_DYNAMIC });
    let items = collectUnique(data);

    // Automatic retry without minimumTagRank if niche tag yields fewer than 6 titles
    if (items.length < 6 && tags.length > 0) {
      ({ query, vars } = buildQuery(false));
      data = await anilistQuery(query, vars, { cacheKey: cacheId + '_relaxed', ttl: TTL_DYNAMIC });
      items = collectUnique(data);
    }

    // Score & rank by exemplar tagRanks + genre alignment
    const targetTags = new Set(tags.map(t => t.toLowerCase()));
    const targetGenres = new Set(genres.map(g => g.toLowerCase()));

    items.forEach(m => {
      let score = 0;
      for (const t of (m.tags || [])) {
        if (targetTags.has(t.name.toLowerCase())) {
          score += (t.rank || 50) * 1.4;
        }
      }
      for (const g of (m.genres || [])) {
        if (targetGenres.has(g.toLowerCase())) {
          score += 45;
        }
      }
      score += (m.averageScore || 65) * 0.45;
      m._vibeScore = score;
    });

    items.sort((a, b) => (b._vibeScore || 0) - (a._vibeScore || 0));
    return items.slice(0, limit);
  }

  // P2: Read-Only AniList Username Watchlist Importer (MediaListCollection)
  async function importAniListWatchlist(username) {
    const clean = String(username || '').trim();
    if (!clean) throw new Error('Enter an AniList username.');
    const query = `
      query ($userName: String) {
        MediaListCollection(userName: $userName, type: ANIME) {
          lists {
            name
            entries {
              status
              score(format: POINT_10)
              progress
              notes
              updatedAt
              media {
                id
                title { romaji english native }
                coverImage { large medium }
                format
                episodes
                averageScore
                popularity
                seasonYear
                genres
              }
            }
          }
        }
      }
    `;
    const data = await anilistQuery(query, { userName: clean });
    const lists = data?.MediaListCollection?.lists || [];
    const state = getState();
    let importedCount = 0;

    for (const list of lists) {
      for (const entry of (list.entries || [])) {
        const m = entry.media;
        if (!m || !m.id) continue;
        const prev = state.watchlist[m.id] || {};
        state.watchlist[m.id] = {
          id: m.id,
          title: getDisplayTitle(m),
          cover: getCover(m),
          format: m.format || '',
          episodes: m.episodes ?? null,
          averageScore: m.averageScore ?? null,
          popularity: m.popularity ?? null,
          seasonYear: m.seasonYear ?? null,
          genres: m.genres || [],
          status: normalizeStatus(entry.status),
          rating: Math.round(Number(entry.score) || prev.rating || 0),
          progress: Number(entry.progress) || prev.progress || 0,
          notes: entry.notes || prev.notes || '',
          dubOverride: prev.dubOverride || '',
          customPlatforms: prev.customPlatforms || [],
          customFreeWithAds: Boolean(prev.customFreeWithAds),
          updatedAt: Date.now()
        };
        delete state.tombstones[m.id];
        importedCount++;
      }
    }
    state.settings.anilistUsername = clean;
    saveState(state, { triggerGist: true });
    return importedCount;
  }

  // --------------------------------------------------------------------------
  // Multi-Source Detail Enrichment (Jikan, Kitsu, Shikimori, TVMaze, Wiki, TMDB)
  // --------------------------------------------------------------------------
  async function fetchJsonSafe(url, timeoutMs = 6500) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchWikipediaSummary(title) {
    if (!title) return null;
    const cacheKey = `wiki_${title.toLowerCase()}`;
    const cached = await cacheGet(cacheKey);
    if (cached) return cached;

    const trySummary = async (pageTitle) => {
      const data = await fetchJsonSafe(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageTitle)}`);
      if (data && data.extract && data.type !== 'disambiguation') {
        const low = (data.description + ' ' + data.extract).toLowerCase();
        if (/(anime|manga|japanese|animated|studio|film|series|television|light novel)/.test(low)) {
          return {
            title: data.title,
            extract: data.extract,
            url: data.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(data.title)}`
          };
        }
      }
      return null;
    };

    let result = await trySummary(title);
    if (!result) result = await trySummary(`${title} (anime)`);
    if (!result) {
      const search = await fetchJsonSafe(`https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(title + ' anime')}&limit=3&format=json&origin=*`);
      const candidates = Array.isArray(search?.[1]) ? search[1] : [];
      for (const c of candidates) {
        result = await trySummary(c);
        if (result) break;
      }
    }
    if (result) await cacheSet(cacheKey, result, TTL_STABLE);
    return result;
  }

  async function fetchTmdbUsProviders(title, year, tmdbKey) {
    if (!tmdbKey || !title) return null;
    const cacheKey = `tmdb_us_${title.toLowerCase()}_${year || ''}`;
    const cached = await cacheGet(cacheKey);
    if (cached) return cached;

    const search = await fetchJsonSafe(`https://api.themoviedb.org/3/search/multi?api_key=${encodeURIComponent(tmdbKey)}&query=${encodeURIComponent(title)}`);
    const hit = (search?.results || []).find(r => r.media_type === 'tv' || r.media_type === 'movie');
    if (!hit) return null;

    const prov = await fetchJsonSafe(`https://api.themoviedb.org/3/${hit.media_type}/${hit.id}/watch/providers?api_key=${encodeURIComponent(tmdbKey)}`);
    const us = prov?.results?.US;
    if (!us) return null;

    const collect = (arr) => (arr || []).map(p => p.provider_name);
    const out = {
      tmdbId: hit.id,
      mediaType: hit.media_type,
      link: us.link || '',
      flatrate: collect(us.flatrate),
      ads: collect(us.ads),
      free: collect(us.free),
      rent: collect(us.rent)
    };
    await cacheSet(cacheKey, out, TTL_STABLE);
    return out;
  }

  async function fetchMultiSourceDetails(anime) {
    if (!anime || !anime.id) return {};
    const cacheKey = `multisrc_${anime.id}`;
    const tmdbKey = getState().settings.tmdbKey || '';
    const cached = await cacheGet(cacheKey);
    if (cached && (!tmdbKey || cached.tmdb !== undefined)) return cached;

    const title = getDisplayTitle(anime);
    const malId = anime.idMal;

    const jikanTask = malId
      ? (async () => {
          const full = await fetchJsonSafe(`https://api.jikan.moe/v4/anime/${malId}/full`);
          let streaming = full?.data?.streaming || [];
          if (!streaming.length) {
            const st = await fetchJsonSafe(`https://api.jikan.moe/v4/anime/${malId}/streaming`);
            streaming = st?.data || [];
          }
          return full?.data ? {
            score: full.data.score,
            rank: full.data.rank,
            rating: full.data.rating,
            url: full.data.url,
            streaming: streaming.map(s => ({ name: s.name, url: s.url }))
          } : null;
        })()
      : Promise.resolve(null);

    const kitsuTask = (async () => {
      const data = await fetchJsonSafe(`https://kitsu.io/api/edge/anime?filter[text]=${encodeURIComponent(title)}&page[limit]=1`);
      const first = data?.data?.[0];
      if (!first) return null;
      return {
        rating: first.attributes?.averageRating,
        slug: first.attributes?.slug,
        ageRating: first.attributes?.ageRatingGuide,
        url: first.attributes?.slug ? `https://kitsu.app/anime/${first.attributes.slug}` : ''
      };
    })();

    const shikimoriTask = malId
      ? (async () => {
          const data = await fetchJsonSafe(`https://shikimori.one/api/animes/${malId}`);
          if (!data || !data.id) return null;
          return {
            score: data.score,
            kind: data.kind,
            url: data.url ? `https://shikimori.one${data.url}` : ''
          };
        })()
      : Promise.resolve(null);

    const tvmazeTask = (async () => {
      const data = await fetchJsonSafe(`https://api.tvmaze.com/singlesearch/shows?q=${encodeURIComponent(title)}`);
      if (!data || !data.id) return null;
      return {
        rating: data.rating?.average,
        network: data.network?.name || data.webChannel?.name || '',
        status: data.status,
        url: data.url
      };
    })();

    const wikiTask = fetchWikipediaSummary(title);
    const tmdbTask = tmdbKey ? fetchTmdbUsProviders(title, anime.seasonYear, tmdbKey) : Promise.resolve(undefined);

    const [jikan, kitsu, shikimori, tvmaze, wikipedia, tmdb] = await Promise.all([
      jikanTask, kitsuTask, shikimoriTask, tvmazeTask, wikiTask, tmdbTask
    ]);

    const bundle = { jikan, kitsu, shikimori, tvmaze, wikipedia, tmdb };
    if (jikan || kitsu || shikimori || tvmaze || wikipedia || tmdb) {
      await cacheSet(cacheKey, bundle, TTL_STABLE);
    }
    return bundle;
  }

  // --------------------------------------------------------------------------
  // Accessible Shared Navigation Bar & Detail Modal
  // --------------------------------------------------------------------------
  function updateNavBadges(state) {
    const badge = document.getElementById('af-nav-wl-count');
    if (badge) {
      badge.textContent = String(Object.keys(state.watchlist || {}).length);
    }
  }

  function mountNav(activePage) {
    const host = document.getElementById('af-nav-host');
    if (!host) return;
    const state = getState();
    const wlCount = Object.keys(state.watchlist || {}).length;
    const hasGist = Boolean(state.settings.gistToken && state.settings.gistId);

    host.innerHTML = `
      <header class="af-nav" role="banner">
        <a class="af-brand" href="./index.html">
          <img src="./icon.svg" alt="" width="30" height="30">
          <span>AnimeFinder</span>
          <span class="af-brand-sub">Suite</span>
        </a>
        <nav class="af-nav-links" aria-label="Primary Suite Navigation">
          <a class="af-nav-link ${activePage === 'hub' ? 'active' : ''}" href="./index.html" ${activePage === 'hub' ? 'aria-current="page"' : ''}>
            Main Hub <span class="badge badge-muted" id="af-nav-wl-count" title="Saved Watchlist">${wlCount}</span>
          </a>
          <a class="af-nav-link ${activePage === 'graph' ? 'active' : ''}" href="./vibe-graph.html" ${activePage === 'graph' ? 'aria-current="page"' : ''}>
            Vibe &amp; Taste Graph
          </a>
          <a class="af-nav-link ${activePage === 'lab' ? 'active' : ''}" href="./eclectic-lab.html" ${activePage === 'lab' ? 'aria-current="page"' : ''}>
            Eclectic Lab
          </a>
        </nav>
        <div class="af-nav-right">
          <a href="./index.html?tab=saved" id="af-sync-pill" class="sync-pill" data-state="${hasGist ? 'synced' : 'local'}" title="Storage &amp; Gist Sync Status">
            <span class="sync-dot" aria-hidden="true"></span>
            <span class="sync-label">${hasGist ? 'Gist Ready' : 'Local Storage'}</span>
          </a>
        </div>
      </header>
    `;

    // Check #sync= hash and run boot-time Gist auto-pull
    checkHashSyncOnBoot();
    if (hasGist && state.settings.gistAutoSync) {
      gistPull({ silent: true });
    }
  }

  // Accessible Modal Focus Management (P1)
  let lastFocusedEl = null;
  let activeModalAnime = null;

  function ensureDetailModal() {
    let backdrop = document.getElementById('af-detail-modal-backdrop');
    if (backdrop) return backdrop;
    backdrop = document.createElement('div');
    backdrop.id = 'af-detail-modal-backdrop';
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="af-modal-title" tabindex="-1">
        <div class="modal-header">
          <h3 id="af-modal-title" style="margin:0;font-size:17px;">Anime Details</h3>
          <button type="button" class="btn btn-sm" id="af-modal-close" aria-label="Close modal">✕ Close <span class="kbd">Esc</span></button>
        </div>
        <div class="modal-body" id="af-modal-body"></div>
      </div>
    `;
    document.body.appendChild(backdrop);

    backdrop.addEventListener('click', (ev) => {
      if (ev.target === backdrop) closeDetailModal();
    });
    backdrop.querySelector('#af-modal-close').addEventListener('click', closeDetailModal);

    // Focus trap inside open modal
    backdrop.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        closeDetailModal();
        return;
      }
      if (ev.key !== 'Tab') return;
      const focusables = backdrop.querySelectorAll('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])');
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (ev.shiftKey && document.activeElement === first) {
        ev.preventDefault();
        last.focus();
      } else if (!ev.shiftKey && document.activeElement === last) {
        ev.preventDefault();
        first.focus();
      }
    });
    return backdrop;
  }

  function closeDetailModal() {
    const backdrop = document.getElementById('af-detail-modal-backdrop');
    if (!backdrop || !backdrop.classList.contains('open')) return;
    backdrop.classList.remove('open');
    activeModalAnime = null;
    if (lastFocusedEl && typeof lastFocusedEl.focus === 'function') {
      lastFocusedEl.focus();
    }
    lastFocusedEl = null;
  }

  async function openDetailModal(animeOrId) {
    lastFocusedEl = document.activeElement;
    const backdrop = ensureDetailModal();
    const titleEl = backdrop.querySelector('#af-modal-title');
    const bodyEl = backdrop.querySelector('#af-modal-body');
    backdrop.classList.add('open');
    bodyEl.innerHTML = `<div class="empty-state"><span class="spinner"></span> Loading details...</div>`;
    backdrop.querySelector('.modal-dialog').focus();

    let anime = typeof animeOrId === 'object' ? animeOrId : null;
    if (!anime || !anime.description) {
      try {
        const fetched = await fetchAnimeById(typeof animeOrId === 'object' ? animeOrId.id : animeOrId);
        if (fetched) anime = fetched;
      } catch (err) {
        if (!anime) {
          bodyEl.innerHTML = `<div class="empty-state">Failed to load anime details: ${escapeHtml(err.message)}</div>`;
          return;
        }
      }
    }
    activeModalAnime = anime;

    const state = getState();
    const wl = state.watchlist[anime.id] || null;
    const ovr = state.overrides[anime.id] || wl || {};
    const title = getDisplayTitle(anime);
    const cover = getCover(anime);
    const studios = (anime.studios?.nodes || []).map(s => s.name).join(', ') || 'Unknown Studio';
    const platforms = detectPlatforms(anime);
    const dubLabel = classifyDub(anime, platforms);
    const freeAds = isFreeWithAds(anime, platforms);

    titleEl.textContent = title;

    bodyEl.innerHTML = `
      <div class="detail-hero">
        <img class="detail-cover" src="${escapeHtml(cover)}" alt="${escapeHtml(title)} cover">
        <div style="display:flex;flex-direction:column;gap:10px;min-width:0;">
          <div class="meta-row">
            ${anime.averageScore ? `<span class="badge badge-emerald">★ ${anime.averageScore}%</span>` : ''}
            ${anime.format ? `<span class="badge badge-accent">${escapeHtml(anime.format)}</span>` : ''}
            ${anime.seasonYear ? `<span class="badge badge-muted">${escapeHtml(anime.season || '')} ${anime.seasonYear}</span>` : ''}
            ${anime.episodes ? `<span class="badge badge-muted">${anime.episodes} eps</span>` : ''}
            <span class="badge badge-cyan">${escapeHtml(dubLabel)}</span>
            ${freeAds ? `<span class="badge badge-amber">Free w/ Ads</span>` : ''}
            <span class="badge badge-muted">Pop: ${formatCompactNumber(anime.popularity)}</span>
          </div>
          <div style="font-size:12.5px;color:var(--text-muted);">
            <strong>Studio:</strong> ${escapeHtml(studios)} &nbsp;•&nbsp; <strong>Genres:</strong> ${escapeHtml((anime.genres || []).join(', ') || '—')}
          </div>
          <p style="margin:0;font-size:13px;color:#cbd5e1;max-height:150px;overflow-y:auto;white-space:pre-line;">
            ${escapeHtml(stripHtml(anime.description) || 'No synopsis available.')}
          </p>
          <div class="meta-row" style="margin-top:auto;">
            <a class="btn btn-primary btn-sm" href="./vibe-graph.html?seed=${anime.id}">Explore in Taste Graph</a>
            <a class="btn btn-cyan btn-sm" href="./eclectic-lab.html?tab=arithmetic&seed=${anime.id}">Send to Arithmetic</a>
            <a class="btn btn-sm" href="https://anilist.co/anime/${anime.id}" target="_blank" rel="noopener">AniList ↗</a>
            ${anime.idMal ? `<a class="btn btn-sm" href="https://myanimelist.net/anime/${anime.idMal}" target="_blank" rel="noopener">MAL ↗</a>` : ''}
          </div>
        </div>
      </div>

      <div class="detail-section">
        <h4>Watchlist &amp; Personal Tracking</h4>
        <div class="form-grid">
          <div class="form-field">
            <label for="af-wl-status">Status</label>
            <select id="af-wl-status" class="select">
              ${WATCHLIST_STATUSES.map(st => `<option value="${st}" ${(wl?.status || 'Plan to Watch') === st ? 'selected' : ''}>${st}</option>`).join('')}
            </select>
          </div>
          <div class="form-field">
            <label for="af-wl-rating">Rating (0–10)</label>
            <select id="af-wl-rating" class="select">
              <option value="0">Unrated</option>
              ${[10,9,8,7,6,5,4,3,2,1].map(r => `<option value="${r}" ${Number(wl?.rating) === r ? 'selected' : ''}>${r} / 10</option>`).join('')}
            </select>
          </div>
          <div class="form-field">
            <label for="af-wl-progress">Episodes Watched</label>
            <div style="display:flex;gap:6px;">
              <input id="af-wl-progress" type="number" min="0" max="${anime.episodes || 9999}" class="input input-full" value="${wl?.progress || 0}">
              <button type="button" class="btn btn-sm" id="af-wl-inc" title="Increment episode">+1</button>
            </div>
          </div>
          <div class="form-field">
            <label for="af-wl-dub">Dub Classification Override</label>
            <select id="af-wl-dub" class="select">
              ${DUB_OPTIONS.map(d => `<option value="${d}" ${(ovr.dubOverride || '') === d ? 'selected' : ''}>${d || 'Auto (' + dubLabel + ')'}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-field" style="margin-top:10px;">
          <label for="af-wl-notes">Personal Notes</label>
          <textarea id="af-wl-notes" class="textarea" placeholder="Thoughts, arc reminders, why you added it...">${escapeHtml(wl?.notes || '')}</textarea>
        </div>
        <div class="form-field" style="margin-top:10px;">
          <label>Custom Streaming Platform Overrides (for sparsely indexed services like OceanVeil)</label>
          <div class="pills-row" id="af-custom-platforms">
            ${PLATFORM_CONFIG.map(p => {
              const active = (ovr.customPlatforms || []).includes(p.id);
              return `<button type="button" class="pill ${active ? 'active' : ''}" data-pid="${p.id}">${escapeHtml(p.name)}</button>`;
            }).join('')}
            <button type="button" class="pill ${ovr.customFreeWithAds ? 'active' : ''}" id="af-custom-free-ads">★ Free w/ Ads</button>
          </div>
        </div>
        <div class="meta-row" style="margin-top:14px;">
          <button type="button" class="btn btn-emerald" id="af-wl-save">${wl ? 'Update Watchlist' : '+ Add to Watchlist'}</button>
          <button type="button" class="btn btn-sm" id="af-ovr-only">Save Platform/Dub Overrides Only</button>
          ${wl ? `<button type="button" class="btn btn-danger btn-sm" id="af-wl-remove" style="margin-left:auto;">Remove from Watchlist</button>` : ''}
        </div>
      </div>

      <div class="detail-section">
        <h4>Streaming &amp; Multi-Source Metadata (Jikan · Kitsu · Shikimori · TVMaze · Wikipedia · TMDB US)</h4>
        <div id="af-multisrc-area" style="font-size:13px;color:var(--text-muted);">
          <span class="spinner"></span> Querying Jikan v4, Kitsu, Shikimori, TVMaze, Wikipedia${state.settings.tmdbKey ? ' &amp; TMDB US' : ''}...
        </div>
      </div>
    `;

    // Wire custom platform pills
    const customSet = new Set(ovr.customPlatforms || []);
    let customFree = Boolean(ovr.customFreeWithAds);
    bodyEl.querySelectorAll('#af-custom-platforms [data-pid]').forEach(btn => {
      btn.addEventListener('click', () => {
        const pid = btn.dataset.pid;
        if (customSet.has(pid)) { customSet.delete(pid); btn.classList.remove('active'); }
        else { customSet.add(pid); btn.classList.add('active'); }
      });
    });
    const freeBtn = bodyEl.querySelector('#af-custom-free-ads');
    freeBtn.addEventListener('click', () => {
      customFree = !customFree;
      freeBtn.classList.toggle('active', customFree);
    });

    bodyEl.querySelector('#af-wl-inc').addEventListener('click', () => {
      const inp = bodyEl.querySelector('#af-wl-progress');
      inp.value = String((Number(inp.value) || 0) + 1);
    });

    bodyEl.querySelector('#af-wl-save').addEventListener('click', () => {
      upsertWatchlistItem(anime, {
        status: bodyEl.querySelector('#af-wl-status').value,
        rating: Number(bodyEl.querySelector('#af-wl-rating').value) || 0,
        progress: Number(bodyEl.querySelector('#af-wl-progress').value) || 0,
        notes: bodyEl.querySelector('#af-wl-notes').value,
        dubOverride: bodyEl.querySelector('#af-wl-dub').value,
        customPlatforms: Array.from(customSet),
        customFreeWithAds: customFree
      });
      toast(`Saved "${title}" to Watchlist.`, 'success');
      closeDetailModal();
    });

    bodyEl.querySelector('#af-ovr-only').addEventListener('click', () => {
      updateOverrides(anime.id, {
        dubOverride: bodyEl.querySelector('#af-wl-dub').value,
        customPlatforms: Array.from(customSet),
        customFreeWithAds: customFree
      });
      toast(`Saved streaming/dub overrides for "${title}".`, 'success');
    });

    const remBtn = bodyEl.querySelector('#af-wl-remove');
    if (remBtn) {
      remBtn.addEventListener('click', () => {
        removeWatchlistItem(anime.id);
        toast(`Removed "${title}" from Watchlist.`, 'warn');
        closeDetailModal();
      });
    }

    // Load Multi-Source metadata in parallel
    try {
      const multi = await fetchMultiSourceDetails(anime);
      if (!activeModalAnime || activeModalAnime.id !== anime.id) return;
      const area = bodyEl.querySelector('#af-multisrc-area');
      const extraStreamNames = [
        ...(multi.jikan?.streaming || []).map(s => s.name),
        ...(multi.tmdb?.flatrate || []),
        ...(multi.tmdb?.ads || []),
        ...(multi.tmdb?.free || [])
      ];
      const mergedPlatforms = detectPlatforms(anime, extraStreamNames);

      area.innerHTML = `
        <div class="meta-row" style="margin-bottom:12px;">
          <strong style="color:var(--text);">Detected Platforms:</strong>
          ${mergedPlatforms.length
            ? mergedPlatforms.map(p => `<span class="platform-tag" style="border-color:${p.color};color:${p.color};">${escapeHtml(p.name)}${p.freeWithAds ? ' (Free)' : ''}</span>`).join('')
            : '<span class="badge badge-muted">None detected automatically — use overrides above</span>'}
        </div>
        <div class="grid-2" style="gap:10px;margin-bottom:12px;">
          <div class="panel" style="padding:10px;">
            <div style="font-size:11px;color:var(--text-dim);text-transform:uppercase;">Jikan (MAL v4)</div>
            <div style="font-weight:700;color:var(--text);margin-top:3px;">
              ${multi.jikan ? `Score ${multi.jikan.score ?? '—'} · Rank #${multi.jikan.rank ?? '—'}` : 'Unavailable'}
            </div>
            ${multi.jikan?.rating ? `<div style="font-size:11.5px;">${escapeHtml(multi.jikan.rating)}</div>` : ''}
          </div>
          <div class="panel" style="padding:10px;">
            <div style="font-size:11px;color:var(--text-dim);text-transform:uppercase;">Kitsu / Shikimori / TVMaze</div>
            <div style="font-size:12.5px;color:var(--text);margin-top:3px;">
              Kitsu: ${multi.kitsu?.rating ? multi.kitsu.rating + '%' : '—'} ·
              Shikimori: ${multi.shikimori?.score || '—'} ·
              TVMaze: ${multi.tvmaze?.rating || '—'}
            </div>
            ${multi.tvmaze?.network ? `<div style="font-size:11.5px;">Network: ${escapeHtml(multi.tvmaze.network)}</div>` : ''}
          </div>
        </div>
        ${multi.tmdb ? `
          <div class="panel" style="padding:10px;margin-bottom:12px;">
            <div style="font-size:11px;color:var(--cyan);text-transform:uppercase;">TMDB US Watch Providers (JustWatch)</div>
            <div style="font-size:12.5px;color:var(--text);margin-top:4px;">
              <strong>Stream:</strong> ${escapeHtml(multi.tmdb.flatrate.join(', ') || '—')} &nbsp;|&nbsp;
              <strong>Free/Ads:</strong> ${escapeHtml([...multi.tmdb.free, ...multi.tmdb.ads].join(', ') || '—')}
            </div>
          </div>
        ` : ''}
        ${multi.wikipedia ? `
          <div class="panel" style="padding:10px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
              <span style="font-size:11px;color:var(--purple);text-transform:uppercase;">Wikipedia Extract</span>
              <a href="${escapeHtml(multi.wikipedia.url)}" target="_blank" rel="noopener" style="font-size:11.5px;">Read article ↗</a>
            </div>
            <p style="margin:0;font-size:12.5px;color:#cbd5e1;">${escapeHtml(multi.wikipedia.extract)}</p>
          </div>
        ` : '<div style="font-size:12px;color:var(--text-dim);">No verified English Wikipedia summary matched.</div>'}
      `;
    } catch (err) {
      const area = bodyEl.querySelector('#af-multisrc-area');
      if (area) area.textContent = 'Multi-source enrichment partially unavailable right now.';
    }
  }

  // Export unified API
  global.AnimeFinderCore = {
    STATE_KEY,
    DB_NAME,
    GIST_FILENAME,
    TTL_DYNAMIC,
    TTL_STABLE,
    WATCHLIST_STATUSES,
    DUB_OPTIONS,
    PLATFORM_CONFIG,
    PLATFORM_BY_ID,
    MEDIA_CARD_FIELDS,
    escapeHtml,
    stripHtml,
    getDisplayTitle,
    getCover,
    normalizeStatus,
    formatCompactNumber,
    formatRelativeCountdown,
    toast,
    encodeBase64Utf8,
    decodeBase64Utf8,
    cacheGet,
    cacheSet,
    vectorGet,
    vectorSet,
    cacheStats,
    cacheClear,
    getState,
    saveState,
    onStateChange,
    onSyncStatus,
    upsertWatchlistItem,
    removeWatchlistItem,
    updateOverrides,
    updateSettings,
    mergeRemotePayload,
    gistPull,
    gistPush,
    gistCreateNew,
    generateSyncCode,
    applySyncCode,
    detectPlatforms,
    isFreeWithAds,
    classifyDub,
    anilistQuery,
    fetchAnimeById,
    searchAnimeQuick,
    getTaxonomy,
    parseVibePrompt,
    fetchVibeCandidates,
    importAniListWatchlist,
    fetchWikipediaSummary,
    fetchTmdbUsProviders,
    fetchMultiSourceDetails,
    mountNav,
    openDetailModal,
    closeDetailModal
  };
})(window);
