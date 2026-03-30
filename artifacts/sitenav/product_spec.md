# SiteNav Web — Product Specification

## 1. Data Model & Sparse CSV Parsing (Admin Sync)

### Input
Admin uploads a CSV with ~12,000 rows and headers including (but not limited to):
`Site No.`, `Site Reference`, `Type`, `Address`, `Borough`, `Camera Type`,
`W3W (Camera)`, `Coordinates (Camera`, `W3W (Cabinet)`, `Coordinates (Cabinet)`

> Note: The CSV header `Coordinates (Camera` is missing its closing parenthesis — this is intentional and must be handled as-is.

### Processing Rules
1. Parse CSV with `csv-parse/sync` (`columns: true, trim: true, relax_column_count: true`)
2. For each row, **delete any key-value pair where value is empty, null, or whitespace-only**
3. Deduplicate by `Site No.` (first occurrence wins)
4. Write the resulting array to `database.json`

### Data Compression Goal
`database.json` should only contain meaningful data — no null fields, no empty strings.
A typical site object looks like:
```json
{
  "Site No.": "12345",
  "Type": "CC Enforcement",
  "Address": "123 High Street, London",
  "W3W (Camera)": "filled.corner.road",
  "Coordinates (Camera": "51.499,-0.130"
}
```

---

## 2. End-User Flow (Field Engineers)

### Landing Page
- Yunex-branded header with app name and online/offline indicator
- Two tabs: **Search** and **Saved Sites**
- Prominent search bar (full width, large touch target)
- Recently searched section (last 5 sites from `localStorage`)

### Fuzzy Search
- On load, frontend fetches `BASE_PATH/api/sites` and caches it (service worker + IndexedDB)
- As user types (debounced 250ms), client-side filter runs across `Site No.`, `Site Reference`, `Address`, `Borough`, `Camera Type`
- Dropdown shows up to 20 matching results
- Results ranked: exact match > starts-with > contains

### Site Details Card
- Clicking a result (or a recent/saved site) opens the Site Card
- Card iterates through **all keys present in that site object** — dynamically rendered
- Fields not present in the object are never shown
- A Back button returns to search
- Star (★) toggle saves/unsaves the site in `localStorage`

### Dual-Coordinate Edge Case (CC Enforcement & LEZ)
If `site.Type === 'CC Enforcement'` or `site.Type === 'LEZ'`:
- Render **Camera** section:
  - Google Static Map image (from `Coordinates (Camera` field)
  - W3W address (from `W3W (Camera)` field) with "Copy" button
  - "Navigate" button → `https://www.google.com/maps/dir/?api=1&destination=<lat>,<lon>`
- Render **Cabinet** section:
  - Google Static Map image (from `Coordinates (Cabinet)` field)
  - W3W address (from `W3W (Cabinet)` field) with "Copy" button
  - "Navigate" button → `https://www.google.com/maps/dir/?api=1&destination=<lat>,<lon>`
- The Camera and Cabinet map fields are shown ONLY in their dedicated sections (not in the general field list)

For all other site types with coordinates available:
- Render a single map section using `Coordinates (Camera` and `W3W (Camera)` fields

### Navigation
- Navigate buttons use intent URL: `https://www.google.com/maps/dir/?api=1&destination=<LAT>,<LON>`
- Opens native Google Maps on mobile

---

## 3. localStorage Features

### Recently Searched (Zero-Auth)
- Storage key: `sitenav_recent`
- Stores last 5 site objects (full object for offline access)
- Clicking a recent entry opens its Site Card instantly (no search)
- Shown on landing page below search bar
- Updates on every site selection

### Saved Sites
- Storage key: `sitenav_saved`
- Stores array of `Site No.` strings
- "Saved Sites" tab on landing page shows saved sites (looked up from in-memory DB)
- Star toggle on Site Card — filled ★ = saved, outline ☆ = unsaved
- Tapping removes from saved list

---

## 4. Offline Functionality (PWA)

### Manifest (`public/manifest.json`)
- `name`: "SiteNav", `short_name`: "SiteNav"
- `start_url`: `BASE_PATH/`
- `scope`: `BASE_PATH/`
- `display`: "standalone"
- `theme_color`: "#1E2ED9" (Yunex Royal Blue)
- `background_color`: "#FFFFFF"
- Icons: SVG icon at 192×192 and 512×512

### Service Worker (`public/sw.js`)
- Registered from `index.html` with scope `BASE_PATH/`
- **CacheFirst** strategy for static assets (HTML, JS, CSS, icons, manifest)
- **NetworkFirst with cache fallback** for `BASE_PATH/api/sites`
- Cache name: `sitenav-v1`

### Data Storage
- On first load, sites are fetched and stored in IndexedDB (`sitenav-db`, store `sites-cache`)
- On subsequent loads (online or offline): read from IndexedDB first, then update in background
- The service worker also caches the `/api/sites` response

### Graceful Map Degradation
- Google Static Map `<img>` elements have an `onerror` handler
- If offline and map image fails to load: replace with styled fallback div showing "📍 Map unavailable offline"
- The rest of the Site Card (all metadata) continues to display normally

### Online/Offline Indicator
- Header displays a small coloured dot + label: 🟢 Online / 🔴 Offline
- Updates in real time via `window.addEventListener('online'/'offline')`

---

## 5. Implementation Checklist

- [x] `server.js` — Express server with static serving, API routes, admin route
- [x] `database.json` — Empty array (seeded on first admin upload)
- [x] `project_rules.md` — Tech rules document
- [x] `product_spec.md` — This document
- [ ] `public/index.html` — Main PWA shell with Yunex branding
- [ ] `public/app.js` — All client-side logic (search, card, localStorage, IndexedDB, offline)
- [ ] `public/sw.js` — Service worker (CacheFirst static, NetworkFirst API)
- [ ] `public/manifest.json` — PWA manifest
- [ ] `admin.html` — Admin CSV upload page (served at /admin, not in public/)
- [ ] `public/icons/icon.svg` — Yunex-branded app icon (192px + 512px)
- [ ] Secrets set: `ADMIN_PASSWORD`, `GOOGLE_MAPS_API_KEY`
