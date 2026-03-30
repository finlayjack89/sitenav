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

if (!fs.existsSync(DB_PATH)) {
  fs.writeFileSync(DB_PATH, '[]', 'utf8');
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

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

function checkAuth(req) {
  if (!ADMIN_PASSWORD) return false;
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Basic ')) return false;
  const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
  const colonIdx = decoded.indexOf(':');
  const password = colonIdx >= 0 ? decoded.slice(colonIdx + 1) : decoded;
  return password === ADMIN_PASSWORD;
}

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

app.get(`${BASE_PATH}/admin`, (req, res) => {
  if (!checkAuth(req)) {
    res.setHeader('WWW-Authenticate', 'Basic realm="SiteNav Admin"');
    return res.status(401).send('Unauthorized — enter the admin password.');
  }
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.post(`${BASE_PATH}/admin/upload`, upload.single('csv'), (req, res) => {
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

app.get(`${BASE_PATH}/admin/clear`, (req, res) => {
  if (!checkAuth(req)) {
    res.setHeader('WWW-Authenticate', 'Basic realm="SiteNav Admin"');
    return res.status(401).send('Unauthorized');
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
