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

  const DUB_OPTIONS = ['', 'EN Dub', 'Staggered Dub', 'Simuldub', 'Sub Only'];

  // Centralized 11-platform registry resolving Crunchyroll/HIDIVE bias
  // licensedByValues covers exact AniList ExternalLink/licensedBy strings
  const PLATFORM_CONFIG = [
    {
      id: 'crunchyroll',
      name: 'Crunchyroll',
      licensedBy: 'Crunchyroll',
      licensedByValues: ['Crunchyroll', 'Funimation'],
      aliases: ['crunchyroll', 'funimation'],
      domains: ['crunchyroll.com', 'funimation.com'],
      color: '#f97316',
      freeWithAds: false
    },
    {
      id: 'hidive',
      name: 'HIDIVE',
      licensedBy: 'HIDIVE',
      licensedByValues: ['HIDIVE'],
      aliases: ['hidive', 'sentai'],
      domains: ['hidive.com'],
      color: '#38bdf8',
      freeWithAds: false
    },
    {
      id: 'netflix',
      name: 'Netflix',
      licensedBy: 'Netflix',
      licensedByValues: ['Netflix'],
      aliases: ['netflix'],
      domains: ['netflix.com'],
      color: '#ef4444',
      freeWithAds: false
    },
    {
      id: 'prime',
      name: 'Prime Video',
      licensedBy: 'Amazon',
      licensedByValues: ['Amazon', 'Amazon Prime Video'],
      aliases: ['amazon', 'prime video', 'amazon prime video', 'amazon video'],
      domains: ['amazon.com', 'primevideo.com'],
      color: '#60a5fa',
      freeWithAds: false
    },
    {
      id: 'hulu',
      name: 'Hulu',
      licensedBy: 'Hulu',
      licensedByValues: ['Hulu'],
      aliases: ['hulu'],
      domains: ['hulu.com'],
      color: '#34d399',
      freeWithAds: false
    },
    {
      id: 'disney',
      name: 'Disney+',
      licensedBy: 'Disney+',
      licensedByValues: ['Disney+', 'Disney Plus'],
      aliases: ['disney+', 'disney plus', 'disneyplus', 'star+'],
      domains: ['disneyplus.com'],
      color: '#818cf8',
      freeWithAds: false
    },
    {
      id: 'tubi',
      name: 'Tubi',
      licensedBy: 'Tubi TV',
      licensedByValues: ['Tubi TV', 'Tubi'],
      aliases: ['tubi', 'tubi tv'],
      domains: ['tubitv.com'],
      color: '#c084fc',
      freeWithAds: true
    },
    {
      id: 'retrocrush',
      name: 'RetroCrush',
      licensedBy: 'RetroCrush',
      licensedByValues: ['RetroCrush'],
      aliases: ['retrocrush', 'retro crush'],
      domains: ['retrocrush.tv'],
      color: '#fb7185',
      freeWithAds: true
    },
    {
      id: 'pluto',
      name: 'Pluto TV',
      licensedBy: 'Pluto TV',
      licensedByValues: ['Pluto TV'],
      aliases: ['pluto', 'pluto tv'],
      domains: ['pluto.tv'],
      color: '#fbbf24',
      freeWithAds: true
    },
    {
      id: 'youtube',
      name: 'YouTube',
      licensedBy: 'YouTube',
      licensedByValues: ['YouTube'],
      aliases: ['youtube', 'muse asia', 'ani-one', 'gundaminfo'],
      domains: ['youtube.com', 'youtu.be'],
      color: '#f87171',
      freeWithAds: true
    },
    {
      id: 'oceanveil',
      name: 'OceanVeil',
      licensedBy: 'OceanVeil',
      licensedByValues: ['OceanVeil'],
      aliases: ['oceanveil', 'ocean veil'],
      domains: ['oceanveil.net'],
      color: '#2dd4bf',
      freeWithAds: false
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
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1')
      .replace(/__(.*?)__/g, '$1')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/~!([\s\S]*?)!~/g, '$1')
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
      dirtyForGist: false,
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
    out.dirtyForGist = Boolean(raw.dirtyForGist);
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
          dubLag: (item.dubLag === '' || item.dubLag == null) ? null : Math.max(0, Number(item.dubLag)),
          dubDay: item.dubDay !== undefined && item.dubDay !== null ? String(item.dubDay) : '',
          customPlatforms: Array.isArray(item.customPlatforms) ? item.customPlatforms : [],
          customFreeWithAds: Boolean(item.customFreeWithAds),
          updatedAt: Number(item.updatedAt) || out.updatedAt || 0
        };
      }
    }
    out.tombstones = (raw.tombstones && typeof raw.tombstones === 'object') ? { ...raw.tombstones } : {};
    out.overrides = {};
    if (raw.overrides && typeof raw.overrides === 'object') {
      for (const [k, ovr] of Object.entries(raw.overrides)) {
        if (!ovr || typeof ovr !== 'object') continue;
        const id = Number(ovr.id || k);
        if (!id) continue;
        out.overrides[id] = {
          ...ovr,
          status: ovr.status ? normalizeStatus(ovr.status) : undefined,
          rating: ovr.rating !== undefined ? (Number(ovr.rating) || 0) : undefined,
          progress: ovr.progress !== undefined ? Math.max(0, Number(ovr.progress) || 0) : undefined,
          notes: typeof ovr.notes === 'string' ? ovr.notes : undefined,
          dubOverride: ovr.dubOverride || '',
          dubLag: (ovr.dubLag === '' || ovr.dubLag == null) ? null : Math.max(0, Number(ovr.dubLag)),
          dubDay: ovr.dubDay !== undefined && ovr.dubDay !== null ? String(ovr.dubDay) : '',
          customPlatforms: Array.isArray(ovr.customPlatforms) ? ovr.customPlatforms : [],
          customFreeWithAds: Boolean(ovr.customFreeWithAds),
          updatedAt: Number(ovr.updatedAt) || out.updatedAt || 0
        };
      }
    }

    // Harmonize legacy gistConfig / gist shapes if present
    const legacyGist = raw.gistConfig || raw.gist || {};
    out.settings = {
      ...base.settings,
      ...(raw.settings || {}),
      gistToken: (raw.settings?.gistToken ?? legacyGist.token ?? ''),
      gistId: (raw.settings?.gistId ?? legacyGist.gistId ?? legacyGist.id ?? ''),
      gistUser: raw.settings?.gistUser || '',
      gistUrl: raw.settings?.gistUrl || '',
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
  function saveState(nextState, { triggerGist = false, clearDirty = false, notify = true } = {}) {
    const existingRaw = readRawState();
    const dirtyFlag = clearDirty ? false : (triggerGist ? true : Boolean(nextState.dirtyForGist ?? existingRaw.dirtyForGist));
    const merged = {
      ...existingRaw,
      ...nextState,
      version: 2,
      updatedAt: Date.now(),
      dirtyForGist: dirtyFlag
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
      dubLag: patch.dubLag !== undefined
        ? ((patch.dubLag === '' || patch.dubLag == null) ? null : Math.max(0, Number(patch.dubLag)))
        : (prev.dubLag ?? prevOvr.dubLag ?? null),
      dubDay: patch.dubDay !== undefined
        ? String(patch.dubDay ?? '')
        : String(prev.dubDay ?? prevOvr.dubDay ?? ''),
      customPlatforms: patch.customPlatforms !== undefined ? patch.customPlatforms : (prev.customPlatforms ?? prevOvr.customPlatforms ?? []),
      customFreeWithAds: patch.customFreeWithAds !== undefined ? Boolean(patch.customFreeWithAds) : Boolean(prev.customFreeWithAds ?? prevOvr.customFreeWithAds),
      updatedAt: now
    };

    state.watchlist[id] = nextItem;
    delete state.tombstones[id]; // Revive if previously tombstoned

    // Mirror overrides cleanly
    state.overrides[id] = {
      status: nextItem.status,
      rating: nextItem.rating,
      progress: nextItem.progress,
      notes: nextItem.notes,
      dubOverride: nextItem.dubOverride,
      dubLag: nextItem.dubLag,
      dubDay: nextItem.dubDay,
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
    const prevWl = state.watchlist[id] || {};
    const next = {
      status: patch.status !== undefined ? normalizeStatus(patch.status) : (prev.status ?? prevWl.status),
      rating: patch.rating !== undefined ? (Number(patch.rating) || 0) : (prev.rating ?? prevWl.rating),
      progress: patch.progress !== undefined ? Math.max(0, Number(patch.progress) || 0) : (prev.progress ?? prevWl.progress),
      notes: patch.notes !== undefined ? String(patch.notes) : (prev.notes ?? prevWl.notes),
      dubOverride: patch.dubOverride !== undefined ? patch.dubOverride : (prev.dubOverride || ''),
      dubLag: patch.dubLag !== undefined
        ? ((patch.dubLag === '' || patch.dubLag == null) ? null : Math.max(0, Number(patch.dubLag)))
        : (prev.dubLag ?? null),
      dubDay: patch.dubDay !== undefined ? String(patch.dubDay ?? '') : String(prev.dubDay ?? ''),
      customPlatforms: patch.customPlatforms !== undefined ? patch.customPlatforms : (prev.customPlatforms || []),
      customFreeWithAds: patch.customFreeWithAds !== undefined ? Boolean(patch.customFreeWithAds) : Boolean(prev.customFreeWithAds),
      updatedAt: now
    };
    state.overrides[id] = next;
    if (state.watchlist[id]) {
      state.watchlist[id] = {
        ...state.watchlist[id],
        status: next.status ?? state.watchlist[id].status,
        rating: next.rating ?? state.watchlist[id].rating,
        progress: next.progress ?? state.watchlist[id].progress,
        notes: next.notes ?? state.watchlist[id].notes,
        dubOverride: next.dubOverride,
        dubLag: next.dubLag,
        dubDay: next.dubDay,
        customPlatforms: next.customPlatforms,
        customFreeWithAds: next.customFreeWithAds,
        updatedAt: now
      };
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
    const hadUnpushedLocalEdits = Boolean(state.dirtyForGist);
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
        if (hadUnpushedLocalEdits) {
          await gistPush({ silent: true });
        }
        return state;
      }
      const remoteData = JSON.parse(fileObj.content);
      const remoteTs = Number(remoteData?.updatedAt) || 0;
      const localTs = Number(state.updatedAt) || 0;
      const merged = mergeRemotePayload(remoteData);
      merged.settings.lastGistSync = Date.now();
      saveState(merged, { triggerGist: false, clearDirty: !hadUnpushedLocalEdits });
      setSyncStatus('synced', 'Gist Synced');
      if (hadUnpushedLocalEdits || localTs > remoteTs) {
        await gistPush({ silent: true });
      }
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
      saveState(state, { triggerGist: false, clearDirty: true, notify: false });
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
      updateSettings({
        gistToken: token,
        gistId: created.id,
        gistUrl: created.html_url || `https://gist.github.com/${created.id}`,
        gistUser: created.owner?.login || state.settings.gistUser || '',
        gistAutoSync: true,
        lastGistSync: Date.now()
      });
      setSyncStatus('synced', 'Gist Synced');
      toast(`Created private Gist (${created.id.slice(0, 8)}...)!`, 'success');
      return created.id;
    } catch (err) {
      setSyncStatus('error', 'Sync Error');
      toast(`Could not create Gist: ${err.message}`, 'error');
      return null;
    }
  }

  // Permanent Remote Storage Wizard: Verify PAT, detect GitHub username,
  // auto-discover an existing animefinder-sync.json Gist, or create one automatically.
  async function gistConnectAndSetup(token, { autoCreate = true } = {}) {
    const cleanToken = String(token || '').trim();
    if (!cleanToken) throw new Error('Paste a GitHub Personal Access Token (gist scope) first.');
    setSyncStatus('syncing', 'Verifying GitHub...');

    const headers = {
      Authorization: `Bearer ${cleanToken}`,
      Accept: 'application/vnd.github+json'
    };

    const userRes = await fetch('https://api.github.com/user', { headers });
    if (!userRes.ok) {
      setSyncStatus('error', 'Auth Failed');
      throw new Error(userRes.status === 401 ? 'Invalid or expired GitHub token.' : `GitHub auth error (${userRes.status})`);
    }
    const user = await userRes.json();
    const login = user.login || '';

    // Check existing private/public gists for animefinder-sync.json or legacy animefinder-state.json
    const gistsRes = await fetch('https://api.github.com/gists?per_page=100', { headers });
    let existing = null;
    if (gistsRes.ok) {
      const list = await gistsRes.json();
      if (Array.isArray(list)) {
        existing = list.find(g => g.files?.[GIST_FILENAME] || g.files?.[LEGACY_GIST_FILENAME]);
      }
    }

    if (existing) {
      updateSettings({
        gistToken: cleanToken,
        gistId: existing.id,
        gistUser: login,
        gistUrl: existing.html_url || `https://gist.github.com/${login}/${existing.id}`,
        gistAutoSync: true
      });
      const merged = await gistPull({ silent: true });
      // Also push back if local had newer entries not yet in Gist
      await gistPush({ silent: true });
      return { mode: 'connected_existing', login, gistId: existing.id, htmlUrl: existing.html_url, count: Object.keys(merged?.watchlist || getState().watchlist).length };
    }

    if (!autoCreate) {
      updateSettings({ gistToken: cleanToken, gistUser: login });
      return { mode: 'verified_only', login, gistId: '', htmlUrl: '' };
    }

    const createdId = await gistCreateNew(cleanToken);
    if (!createdId) throw new Error('Token verified, but creating the private Gist failed. Confirm the "gist" scope is checked.');
    updateSettings({ gistUser: login });
    const st = getState();
    return {
      mode: 'created_new',
      login,
      gistId: createdId,
      htmlUrl: st.settings.gistUrl || `https://gist.github.com/${login}/${createdId}`,
      count: Object.keys(st.watchlist || {}).length
    };
  }

  function gistDisconnect() {
    updateSettings({ gistToken: '', gistId: '', gistUser: '', gistUrl: '', lastGistSync: 0 });
    setSyncStatus('local', 'Local Storage');
  }

  function scheduleGistAutoPush() {
    const { gistToken, gistId, gistAutoSync } = getState().settings;
    if (!gistToken || !gistId || !gistAutoSync) return;
    if (gistPushTimer) clearTimeout(gistPushTimer);
    setSyncStatus('syncing', 'Queued...');
    gistPushTimer = setTimeout(() => {
      gistPushTimer = null;
      gistPush({ silent: true });
    }, 600); // Fast 600ms debounced auto-push + dirtyForGist boot recovery
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

    // 3. Server-side catalog tag if attached by Releases filter
    if (Array.isArray(anime?._matchedPlatforms)) {
      anime._matchedPlatforms.forEach(pid => {
        if (PLATFORM_BY_ID[pid]) found.add(pid);
      });
    }

    // 4. Extra streaming sources (Jikan /streaming, TMDB US Watch Providers)
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

  function getStreamingLinks(anime, jikanStreaming = []) {
    const out = [];
    const seen = new Set();
    const addLink = (name, url, color) => {
      if (!url || !/^https?:\/\//i.test(url)) return;
      const key = name.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ name, url, color: color || '#38bdf8' });
    };

    for (const link of (anime?.externalLinks || [])) {
      const site = String(link.site || '');
      const lowSite = site.toLowerCase();
      const lowUrl = String(link.url || '').toLowerCase();
      const matched = PLATFORM_CONFIG.find(p =>
        p.aliases.some(a => lowSite.includes(a)) || p.domains.some(d => lowUrl.includes(d))
      );
      if (matched) addLink(matched.name, link.url, matched.color);
    }

    for (const s of (jikanStreaming || [])) {
      const low = String(s.name || '').toLowerCase();
      const matched = PLATFORM_CONFIG.find(p => p.aliases.some(a => low.includes(a)));
      addLink(matched ? matched.name : s.name, s.url, matched?.color);
    }
    return out;
  }

  function isFreeWithAds(anime, platforms) {
    const state = getState();
    const id = Number(anime?.id);
    const ovr = id && (state.overrides[id] || state.watchlist[id]);
    if (ovr?.customFreeWithAds) return true;
    const list = platforms || detectPlatforms(anime);
    return list.some(p => p.freeWithAds);
  }

  // Verified Multi-Language Dub cache (in-memory + 24h IndexedDB).
  // CRITICAL AniList GraphQL quirk: CharacterEdge.voiceActors returns null unless `node { id }` is also selected inside `edges`!
  const verifiedDubMap = new Map();       // animeId -> boolean (EN dub confirmed)
  const verifiedDubLangsMap = new Map();  // animeId -> string[] (e.g. ['EN', 'ES', 'PT', 'FR'])

  const LANG_TO_CODE = {
    english: 'EN',
    spanish: 'ES',
    portuguese: 'PT',
    french: 'FR',
    german: 'DE',
    italian: 'IT',
    korean: 'KO',
    chinese: 'ZH',
    hebrew: 'HE',
    hungarian: 'HU',
    arabic: 'AR',
    russian: 'RU',
    thai: 'TH',
    hindi: 'HI'
  };

  function extractDubLanguages(anime) {
    const edges = anime?.characters?.edges;
    if (!Array.isArray(edges)) return null;
    if (edges.length > 0 && edges.every(e => e?.voiceActors === null)) return null;
    const langs = new Set();
    for (const e of edges) {
      for (const va of (e?.voiceActors || [])) {
        const raw = String(va?.languageV2 || '').trim().toLowerCase();
        if (!raw || raw === 'japanese') continue;
        const code = LANG_TO_CODE[raw] || raw.slice(0, 2).toUpperCase();
        langs.add(code);
      }
    }
    // Keep EN first if present
    return Array.from(langs).sort((a, b) => (a === 'EN' ? -1 : b === 'EN' ? 1 : a.localeCompare(b)));
  }

  function extractHasEnDub(anime) {
    const langs = extractDubLanguages(anime);
    if (langs === null) return null;
    return langs.includes('EN');
  }

  function getDubLanguages(anime) {
    const id = Number(anime?.id);
    if (id && verifiedDubLangsMap.has(id)) return verifiedDubLangsMap.get(id);
    const inline = extractDubLanguages(anime);
    if (inline !== null) {
      if (id) {
        verifiedDubLangsMap.set(id, inline);
        verifiedDubMap.set(id, inline.includes('EN'));
      }
      return inline;
    }
    return [];
  }

  async function verifyDubStatusBatch(animeList) {
    const list = Array.isArray(animeList) ? animeList : [];
    const toFetch = [];

    for (const item of list) {
      const id = Number(item?.id || item);
      if (!id) continue;
      if (typeof item === 'object') {
        const inlineLangs = extractDubLanguages(item);
        if (inlineLangs !== null) {
          verifiedDubLangsMap.set(id, inlineLangs);
          verifiedDubMap.set(id, inlineLangs.includes('EN'));
          continue;
        }
      }
      if (verifiedDubLangsMap.has(id)) continue;
      const cached = await cacheGet(`dub_langs_v4_${id}`);
      if (cached && Array.isArray(cached.langs)) {
        verifiedDubLangsMap.set(id, cached.langs);
        verifiedDubMap.set(id, cached.langs.includes('EN'));
      } else if (!toFetch.includes(id)) {
        toFetch.push(id);
      }
    }
    if (!toFetch.length) return verifiedDubMap;

    const query = `
      query ($ids: [Int]) {
        Page(page: 1, perPage: 50) {
          media(id_in: $ids, type: ANIME) {
            id
            characters(perPage: 5, role: MAIN) {
              edges {
                node { id }
                voiceActors { id languageV2 }
              }
            }
          }
        }
      }
    `;
    for (let start = 0; start < toFetch.length; start += 50) {
      const slice = toFetch.slice(start, start + 50);
      try {
        const data = await anilistQuery(query, { ids: slice });
        for (const m of (data?.Page?.media || [])) {
          if (!m || !m.id) continue;
          const langs = extractDubLanguages(m);
          if (langs !== null) {
            verifiedDubLangsMap.set(m.id, langs);
            verifiedDubMap.set(m.id, langs.includes('EN'));
            await cacheSet(`dub_langs_v4_${m.id}`, { langs }, TTL_STABLE);
          }
        }
      } catch (err) {
        console.warn('Batch dub language verification warning:', err.message);
      }
    }
    return verifiedDubMap;
  }

  // Factual dub classifier: honors user override & dubLag first, then verified EN VA check.
  // Never assumes same-day "Simuldub" on releasing shows unless dubLag === 0 or dubOverride === 'Simuldub'.
  function classifyDub(anime) {
    const state = getState();
    const id = Number(anime?.id);
    const ovr = id && (state.overrides[id] || state.watchlist[id]);
    if (ovr && ovr.dubLag === 0 && ovr.dubOverride !== 'Sub Only') return 'Simuldub';
    if (ovr?.dubOverride) return ovr.dubOverride === 'Dubbed' ? 'EN Dub' : ovr.dubOverride;
    if (ovr && typeof ovr.dubLag === 'number' && ovr.dubLag > 0) return 'Staggered Dub';

    const langs = getDubLanguages(anime);
    const hasEnVa = langs.includes('EN') || (id && verifiedDubMap.get(id) === true);
    if (hasEnVa) {
      return anime?.status === 'RELEASING' ? 'EN Dub (Ongoing)' : 'EN Dub';
    }
    return 'Sub / No EN VA';
  }

  // Computes Dual-Track release metadata (JP Sub vs Delayed/Simul EN Dub + extra dub languages)
  function getDubTrackInfo(anime, currentSubEp = null) {
    const state = getState();
    const id = Number(anime?.id);
    const ovr = (id && (state.overrides[id] || state.watchlist[id])) || {};
    const dub = classifyDub(anime);
    const langs = getDubLanguages(anime);
    const otherLangs = langs.filter(l => l !== 'EN');
    const isSubOnly = dub === 'Sub / No EN VA' || dub === 'Sub Only';
    const isSimuldub = dub === 'Simuldub' || ovr.dubLag === 0;
    const dubLag = (typeof ovr.dubLag === 'number' && !Number.isNaN(ovr.dubLag)) ? ovr.dubLag : null;
    const dubDay = ovr.dubDay !== undefined && ovr.dubDay !== '' ? Number(ovr.dubDay) : null; // 0=Mon..6=Sun

    let dubEp = null;
    if (!isSubOnly && typeof currentSubEp === 'number' && currentSubEp > 0) {
      if (isSimuldub) dubEp = currentSubEp;
      else if (dubLag !== null && currentSubEp - dubLag >= 1) dubEp = currentSubEp - dubLag;
    }

    return {
      dub,
      hasEnDub: !isSubOnly,
      isSimuldub,
      dubLag,
      dubDay,
      dubEp,
      langs,
      otherLangs
    };
  }

  // --------------------------------------------------------------------------
  // AniList GraphQL Client
  // --------------------------------------------------------------------------
  const MEDIA_CARD_FIELDS = `
    id
    idMal
    countryOfOrigin
    source
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
    trailer { id site thumbnail }
    studios(isMain: true) { nodes { id name } }
    tags { name rank isMediaSpoiler isGeneralSpoiler }
    externalLinks { site url type }
    nextAiringEpisode { airingAt timeUntilAiring episode }
    relations {
      edges {
        relationType
        node { id }
      }
    }
    characters(perPage: 4, role: MAIN) {
      edges {
        node { id }
        voiceActors { id languageV2 }
      }
    }
    staff(perPage: 25, sort: RELEVANCE) {
      edges {
        role
        node { id name { full } }
      }
    }
  `;

  function formatSourceLabel(source) {
    const map = {
      ORIGINAL: 'Original',
      MANGA: 'Manga',
      LIGHT_NOVEL: 'Light Novel',
      VISUAL_NOVEL: 'Visual Novel',
      VIDEO_GAME: 'Video Game',
      NOVEL: 'Novel',
      WEB_NOVEL: 'Web Novel',
      DOUJINSHI: 'Doujinshi',
      COMIC: 'Comic',
      GAME: 'Game',
      MULTIMEDIA_PROJECT: 'Multimedia',
      PICTURE_BOOK: 'Picture Book',
      OTHER: 'Other'
    };
    return map[source] || '';
  }

  function getTopSubgenreTags(anime, max = 3) {
    return (anime?.tags || [])
      .filter(t => t && !t.isMediaSpoiler && !t.isGeneralSpoiler && (t.rank || 0) >= 55)
      .sort((a, b) => (b.rank || 0) - (a.rank || 0))
      .slice(0, max)
      .map(t => t.name);
  }

  function getKeyStaff(anime) {
    const edges = anime?.staff?.edges || [];
    const buckets = [
      { key: 'Director', re: /^(chief )?director$/i },
      { key: 'Series Comp', re: /series composition/i },
      { key: 'Char Design', re: /character design/i },
      { key: 'Music', re: /^(music|original music|music composition)$/i }
    ];
    const out = [];
    const seen = new Set();
    for (const b of buckets) {
      for (const e of edges) {
        const name = e?.node?.name?.full;
        if (!name || seen.has(b.key + ':' + name)) continue;
        if (b.re.test(String(e.role || ''))) {
          seen.add(b.key + ':' + name);
          out.push({ role: b.key, name });
          break;
        }
      }
    }
    return out;
  }

  function isSequelOrRecap(anime) {
    const edges = anime?.relations?.edges || [];
    return edges.some(e => e?.relationType === 'PREQUEL' || e?.relationType === 'SUMMARY' || e?.relationType === 'PARENT');
  }

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
      cacheKey: `anilist_media_v3_${id}`,
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
    const explicitGenres = new Set();
    const explicitTags = new Set();
    const layersUsed = [];
    let decadeRange = null;

    // Decade detection (e.g. 90s, 1980s, 2000s, 00s, 70s)
    const decMatch = lower.match(/\b(19[6-9]0|20[0-2]0|[6-9]0|00|10|20)s\b/);
    if (decMatch) {
      let yr = parseInt(decMatch[1], 10);
      if (yr < 30) yr += 2000;
      else if (yr < 100) yr += 1900;
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
        const g = genreMap.get(candidate);
        matchedGenres.add(g);
        explicitGenres.add(g);
        layer1Hit = true;
      }
      if (tagMap.has(candidate)) {
        const t = tagMap.get(candidate);
        matchedTags.add(t);
        explicitTags.add(t);
        layer1Hit = true;
      } else if (tagSingularMap.has(candidate) && candidate.length > 3) {
        const t = tagSingularMap.get(candidate);
        matchedTags.add(t);
        explicitTags.add(t);
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
      explicitGenres: Array.from(explicitGenres),
      explicitTags: Array.from(explicitTags),
      decadeRange,
      layersUsed
    };
  }

  async function fetchVibeCandidates(parsed, { limit = 26, maxPopularity = null } = {}) {
    const genres = parsed.genres || [];
    const tags = parsed.tags || [];
    const expTags = parsed.explicitTags?.length ? parsed.explicitTags : tags;
    const expGenres = parsed.explicitGenres?.length ? parsed.explicitGenres : genres;
    const dec = parsed.decadeRange;

    // IMPORTANT: On AniList GraphQL, tag_in & genre_in use AND (intersection) semantics!
    // We batch pairwise intersections + individual tag/genre union aliases in ONE request.
    const buildQuery = (useMinRank) => {
      const parts = [];
      const vars = {};
      const varDefs = [];
      const dateArgs = dec ? `, startDate_greater: ${dec.start}, startDate_lesser: ${dec.end}` : '';
      const popArgs = maxPopularity ? `, popularity_lesser: ${maxPopularity}` : '';
      const minRankArg = useMinRank ? ', minimumTagRank: 55' : '';

      if (expTags.length >= 2) {
        vars.pairTags = expTags.slice(0, 2);
        varDefs.push('$pairTags: [String]');
        parts.push(`pair: Page(page: 1, perPage: 20) { media(type: ANIME, isAdult: false, tag_in: $pairTags${minRankArg}${dateArgs}${popArgs}, sort: [SCORE_DESC, POPULARITY_DESC]) { ${MEDIA_CARD_FIELDS} } }`);
      }

      // Query each primary tag individually for OR union (up to 4 tags)
      const unionTags = [...new Set([...expTags, ...tags])].slice(0, 4);
      unionTags.forEach((tagName, idx) => {
        const vName = `t${idx}`;
        vars[vName] = tagName;
        varDefs.push(`$${vName}: String`);
        parts.push(`tag_${idx}: Page(page: 1, perPage: 16) { media(type: ANIME, isAdult: false, tag: $${vName}${minRankArg}${dateArgs}${popArgs}, sort: [SCORE_DESC, POPULARITY_DESC]) { ${MEDIA_CARD_FIELDS} } }`);
      });

      // Query genres individually only when no explicit tags matched (or as supplemental union when tags are few)
      if (expGenres.length > 0 && expTags.length < 2) {
        expGenres.slice(0, 3).forEach((gName, idx) => {
          const vName = `g${idx}`;
          vars[vName] = gName;
          varDefs.push(`$${vName}: String`);
          parts.push(`gen_${idx}: Page(page: 1, perPage: 16) { media(type: ANIME, isAdult: false, genre: $${vName}${dateArgs}${popArgs}, sort: [SCORE_DESC, POPULARITY_DESC]) { ${MEDIA_CARD_FIELDS} } }`);
        });
      }

      if (parts.length === 0) {
        vars.search = parsed.raw || 'anime';
        varDefs.push('$search: String');
        parts.push(`fallback: Page(page: 1, perPage: 24) { media(type: ANIME, isAdult: false, search: $search${dateArgs}${popArgs}, sort: [SEARCH_MATCH, SCORE_DESC]) { ${MEDIA_CARD_FIELDS} } }`);
      }

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

    const cacheId = `vibe_v3_${(parsed.raw || '').toLowerCase()}_${expTags.join(',')}_${tags.join(',')}_${genres.join(',')}_${dec?.label || ''}_${maxPopularity || 'all'}`;
    let { query, vars } = buildQuery(true);
    let data = await anilistQuery(query, vars, { cacheKey: cacheId, ttl: TTL_DYNAMIC });
    let items = collectUnique(data);

    // Automatic retry without minimumTagRank if niche tag yields fewer than 6 titles
    if (items.length < 6 && tags.length > 0) {
      ({ query, vars } = buildQuery(false));
      data = await anilistQuery(query, vars, { cacheKey: cacheId + '_relaxed', ttl: TTL_DYNAMIC });
      items = collectUnique(data);
    }

    // Score & rank by explicit tag coverage + mood tag ranks + genre alignment
    const expTagSet = new Set(expTags.map(t => t.toLowerCase()));
    const moodTagSet = new Set(tags.map(t => t.toLowerCase()));
    const expGenreSet = new Set(expGenres.map(g => g.toLowerCase()));
    const moodGenreSet = new Set(genres.map(g => g.toLowerCase()));

    items.forEach(m => {
      let score = 0;
      let explicitHits = 0;
      for (const t of (m.tags || [])) {
        const tl = t.name.toLowerCase();
        if (expTagSet.has(tl)) {
          score += (t.rank || 55) * 2.4;
          explicitHits++;
        } else if (moodTagSet.has(tl)) {
          score += (t.rank || 50) * 0.9;
        }
      }
      for (const g of (m.genres || [])) {
        const gl = g.toLowerCase();
        if (expGenreSet.has(gl)) {
          score += 65;
          explicitHits++;
        } else if (moodGenreSet.has(gl)) {
          score += 22;
        }
      }
      // Coverage multiplier: hitting multiple explicit concepts dominates single-tag overlap
      if (explicitHits >= 2) score *= (1 + explicitHits * 0.45);
      score += (m.averageScore || 65) * 0.35;
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

  function normalizeTitleKey(str) {
    return String(str || '')
      .toLowerCase()
      .replace(/\(.*?\)/g, ' ')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\b(the|a|an|season|part|tv|anime|movie)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function titlesMatch(expectedTitles, candidate) {
    const cand = normalizeTitleKey(candidate);
    if (!cand || cand.length < 2) return false;
    const candWords = new Set(cand.split(' ').filter(w => w.length >= 2));
    for (const rawExp of expectedTitles) {
      const exp = normalizeTitleKey(rawExp);
      if (!exp) continue;
      if (cand === exp || cand.includes(exp) || exp.includes(cand)) return true;
      const expWords = exp.split(' ').filter(w => w.length >= 2);
      if (!expWords.length) continue;
      let hits = 0;
      for (const w of expWords) if (candWords.has(w)) hits++;
      if (hits / Math.max(expWords.length, candWords.size) >= 0.55) return true;
    }
    return false;
  }

  async function fetchWikipediaSummary(title, altTitles = []) {
    if (!title) return null;
    const cacheKey = `wiki_v3_${title.toLowerCase()}`;
    const cached = await cacheGet(cacheKey);
    if (cached) return cached;

    const allTitles = [title, ...altTitles].filter(Boolean);
    const ANIME_CONTEXT_RE = /\b(anime|manga|light novel|japanese animated|animated television series|animated film|original video animation|ova|ona|studio ghibli|kyoto animation|madhouse|mappa|toei animation|shonen|shounen|seinen|shoujo|josei|visual novel)\b/i;

    const trySummary = async (pageTitle) => {
      const data = await fetchJsonSafe(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageTitle)}`);
      if (data && data.extract && data.type !== 'disambiguation') {
        const text = `${data.description || ''} ${data.extract || ''}`;
        if (ANIME_CONTEXT_RE.test(text) && titlesMatch(allTitles, data.title)) {
          return {
            title: data.title,
            extract: data.extract,
            url: data.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(data.title)}`
          };
        }
      }
      return null;
    };

    // Use MediaWiki opensearch (always HTTP 200, zero 404 console errors) and skip "List of..." / "Episodes of..." articles
    const search = await fetchJsonSafe(`https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(title)}&limit=6&format=json&origin=*`);
    const searchAnime = await fetchJsonSafe(`https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(title + ' anime')}&limit=4&format=json&origin=*`);
    const rawCandidates = [
      ...(Array.isArray(search?.[1]) ? search[1] : []),
      ...(Array.isArray(searchAnime?.[1]) ? searchAnime[1] : [])
    ].filter(c => c && !/^(list of|episodes of|characters of|music of)\b/i.test(c));

    // Prefer exact title or "(anime)" over "(manga)" or spin-offs
    rawCandidates.sort((a, b) => {
      const score = (s) => {
        const sl = s.toLowerCase();
        if (sl === title.toLowerCase()) return 3;
        if (sl.includes('(anime)')) return 2.5;
        if (sl.includes('(tv series)') || sl.includes('(film)')) return 2;
        return 1;
      };
      return score(b) - score(a);
    });

    const seenWiki = new Set();
    let result = null;
    for (const c of rawCandidates) {
      if (seenWiki.has(c.toLowerCase())) continue;
      seenWiki.add(c.toLowerCase());
      result = await trySummary(c);
      if (result) break;
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
    const hit = (search?.results || []).find(r => (r.media_type === 'tv' || r.media_type === 'movie') && titlesMatch([title], r.name || r.title || r.original_name || r.original_title));
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
    const cacheKey = `multisrc_v2_${anime.id}`;
    const tmdbKey = getState().settings.tmdbKey || '';
    const cached = await cacheGet(cacheKey);
    if (cached && (!tmdbKey || cached.tmdb !== undefined)) return cached;

    const title = getDisplayTitle(anime);
    const altTitles = [anime.title?.english, anime.title?.romaji].filter(Boolean);
    const malId = anime.idMal;

    const jikanTask = malId
      ? (async () => {
          const full = await fetchJsonSafe(`https://api.jikan.moe/v4/anime/${malId}/full`, 7500);
          if (!full?.data) return null;
          const streaming = full.data.streaming || [];
          return {
            score: full.data.score,
            rank: full.data.rank,
            rating: full.data.rating,
            url: full.data.url,
            streaming: streaming.map(s => ({ name: s.name, url: s.url }))
          };
        })()
      : Promise.resolve(null);

    // Kitsu: inspect top 5 and verify title + year match to avoid wrong seasons/unrelated hits
    const kitsuTask = (async () => {
      const data = await fetchJsonSafe(`https://kitsu.io/api/edge/anime?filter[text]=${encodeURIComponent(title)}&page[limit]=5`);
      const items = data?.data || [];
      const best = items.find(item => {
        const a = item.attributes || {};
        const cands = [a.canonicalTitle, a.titles?.en, a.titles?.en_jp].filter(Boolean);
        const yearOk = !anime.seasonYear || !a.startDate || Math.abs(Number(a.startDate.slice(0, 4)) - anime.seasonYear) <= 1;
        return yearOk && cands.some(c => titlesMatch(altTitles, c));
      }) || items.find(item => {
        const a = item.attributes || {};
        return [a.canonicalTitle, a.titles?.en, a.titles?.en_jp].some(c => titlesMatch(altTitles, c));
      });
      if (!best) return null;
      return {
        rating: best.attributes?.averageRating,
        slug: best.attributes?.slug,
        ageRating: best.attributes?.ageRatingGuide,
        url: best.attributes?.slug ? `https://kitsu.app/anime/${best.attributes.slug}` : ''
      };
    })();

    // Shikimori blocks browser CORS from static origins — provide clean direct link instead of firing a failing CORS request
    const shikimoriTask = Promise.resolve(malId ? { url: `https://shikimori.one/animes/${malId}` } : null);

    // TVMaze: use /search/shows and strictly require Animation/Japanese + title match
    const tvmazeTask = (async () => {
      const results = await fetchJsonSafe(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(title)}`, 4500);
      if (!Array.isArray(results)) return null;
      const hit = results.map(r => r.show).find(s => {
        if (!s || !s.name) return false;
        const isAnim = s.type === 'Animation' || s.language === 'Japanese' || (s.genres || []).includes('Anime');
        return isAnim && titlesMatch(altTitles, s.name);
      });
      if (!hit) return null;
      return {
        rating: hit.rating?.average,
        network: hit.network?.name || hit.webChannel?.name || '',
        status: hit.status,
        url: hit.url
      };
    })();

    const wikiTask = fetchWikipediaSummary(title, altTitles);
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

    // Mount global floating Back-to-Top button for long scrollable views
    if (!document.getElementById('af-back-to-top')) {
      const btn = document.createElement('button');
      btn.id = 'af-back-to-top';
      btn.type = 'button';
      btn.className = 'back-to-top-btn';
      btn.setAttribute('aria-label', 'Back to top and filters');
      btn.innerHTML = '↑ Top';
      btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
      document.body.appendChild(btn);
      const toggleVis = () => btn.classList.toggle('visible', window.scrollY > 420);
      window.addEventListener('scroll', toggleVis, { passive: true });
      toggleVis();
    }
  }

  // Accessible Modal Focus Management (P1)
  let lastFocusedEl = null;
  let activeModalAnime = null;
  let activeModalFlushFn = null;

  global.addEventListener('beforeunload', () => {
    if (typeof activeModalFlushFn === 'function') {
      try { activeModalFlushFn(); } catch {}
    }
  });

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
        <div class="modal-footer" id="af-modal-footer" hidden></div>
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
    if (typeof activeModalFlushFn === 'function') {
      try { activeModalFlushFn(); } catch {}
      activeModalFlushFn = null;
    }
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
    const footerEl = backdrop.querySelector('#af-modal-footer');
    backdrop.classList.add('open');
    bodyEl.innerHTML = `<div class="empty-state"><span class="spinner"></span> Loading details...</div>`;
    if (footerEl) { footerEl.innerHTML = ''; footerEl.hidden = true; }
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
    // Always verify factual EN dub status via root Media(id) if not yet cached
    await verifyDubStatusBatch([anime]);

    const state = getState();
    const wl = state.watchlist[anime.id] || null;
    const ovr = state.overrides[anime.id] || wl || {};
    const curStatus = wl?.status || ovr?.status || 'Plan to Watch';
    const curRating = Number(wl?.rating ?? ovr?.rating ?? 0);
    const curProgress = Number(wl?.progress ?? ovr?.progress ?? 0);
    const curNotes = wl?.notes ?? ovr?.notes ?? '';
    const title = getDisplayTitle(anime);
    const cover = getCover(anime);
    const studioNodes = anime.studios?.nodes || [];
    const studiosHtml = studioNodes.length
      ? studioNodes.map(s => `<a href="./index.html?tab=archives&amp;studio=${encodeURIComponent(s.name)}" style="color:var(--cyan);font-weight:600;">${escapeHtml(s.name)}</a>`).join(', ')
      : 'Unknown Studio';
    const sourceLabel = formatSourceLabel(anime.source);
    const keyStaff = getKeyStaff(anime);
    const topTags = getTopSubgenreTags(anime, 5);
    const platforms = detectPlatforms(anime);
    const dubInfo = getDubTrackInfo(anime, anime.nextAiringEpisode ? Math.max(1, anime.nextAiringEpisode.episode - 1) : null);
    const dubLabel = dubInfo.dub;
    const freeAds = isFreeWithAds(anime, platforms);
    const DAY_OPTS = [
      { v: '', l: 'Same day as Sub' },
      { v: '0', l: 'Monday' }, { v: '1', l: 'Tuesday' }, { v: '2', l: 'Wednesday' },
      { v: '3', l: 'Thursday' }, { v: '4', l: 'Friday' }, { v: '5', l: 'Saturday' }, { v: '6', l: 'Sunday' }
    ];

    titleEl.textContent = title;

    const ytTrailerId = anime.trailer?.site === 'youtube' ? anime.trailer.id : null;
    const justWatchUrl = `https://www.justwatch.com/us/search?q=${encodeURIComponent(title)}`;

    const cleanSynopsis = stripHtml(anime.description || '')
      .replace(/\s*(\(Source:[^)]+\)|\[Written by[^\]]+\])\s*/gi, ' ')
      .trim() || 'No synopsis available.';
    const isLongSynopsis = cleanSynopsis.length > 260;

    bodyEl.innerHTML = `
      <div class="detail-hero">
        <img class="detail-cover" src="${escapeHtml(cover)}" alt="${escapeHtml(title)} cover">
        <div style="display:flex;flex-direction:column;gap:10px;min-width:0;">
          <div class="meta-row">
            ${anime.averageScore ? `<span class="badge badge-emerald">★ ${anime.averageScore}%</span>` : ''}
            ${anime.format ? `<span class="badge badge-accent">${escapeHtml(anime.format)}</span>` : ''}
            ${sourceLabel ? `<span class="badge ${anime.source === 'ORIGINAL' ? 'badge-amber' : 'badge-purple'}">${anime.source === 'ORIGINAL' ? '★ Anime Original' : escapeHtml(sourceLabel)}</span>` : ''}
            ${anime.seasonYear ? `<span class="badge badge-muted">${escapeHtml(anime.season || '')} ${anime.seasonYear}</span>` : ''}
            ${anime.episodes ? `<span class="badge badge-muted">${anime.episodes === 1 ? '1 ep' : anime.episodes + ' eps'}${anime.duration ? ' · ' + anime.duration + 'm' : ''}</span>` : ''}
            <span class="badge badge-cyan" id="af-modal-dub-badge" title="Verified from AniList English voice actors or user override">${escapeHtml(dubLabel)}</span>
            ${freeAds ? `<span class="badge badge-amber">Free w/ Ads</span>` : ''}
            <span class="badge badge-muted">Pop: ${formatCompactNumber(anime.popularity)}</span>
          </div>
          <div style="font-size:12.5px;color:var(--text-muted);">
            <strong>Studio:</strong> ${studiosHtml} &nbsp;•&nbsp; <strong>Genres:</strong> ${escapeHtml((anime.genres || []).join(', ') || '—')}
          </div>
          <div class="meta-row" style="gap:5px;">
            <span style="font-size:11.5px;color:var(--text-dim);font-weight:700;">AUDIO TRACKS:</span>
            <span class="badge badge-muted">JP Sub</span>
            ${dubInfo.langs.length
              ? dubInfo.langs.map(l => `<span class="badge ${l === 'EN' ? 'badge-cyan' : 'badge-purple'}">${escapeHtml(l)} Dub</span>`).join('')
              : '<span style="font-size:11.5px;color:var(--text-dim);">No dubbed VAs indexed on AniList</span>'}
          </div>
          ${keyStaff.length ? `
            <div class="meta-row" style="gap:6px;">
              <span style="font-size:11.5px;color:var(--text-dim);font-weight:700;">STAFF:</span>
              ${keyStaff.map(st => `<a class="badge badge-muted" href="./eclectic-lab.html?tab=auteur&amp;staff=${encodeURIComponent(st.name)}" title="Open in Auteur &amp; Staff Tree" style="text-decoration:none;"><strong style="color:var(--accent);">${escapeHtml(st.role)}:</strong>&nbsp;${escapeHtml(st.name)} ↗</a>`).join('')}
            </div>
          ` : ''}
          ${topTags.length ? `
            <div class="meta-row" style="gap:5px;">
              <span style="font-size:11.5px;color:var(--text-dim);font-weight:700;">TAGS:</span>
              ${topTags.map(t => `<a class="badge badge-accent" href="./vibe-graph.html?vibe=${encodeURIComponent(t)}" title="Explore #${escapeHtml(t)} in Taste Graph" style="text-decoration:none;">#${escapeHtml(t)}</a>`).join('')}
            </div>
          ` : ''}
          <p id="af-modal-synopsis" class="${isLongSynopsis ? 'synopsis-clamped' : ''}" style="margin:0;font-size:13px;color:#cbd5e1;white-space:pre-line;line-height:1.55;">
            ${escapeHtml(cleanSynopsis)}
          </p>
          ${isLongSynopsis ? `<button type="button" class="synopsis-toggle" id="af-synopsis-toggle">Read full synopsis ▾</button>` : ''}
          <div class="meta-row" style="margin-top:auto;">
            <a class="btn btn-primary btn-sm" href="./vibe-graph.html?seed=${anime.id}">Explore in Taste Graph</a>
            <a class="btn btn-cyan btn-sm" href="./eclectic-lab.html?tab=arithmetic&seed=${anime.id}">Send to Arithmetic</a>
            ${ytTrailerId ? `<button type="button" class="btn btn-sm" id="af-toggle-trailer">▶ Watch Official Trailer</button>` : ''}
            <a class="btn btn-sm" href="${justWatchUrl}" target="_blank" rel="noopener">JustWatch US ↗</a>
            <a class="btn btn-sm" href="https://anilist.co/anime/${anime.id}" target="_blank" rel="noopener">AniList ↗</a>
            ${anime.idMal ? `<a class="btn btn-sm" href="https://myanimelist.net/anime/${anime.idMal}" target="_blank" rel="noopener">MAL ↗</a>` : ''}
          </div>
          <div id="af-trailer-slot"></div>
        </div>
      </div>

      <div class="detail-section">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
          <h4 style="margin:0;">Watchlist &amp; Personal Tracking</h4>
          <span id="af-autosave-badge" class="badge badge-muted" style="font-size:11px;">Changes auto-save on edit</span>
        </div>
        <div class="form-grid">
          <div class="form-field">
            <label for="af-wl-status">Status</label>
            <select id="af-wl-status" class="select">
              ${WATCHLIST_STATUSES.map(st => `<option value="${st}" ${curStatus === st ? 'selected' : ''}>${st}</option>`).join('')}
            </select>
          </div>
          <div class="form-field">
            <label for="af-wl-rating">Rating (0–10)</label>
            <select id="af-wl-rating" class="select">
              <option value="0">Unrated</option>
              ${[10,9,8,7,6,5,4,3,2,1].map(r => `<option value="${r}" ${curRating === r ? 'selected' : ''}>${r} / 10</option>`).join('')}
            </select>
          </div>
          <div class="form-field">
            <label for="af-wl-progress">Episodes Watched</label>
            <div style="display:flex;gap:6px;">
              <input id="af-wl-progress" type="number" min="0" max="${anime.episodes || 9999}" class="input input-full" value="${curProgress}">
              <button type="button" class="btn btn-sm" id="af-wl-inc" title="Increment episode">+1</button>
            </div>
          </div>
          <div class="form-field">
            <label for="af-wl-dub">Dub Classification Override</label>
            <select id="af-wl-dub" class="select">
              ${DUB_OPTIONS.map(d => `<option value="${d}" ${(ovr.dubOverride || '') === d ? 'selected' : ''}>${d || 'Auto (' + dubLabel + ')'}</option>`).join('')}
            </select>
          </div>
          <div class="form-field">
            <label for="af-wl-dublag">Dub Episode Delay (Lag behind Sub)</label>
            <input id="af-wl-dublag" type="number" min="0" max="1500" class="input input-full" placeholder="Blank=unset, 0=Simuldub, 2=2w lag" value="${ovr.dubLag ?? ''}">
          </div>
          <div class="form-field">
            <label for="af-wl-dubday">Delayed Dub Release Day</label>
            <select id="af-wl-dubday" class="select">
              ${DAY_OPTS.map(o => `<option value="${o.v}" ${String(ovr.dubDay ?? '') === o.v ? 'selected' : ''}>${o.l}</option>`).join('')}
            </select>
          </div>
        </div>
        <div style="font-size:11.5px;color:var(--text-dim);margin-top:6px;">
          Set <strong>Dub Episode Delay</strong> (e.g. <code>2</code> for a 2-week Crunchyroll delay, <code>4</code> for HIDIVE, or <code>0</code> for same-day Simuldub) to display both <strong>Sub Ep N</strong> and <strong>EN Dub Ep (N − lag)</strong> as separate tracks in Releases &amp; the 7-Day Schedule.
        </div>
        <div class="form-field" style="margin-top:10px;">
          <label for="af-wl-notes">Personal Notes</label>
          <textarea id="af-wl-notes" class="textarea" placeholder="Thoughts, arc reminders, why you added it...">${escapeHtml(curNotes)}</textarea>
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
      </div>

      <div class="detail-section">
        <h4>Streaming &amp; Multi-Source Metadata (Jikan · Kitsu · TVMaze · Wikipedia · TMDB US)</h4>
        <div id="af-multisrc-area" style="font-size:13px;color:var(--text-muted);">
          <span class="spinner"></span> Querying Jikan v4, Kitsu, TVMaze, Wikipedia${state.settings.tmdbKey ? ' &amp; TMDB US' : ''}...
        </div>
      </div>
    `;

    // Sticky modal footer so Watchlist actions are always 1 click away on laptop viewports
    if (footerEl) {
      footerEl.hidden = false;
      footerEl.innerHTML = `
        <button type="button" class="btn btn-emerald" id="af-wl-save">${wl ? 'Update Watchlist' : '+ Add to Watchlist'}</button>
        <button type="button" class="btn btn-sm" id="af-ovr-only">Save Platform/Dub Overrides Only</button>
        ${wl ? `<button type="button" class="btn btn-danger btn-sm" id="af-wl-remove" style="margin-left:auto;">Remove from Watchlist</button>` : ''}
      `;
    }

    const synToggle = bodyEl.querySelector('#af-synopsis-toggle');
    if (synToggle) {
      synToggle.addEventListener('click', () => {
        const p = bodyEl.querySelector('#af-modal-synopsis');
        const expanded = !p.classList.contains('synopsis-clamped');
        p.classList.toggle('synopsis-clamped', expanded);
        synToggle.textContent = expanded ? 'Read full synopsis ▾' : 'Show less ▴';
      });
    }

    // Wire official trailer toggle if available
    const trailerBtn = bodyEl.querySelector('#af-toggle-trailer');
    if (trailerBtn && ytTrailerId) {
      trailerBtn.addEventListener('click', () => {
        const slot = bodyEl.querySelector('#af-trailer-slot');
        if (slot.innerHTML) {
          slot.innerHTML = '';
          trailerBtn.textContent = '▶ Watch Official Trailer';
        } else {
          slot.innerHTML = `<div class="trailer-embed-wrap"><iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(ytTrailerId)}?autoplay=1" title="Official Trailer" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`;
          trailerBtn.textContent = '✕ Hide Trailer';
        }
      });
    }

    // Wire custom platform pills & instant auto-save across all personal tracking fields
    const customSet = new Set(ovr.customPlatforms || []);
    let customFree = Boolean(ovr.customFreeWithAds);
    let modalAutoSaveTimer = null;
    let pendingAutoSaveMode = null; // 'watchlist' | 'overrides'

    const readDubScheduleInputs = () => {
      const rawLag = bodyEl.querySelector('#af-wl-dublag')?.value.trim() ?? '';
      return {
        dubOverride: bodyEl.querySelector('#af-wl-dub').value,
        dubLag: rawLag === '' ? null : Math.max(0, Number(rawLag)),
        dubDay: bodyEl.querySelector('#af-wl-dubday')?.value ?? ''
      };
    };

    const readAllModalTrackingFields = () => ({
      status: bodyEl.querySelector('#af-wl-status')?.value || 'Plan to Watch',
      rating: Number(bodyEl.querySelector('#af-wl-rating')?.value) || 0,
      progress: Math.max(0, Number(bodyEl.querySelector('#af-wl-progress')?.value) || 0),
      notes: bodyEl.querySelector('#af-wl-notes')?.value ?? '',
      ...readDubScheduleInputs(),
      customPlatforms: Array.from(customSet),
      customFreeWithAds: customFree
    });

    const markAutoSavedBadge = (labelText = '✓ Auto-saved') => {
      const badge = bodyEl.querySelector('#af-autosave-badge');
      if (badge) {
        badge.className = 'badge badge-emerald';
        badge.textContent = labelText;
      }
      const saveBtn = backdrop.querySelector('#af-wl-save');
      if (saveBtn && getState().watchlist[anime.id]) {
        saveBtn.textContent = '✓ Saved in Watchlist';
      }
    };

    const syncModalHeroDubBadge = () => {
      const heroDubBadge = bodyEl.querySelector('#af-modal-dub-badge');
      if (heroDubBadge) {
        heroDubBadge.textContent = classifyDub(anime);
      }
    };

    const persistModalChangesNow = (mode = 'watchlist') => {
      if (modalAutoSaveTimer) {
        clearTimeout(modalAutoSaveTimer);
        modalAutoSaveTimer = null;
      }
      pendingAutoSaveMode = null;
      if (!bodyEl.querySelector('#af-wl-status')) return;
      const fields = readAllModalTrackingFields();
      const inWl = Boolean(getState().watchlist[anime.id]);
      if (mode === 'watchlist' || inWl) {
        upsertWatchlistItem(anime, fields);
        markAutoSavedBadge('✓ Auto-saved to Watchlist');
      } else {
        updateOverrides(anime.id, fields);
        markAutoSavedBadge('✓ Overrides auto-saved');
      }
      syncModalHeroDubBadge();
    };

    const scheduleModalAutoSave = (mode = 'watchlist', immediate = false) => {
      if (pendingAutoSaveMode !== 'watchlist') {
        pendingAutoSaveMode = mode;
      }
      if (immediate) {
        persistModalChangesNow(pendingAutoSaveMode);
        return;
      }
      const badge = bodyEl.querySelector('#af-autosave-badge');
      if (badge) {
        badge.className = 'badge badge-cyan';
        badge.textContent = 'Saving...';
      }
      if (modalAutoSaveTimer) clearTimeout(modalAutoSaveTimer);
      modalAutoSaveTimer = setTimeout(() => {
        persistModalChangesNow(pendingAutoSaveMode || mode);
      }, 250);
    };

    activeModalFlushFn = () => {
      if (modalAutoSaveTimer || pendingAutoSaveMode) {
        persistModalChangesNow(pendingAutoSaveMode || 'watchlist');
      }
    };

    bodyEl.querySelectorAll('#af-custom-platforms [data-pid]').forEach(btn => {
      btn.addEventListener('click', () => {
        const pid = btn.dataset.pid;
        if (customSet.has(pid)) { customSet.delete(pid); btn.classList.remove('active'); }
        else { customSet.add(pid); btn.classList.add('active'); }
        scheduleModalAutoSave('overrides', true);
      });
    });
    const freeBtn = bodyEl.querySelector('#af-custom-free-ads');
    freeBtn.addEventListener('click', () => {
      customFree = !customFree;
      freeBtn.classList.toggle('active', customFree);
      scheduleModalAutoSave('overrides', true);
    });

    bodyEl.querySelector('#af-wl-inc').addEventListener('click', () => {
      const inp = bodyEl.querySelector('#af-wl-progress');
      inp.value = String((Number(inp.value) || 0) + 1);
      scheduleModalAutoSave('watchlist', true);
    });

    // Attach instant auto-save listeners to all personal tracking & dub/schedule inputs
    ['#af-wl-status', '#af-wl-rating'].forEach(sel => {
      bodyEl.querySelector(sel)?.addEventListener('change', () => scheduleModalAutoSave('watchlist', true));
    });
    const dubSelect = bodyEl.querySelector('#af-wl-dub');
    const lagInput = bodyEl.querySelector('#af-wl-dublag');
    const dubDaySelect = bodyEl.querySelector('#af-wl-dubday');

    if (dubSelect) {
      dubSelect.addEventListener('change', () => {
        if (dubSelect.value === 'Simuldub' && lagInput) {
          lagInput.value = '0';
          if (dubDaySelect) dubDaySelect.value = '';
        } else if (dubSelect.value === 'Sub Only' && lagInput) {
          lagInput.value = '';
          if (dubDaySelect) dubDaySelect.value = '';
        }
        scheduleModalAutoSave('overrides', true);
      });
    }
    if (dubDaySelect) {
      dubDaySelect.addEventListener('change', () => scheduleModalAutoSave('overrides', true));
    }
    const progInput = bodyEl.querySelector('#af-wl-progress');
    if (progInput) {
      progInput.addEventListener('input', () => scheduleModalAutoSave('watchlist', false));
      progInput.addEventListener('change', () => scheduleModalAutoSave('watchlist', true));
    }
    const notesInput = bodyEl.querySelector('#af-wl-notes');
    if (notesInput) {
      notesInput.addEventListener('input', () => scheduleModalAutoSave('watchlist', false));
      notesInput.addEventListener('blur', () => { if (modalAutoSaveTimer) persistModalChangesNow('watchlist'); });
    }
    if (lagInput) {
      const syncDubClassificationFromLag = (immediate) => {
        const raw = lagInput.value.trim();
        if (raw !== '') {
          const n = Math.max(0, Number(raw));
          if (n === 0) {
            if (dubSelect) dubSelect.value = 'Simuldub';
            if (dubDaySelect) dubDaySelect.value = '';
          } else if (n > 0 && dubSelect && (dubSelect.value === '' || dubSelect.value === 'Simuldub' || dubSelect.value === 'Sub Only')) {
            dubSelect.value = 'Staggered Dub';
          }
        }
        scheduleModalAutoSave('overrides', immediate);
      };
      lagInput.addEventListener('input', () => syncDubClassificationFromLag(false));
      lagInput.addEventListener('change', () => syncDubClassificationFromLag(true));
    }

    backdrop.querySelector('#af-wl-save').addEventListener('click', () => {
      persistModalChangesNow('watchlist');
      toast(`Saved "${title}" to Watchlist.`, 'success');
      closeDetailModal();
    });

    backdrop.querySelector('#af-ovr-only').addEventListener('click', () => {
      persistModalChangesNow('overrides');
      toast(`Saved streaming & dub track overrides for "${title}".`, 'success');
    });

    const remBtn = backdrop.querySelector('#af-wl-remove');
    if (remBtn) {
      remBtn.addEventListener('click', () => {
        if (modalAutoSaveTimer) {
          clearTimeout(modalAutoSaveTimer);
          modalAutoSaveTimer = null;
        }
        pendingAutoSaveMode = null;
        activeModalFlushFn = null;
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
      const streamLinks = getStreamingLinks(anime, multi.jikan?.streaming || []);

      area.innerHTML = `
        <div class="meta-row" style="margin-bottom:12px;">
          <strong style="color:var(--text);">Where to Watch:</strong>
          ${streamLinks.length
            ? streamLinks.map(s => `<a class="stream-link-chip" href="${escapeHtml(s.url)}" target="_blank" rel="noopener" style="border-color:${s.color};color:${s.color};">${escapeHtml(s.name)} ↗</a>`).join('')
            : mergedPlatforms.length
              ? mergedPlatforms.map(p => `<span class="platform-tag" style="border-color:${p.color};color:${p.color};">${escapeHtml(p.name)}${p.freeWithAds ? ' (Free)' : ''}</span>`).join('')
              : '<span class="badge badge-muted">No direct links listed — check JustWatch US above or set custom overrides</span>'}
        </div>
        <div class="grid-2" style="gap:10px;margin-bottom:12px;">
          <div class="panel" style="padding:10px;">
            <div style="font-size:11px;color:var(--text-dim);text-transform:uppercase;">Jikan (MAL v4)</div>
            <div style="font-weight:700;color:var(--text);margin-top:3px;">
              ${multi.jikan ? `Score ${multi.jikan.score ?? '—'} · Rank #${multi.jikan.rank ?? '—'}` : 'Not indexed / rate-limited'}
            </div>
            ${multi.jikan?.rating ? `<div style="font-size:11.5px;">${escapeHtml(multi.jikan.rating)}</div>` : ''}
          </div>
          <div class="panel" style="padding:10px;">
            <div style="font-size:11px;color:var(--text-dim);text-transform:uppercase;">Verified Cross-DB Scores</div>
            <div style="font-size:12.5px;color:var(--text);margin-top:3px;">
              Kitsu: ${multi.kitsu?.rating ? `<a href="${escapeHtml(multi.kitsu.url)}" target="_blank" rel="noopener">${multi.kitsu.rating}%</a>` : '—'} ·
              TVMaze: ${multi.tvmaze?.rating ? `<a href="${escapeHtml(multi.tvmaze.url)}" target="_blank" rel="noopener">${multi.tvmaze.rating}</a>` : '—'}
              ${multi.shikimori?.url ? ` · <a href="${escapeHtml(multi.shikimori.url)}" target="_blank" rel="noopener">Shikimori ↗</a>` : ''}
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
    formatSourceLabel,
    getTopSubgenreTags,
    getKeyStaff,
    isSequelOrRecap,
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
    gistConnectAndSetup,
    gistDisconnect,
    generateSyncCode,
    applySyncCode,
    detectPlatforms,
    getStreamingLinks,
    isFreeWithAds,
    classifyDub,
    getDubLanguages,
    getDubTrackInfo,
    verifyDubStatusBatch,
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
