# SiteNav Web — Project Rules

## 1. Tech Stack
- **Runtime**: Node.js (CommonJS)
- **Backend**: Express 4
- **Frontend**: HTML5, Vanilla JavaScript (ES6+)
- **Styles**: Tailwind CSS (CDN play build)
- **Database**: Flat-file `database.json` (JSON array, sparse-optimised)
- **No build step** — server.js runs directly with `node server.js`

## 2. Architecture
- Express serves static files from `public/` at `BASE_PATH`
- API routes live under `BASE_PATH/api/`
- Admin route at `BASE_PATH/admin` (HTTP Basic Auth)
- Database is a flat JSON file (`database.json`) — no PostgreSQL, no MongoDB

## 3. UI/UX & Branding (Yunex Traffic)
- **Mobile-first** — all touch targets ≥ 44px
- **Colors (exact HEX)**:
  - Primary Highlight (Royal Blue): `#1E2ED9`
  - Secondary Highlight (Green): `#00E38C`
  - Background/Panels: `#FFFFFF` (white) and `#E4EDED` (gray)
  - Text: `#000000`
- **Typography & Style**: Left-aligned text only. Clean, flat, dashboard-inspired. No heavy drop shadows or motion blur. Simple black & white line icons (Unicode/SVG).

## 4. Security
- The main app (`/sitenav/`) is **publicly accessible with zero login friction**.
- Only `/sitenav/admin` is protected via HTTP Basic Authentication.
- Admin password is checked against the `ADMIN_PASSWORD` environment variable (Replit Secret).
- The `GOOGLE_MAPS_API_KEY` is stored as a Replit Secret (`GOOGLE_MAPS_API_KEY`) and served to the client via `/sitenav/api/config`.

## 5. Non-Goals (Explicit)
- ❌ No interactive maps (Leaflet/Mapbox) — Google Static Maps image URLs only
- ❌ No PostgreSQL or MongoDB
- ❌ Do NOT store null, empty string, or whitespace-only values in `database.json`
- ❌ No React, Vue, or other frontend frameworks — Vanilla JS only
