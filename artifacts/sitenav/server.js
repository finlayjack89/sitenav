const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { parse } = require('csv-parse/sync');

const app = express();
const PORT = process.env.PORT || 22849;
const BASE_PATH = (process.env.BASE_PATH || '/sitenav').replace(/\/$/, '');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || '';

const DB_PATH = path.join(__dirname, 'database.json');
const COOKIE_NAME = 'sitenav_admin';
const COOKIE_MAX_AGE = 60 * 60 * 24; // 24 hours

if (!fs.existsSync(DB_PATH)) {
  fs.writeFileSync(DB_PATH, '[]', 'utf8');
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(BASE_PATH, express.static(path.join(__dirname, 'public'), {
  index: 'index.html',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('sw.js')) {
      res.setHeader('Service-Worker-Allowed', BASE_PATH + '/');
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

function parseCookies(req) {
  const cookies = {};
  const header = req.headers.cookie || '';
  header.split(';').forEach(part => {
    const [k, ...v] = part.trim().split('=');
    if (k) cookies[k.trim()] = decodeURIComponent(v.join('=').trim());
  });
  return cookies;
}

function checkAuth(req) {
  if (!ADMIN_PASSWORD) return false;
  const cookies = parseCookies(req);
  return cookies[COOKIE_NAME] === ADMIN_PASSWORD;
}

function loginPage(error) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SiteNav Admin — Login</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #E4EDED; min-height: 100vh; display: flex; flex-direction: column; }
    header { background: #1E2ED9; color: #fff; padding: 14px 20px; display: flex; align-items: center; gap: 10px; }
    header h1 { font-size: 1.1rem; font-weight: 700; }
    .wrap { flex: 1; display: flex; align-items: center; justify-content: center; padding: 24px; }
    .card { background: #fff; border-radius: 12px; padding: 36px 28px; width: 100%; max-width: 360px; box-shadow: 0 2px 16px rgba(0,0,0,0.10); }
    .card h2 { font-size: 1.15rem; font-weight: 700; color: #1E2ED9; margin-bottom: 6px; }
    .card p { font-size: 0.875rem; color: #666; margin-bottom: 24px; }
    label { display: block; font-size: 0.82rem; font-weight: 600; color: #333; margin-bottom: 6px; }
    input[type=password] { width: 100%; padding: 11px 14px; border: 1.5px solid #ccc; border-radius: 8px; font-size: 1rem; outline: none; transition: border-color 0.2s; }
    input[type=password]:focus { border-color: #1E2ED9; }
    button[type=submit] { width: 100%; margin-top: 18px; background: #1E2ED9; color: #fff; border: none; border-radius: 8px; padding: 13px; font-size: 1rem; font-weight: 600; cursor: pointer; transition: background 0.15s; }
    button[type=submit]:hover { background: #1525b5; }
    .error-msg { color: #c0392b; font-size: 0.85rem; margin-top: 14px; padding: 10px 12px; background: #ffebee; border-radius: 6px; border: 1px solid #f44336; }
  </style>
</head>
<body>
  <header>
    <svg width="24" height="24" viewBox="0 0 192 192" xmlns="http://www.w3.org/2000/svg">
      <path d="M96 28C72.8 28 54 46.8 54 70c0 33 42 92 42 92s42-59 42-92c0-23.2-18.8-42-42-42z" fill="#fff"/>
      <circle cx="96" cy="70" r="18" fill="#00E38C"/>
    </svg>
    <h1>SiteNav Admin</h1>
  </header>
  <div class="wrap">
    <div class="card">
      <h2>Admin Login</h2>
      <p>Enter the admin password to manage the site database.</p>
      <form method="POST" action="${BASE_PATH}/admin/login">
        <label for="pwd">Password</label>
        <input type="password" id="pwd" name="password" placeholder="Admin password" autofocus required>
        <button type="submit">Sign In</button>
        ${error ? '<div class="error-msg">Incorrect password — please try again.</div>' : ''}
      </form>
    </div>
  </div>
</body>
</html>`;
}

// --- API routes ---

app.get(`${BASE_PATH}/api/map`, async (req, res) => {
  if (!GOOGLE_MAPS_API_KEY) return res.status(503).end();
  const { lat, lon, zoom = '17' } = req.query;
  if (!lat || !lon) return res.status(400).end();
  const c = `${lat},${lon}`;
  const mapUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${encodeURIComponent(c)}&zoom=${zoom}&size=600x300&scale=2&maptype=roadmap&markers=color:blue%7C${encodeURIComponent(c)}&key=${GOOGLE_MAPS_API_KEY}`;
  try {
    const upstream = await fetch(mapUrl);
    if (!upstream.ok) return res.status(upstream.status).end();
    const data = await upstream.arrayBuffer();
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.end(Buffer.from(data));
  } catch (err) {
    console.error('Map proxy error:', err.message);
    res.status(502).end();
  }
});

app.get(`${BASE_PATH}/api/sites`, (req, res) => {
  try {
    const data = fs.readFileSync(DB_PATH, 'utf8');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(data);
  } catch (e) {
    res.json([]);
  }
});

app.get(`${BASE_PATH}/api/config`, (req, res) => {
  res.json({ mapsApiKey: GOOGLE_MAPS_API_KEY });
});

app.get(`${BASE_PATH}/api/db-stats`, (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    res.json({ count: Array.isArray(data) ? data.length : 0 });
  } catch (e) {
    res.json({ count: 0 });
  }
});

// --- Admin auth ---

app.get(`${BASE_PATH}/admin`, (req, res) => {
  if (!checkAuth(req)) {
    return res.status(200).send(loginPage(false));
  }
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.post(`${BASE_PATH}/admin/login`, (req, res) => {
  const submitted = (req.body.password || '').trim();
  if (!ADMIN_PASSWORD || submitted !== ADMIN_PASSWORD) {
    return res.status(200).send(loginPage(true));
  }
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(ADMIN_PASSWORD)}; HttpOnly; Path=${BASE_PATH}/; SameSite=Strict; Max-Age=${COOKIE_MAX_AGE}`);
  res.redirect(BASE_PATH + '/admin');
});

app.get(`${BASE_PATH}/admin/logout`, (req, res) => {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; Path=${BASE_PATH}/; SameSite=Strict; Max-Age=0`);
  res.redirect(BASE_PATH + '/admin');
});

// --- Admin operations ---

app.post(`${BASE_PATH}/admin/upload`, (req, res, next) => {
  upload.single('csv')(req, res, err => {
    if (err) {
      return res.status(400).json({ success: false, error: `Upload error: ${err.message}` });
    }
    next();
  });
}, (req, res) => {
  if (!checkAuth(req)) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No file uploaded' });
  }
  try {
    const csvContent = req.file.buffer.toString('utf8');
    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
      bom: true
    });

    const cleaned = records.map(row => {
      const out = {};
      for (const [key, value] of Object.entries(row)) {
        const k = key ? key.trim() : key;
        if (!k) continue;
        if (value === null || value === undefined) continue;
        const v = String(value).trim();
        if (v === '') continue;
        out[k] = v;
      }
      return out;
    }).filter(row => Object.keys(row).length > 0);

    const seen = new Set();
    const deduped = cleaned.filter(row => {
      const key = row['Site No.'] || row['Site No'] || row['site_no'];
      if (!key) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    fs.writeFileSync(DB_PATH, JSON.stringify(deduped), 'utf8');
    res.json({ success: true, count: deduped.length, rawCount: records.length });
  } catch (err) {
    console.error('CSV parse error:', err);
    res.status(500).json({ success: false, error: String(err.message) });
  }
});

app.post(`${BASE_PATH}/admin/clear`, (req, res) => {
  if (!checkAuth(req)) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  fs.writeFileSync(DB_PATH, '[]', 'utf8');
  res.json({ success: true });
});

app.get(`${BASE_PATH}`, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/', (req, res) => {
  res.redirect(BASE_PATH + '/');
});

app.listen(PORT, () => {
  console.log(`SiteNav server running on port ${PORT} at ${BASE_PATH}/`);
  if (!ADMIN_PASSWORD) console.warn('WARNING: ADMIN_PASSWORD not set — admin route is inaccessible');
  if (!GOOGLE_MAPS_API_KEY) console.warn('WARNING: GOOGLE_MAPS_API_KEY not set — maps will be disabled');
});
