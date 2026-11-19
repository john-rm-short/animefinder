# AnimeFinder Web Suite

A zero-build, static three-page anime discovery, tracking, and semantic exploration suite designed specifically for **GitHub Pages** same-origin shared storage.

## Suite Architecture

| File | Role |
|---|---|
| `index.html` | **Main Hub & Daily Utility** — Global AniList Search (`/`), past-72h Releases + Active ONAs across 11 platforms + Dub filter + optional TMDB US batch enricher, full local Mon–Sun 7-Day Schedule, Saved Watchlist & Persistence, Radar (Upcoming + ANN RSS + YouTube Hunter), Archives (By Year 1970–2026 & By Studio up to 75 titles via `isMainStudio`), and Multi-Source Detail Modal. |
| `vibe-graph.html` | **Semantic Search & Taste Graph** — Seedless 3-layer live-taxonomy Find Vibe, Anime & Watchlist Constellation seeding, high-DPI HTML5 Canvas (Force & pure-JS deterministic t-SNE), 5-slider DNA weights, Gem Ceiling (`<80k` / `<35k`), emergent cluster halos, optional lazy-loaded WASM MiniLM (`Xenova/all-MiniLM-L6-v2` q8) embeddings, persistent Node Inspector with inline Watchlist editor, Neighbor Expansion, Wikipedia attachment, and an accessible Table View fallback. |
| `eclectic-lab.html` | **Experimental Discovery Lab** — 2D Vibe Map (`Tone × Reality` & `Pacing × Obscurity` with pointer drag & arrow-key nudging), Auteur & Staff Tree (8 curated creators + 100-credit 5-bucket filmography), Attribute Arithmetic (signed `+`/`−` equations with `genre_not_in`/`tag_not_in` + negative penalties), and Blind Premise Roulette (redacted titles & hidden art until reveal + blind Watchlist saving). |
| `shared-core.js` | **Shared Core Engine** — Unified `localStorage` (`animefinder_state_v1`) with non-destructive saves, live cross-tab `storage` events, standardized `On Hold` status, per-record deletion tombstones, `TextEncoder`/`TextDecoder` Sync Codes, unified Private GitHub Gist auto-sync (`animefinder-sync.json`, boot auto-pull + 1.5s debounced auto-push), shared `IndexedDB` (`AnimeFinderCacheDB` v2: `apiCache` + `vectors`), AniList GraphQL client, 11-platform registry, AniList username importer (`MediaListCollection`), and accessible Detail Modal. |
| `styles.css` | Self-contained custom dark UI stylesheet with zero external CDN fragility. |
| `.nojekyll` & `manifest.webmanifest` | GitHub Pages static-serving bypass and iOS/PWA home-screen install support. |

## Shared Storage on GitHub Pages

Hosting all files on GitHub Pages (`https://<username>.github.io/<repo>/`) places every page under the **same browser origin**, automatically sharing:
- **`localStorage` (`animefinder_state_v1`)** — Watchlist, ratings, episode counts, notes, dub/platform overrides, and settings sync live across open tabs via the browser `storage` event.
- **`IndexedDB` (`AnimeFinderCacheDB` v2)** — Cached API responses (`apiCache`) and 384-d MiniLM embeddings (`vectors`) are shared across all three pages.
- **Deep Links** — `?seed=<id>`, `?vibe=<query>`, `?mode=watchlist`, `?tab=<name>`, `?anime=<id>`, and `#sync=<base64>`.

## Deploy to GitHub Pages

1. Create a new repository on GitHub (for example, `animefinder`).
2. Inside this folder, initialize Git and push:
   ```bash
   git init
   git add .
   git commit -m "Initial commit: AnimeFinder Web Suite"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<repo-name>.git
   git push -u origin main
   ```
3. On GitHub, open **Settings → Pages**:
   - **Source**: `Deploy from a branch`
   - **Branch**: `main` / `/ (root)`
   - Click **Save**.
4. Visit `https://<your-username>.github.io/<repo-name>/` — `index.html` loads automatically as the Main Hub.

## Optional Cross-Device Sync (Private GitHub Gist)

To sync your Watchlist and overrides across devices (e.g., desktop ↔ phone):
1. Create a GitHub Personal Access Token scoped **strictly to `gist`**.
2. Open **Main Hub → Saved & Sync → Private GitHub Gist Auto-Sync**.
3. Paste your token and click **+ Create Private Gist** (or enter an existing Gist ID and click **Save Gist Config**).
4. All three pages will automatically pull on boot and debounce-push (`1.5s`) to `animefinder-sync.json` using per-record deletion tombstones.

> **Security Note:** GitHub PATs and TMDB keys are excluded from portable Sync Codes and `#sync=` URLs, but remain stored locally in `localStorage` and full JSON exports. Treat exported JSON files as private.
