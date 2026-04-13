require('dotenv').config();
const express = require('express');
const path = require('path');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const { createClient } = require('@supabase/supabase-js');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { GetObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const adminPage = require('./admin-page');

const app = express();
const PORT = process.env.PORT || 22849;
const BASE_PATH = (process.env.BASE_PATH || '/sitenav').replace(/\/$/, '');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || '';

// Supabase Setup
const supabaseUrl = process.env.SUPABASE_URL || 'https://hwxrlizvyapisruelisj.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Cloudflare R2 Setup
const s3Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY,
    secretAccessKey: process.env.R2_SECRET_KEY,
  },
});
const R2_BUCKET = process.env.R2_BUCKET || 'ulez-design-pdfs';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://catalog.cloudflarestorage.com/dd2e6c5a8ecffbf98f4ef8cad874bfbf/ulez-design-pdfs';

const COOKIE_NAME = 'sitenav_admin';
const COOKIE_MAX_AGE = 60 * 60 * 24;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });
const uploadPdf = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(BASE_PATH, express.static(__dirname, {
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
  return true; // Password protection removed per user request
}

function loginPage(error) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SiteNav Admin — Login</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #E4EDED; min-height: 100vh; display: flex; flex-direction: column; }
    header { background: #1E2ED9; color: #fff; padding: 14px 20px; display: flex; align-items: center; gap: 10px; }
    header .header-logo { height: 24px; width: auto; filter: brightness(0) invert(1); }
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
    <img src="/logos/sitenav_logo.svg" alt="SiteNav" class="header-logo">
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

async function fetchAllSites(columns = 'data') {
  const allRows = [];
  let from = 0;
  const step = 1000;
  while (true) {
    const { data, error } = await supabase.from('sites').select(columns).neq('site_no', '__CONFIG__').range(from, from + step - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    allRows.push(...data);
    if (data.length < step) break;
    from += step;
  }
  return allRows;
}

app.get(`${BASE_PATH}/api/sites`, async (req, res) => {
  try {
    const data = await fetchAllSites('data');
    const sites = data.map(r => r.data);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json(sites);
  } catch (e) {
    console.error(e);
    res.json([]);
  }
});

app.get(`${BASE_PATH}/api/config`, async (req, res) => {
  try {
    const { data } = await supabase.from('sites').select('data').eq('site_no', '__CONFIG__').maybeSingle();
    res.json({ mapsApiKey: GOOGLE_MAPS_API_KEY, searchConfig: (data && data.data) ? data.data : {} });
  } catch (e) {
    res.json({ mapsApiKey: GOOGLE_MAPS_API_KEY, searchConfig: {} });
  }
});

app.post(`${BASE_PATH}/api/config`, express.json(), async (req, res) => {
  if (!checkAuth(req)) return res.status(401).json({ success: false, error: 'Unauthorized' });
  try {
    await supabase.from('sites').upsert({ site_no: '__CONFIG__', project_number: null, data: req.body });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get(`${BASE_PATH}/api/database/stats`, async (req, res) => {
  try {
    const data = await fetchAllSites('data');
    const count = data ? data.length : 0;
    const typeBreakdown = {};
    if (data) {
      data.forEach(row => {
        const type = row.data['Type'] || 'Unknown';
        typeBreakdown[type] = (typeBreakdown[type] || 0) + 1;
      });
    }
    res.json({ count, types: typeBreakdown });
  } catch (e) {
    res.json({ count: 0, types: {} });
  }
});

app.delete(`${BASE_PATH}/api/database/type/:type`, async (req, res) => {
  if (!checkAuth(req)) return res.status(401).json({ success: false, error: 'Unauthorized' });
  const targetType = req.params.type;
  try {
    const sites = await fetchAllSites('site_no, data');
    const toDelete = (sites || []).filter(s => (s.data['Type'] || 'Unknown') === targetType).map(s => s.site_no);
    if (toDelete.length > 0) {
      const chunkSize = 100;
      for (let i = 0; i < toDelete.length; i += chunkSize) {
        const chunk = toDelete.slice(i, i + chunkSize);
        await supabase.from('sites').delete().in('site_no', chunk);
      }
    }
    res.json({ success: true, count: sites ? sites.length - toDelete.length : 0, removed: toDelete.length });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// --- Admin auth ---
app.get(`${BASE_PATH}/admin`, (req, res) => {
  if (!checkAuth(req)) return res.status(200).send(loginPage(false));
  res.send(adminPage(BASE_PATH));
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

// --- Secure PDF Streamer ---
app.get(`${BASE_PATH}/api/pdf/:filename`, async (req, res) => {
  try {
    const filename = req.params.filename;
    if (!filename || filename.indexOf('/') !== -1) {
      return res.status(400).send('Invalid filename');
    }
    const command = new GetObjectCommand({
      Bucket: R2_BUCKET,
      Key: filename
    });
    // Generate a URL that is valid for 1 hour
    const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
    // Redirect the browser to the pre-signed URL to begin immediate secure download/viewing
    res.redirect(302, url);
  } catch (e) {
    console.error('Presigner error:', e);
    res.status(500).send('Error generating secure PDF link');
  }
});

app.get(`${BASE_PATH}/api/pdf-check/:filename`, async (req, res) => {
  try {
    const filename = req.params.filename;
    if (!filename || filename.indexOf('/') !== -1) return res.json({ exists: false });
    const command = new HeadObjectCommand({ Bucket: R2_BUCKET, Key: filename });
    await s3Client.send(command);
    res.json({ exists: true });
  } catch (e) {
    res.json({ exists: false });
  }
});

// --- Admin operations ---
app.post(`${BASE_PATH}/api/upload-pdfs`, (req, res, next) => {
  uploadPdf.array('pdfs')(req, res, err => {
    if (err) return res.status(400).json({ success: false, error: `Upload error: ${err.message}` });
    next();
  });
}, async (req, res) => {
  if (!checkAuth(req)) return res.status(401).json({ success: false, error: 'Unauthorized' });
  if (!req.files || req.files.length === 0) return res.status(400).json({ success: false, error: 'No files uploaded' });
  
  try {
    for (const file of req.files) {
      const command = new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: file.originalname,
        Body: file.buffer,
        ContentType: 'application/pdf'
      });
      await s3Client.send(command);
    }
    res.json({ success: true, count: req.files.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post(`${BASE_PATH}/api/upload-csv`, (req, res, next) => {
  upload.array('csvs')(req, res, err => {
    if (err) return res.status(400).json({ success: false, error: `Upload error: ${err.message}` });
    next();
  });
}, async (req, res) => {
  if (!checkAuth(req)) return res.status(401).json({ success: false, error: 'Unauthorized' });
  if (!req.files || req.files.length === 0) return res.status(400).json({ success: false, error: 'No files uploaded' });

  try {
    const { data: configData } = await supabase.from('sites').select('data').eq('site_no', '__CONFIG__').maybeSingle();
    let searchConfig = (configData && configData.data) ? configData.data : {};
    const TECHNICAL_FIELDS = new Set(['Latitude', 'Longitude', 'URL', 'W3W', 'W3W (Camera)', 'W3W (Cabinet)', 'SiteDrawingUrl', 'FullDesignPackUrl']);

    const existingSitesData = await fetchAllSites('site_no, data');
    const existingSitesMap = new Map();
    if (existingSitesData) {
      existingSitesData.forEach(s => existingSitesMap.set(s.site_no, s.data));
    }

    let newHeaders = new Set();
    const rowsToUpsertMap = new Map();
    let totalRawCount = 0;

    for (const file of req.files) {
      const csvContent = file.buffer.toString('utf8');
      const records = parse(csvContent, {
        columns: true, skip_empty_lines: true, trim: true, relax_column_count: true, bom: true
      });
      totalRawCount += records.length;

      records.forEach(row => {
        const cleaned = {};
        for (const [key, value] of Object.entries(row)) {
          const k = key ? key.trim() : key;
          if (!k) continue;
          if (value === null || value === undefined) continue;
          const v = String(value).trim();
          if (v === '') continue;
          cleaned[k] = v;
          newHeaders.add(k);
        }
        if (Object.keys(cleaned).length === 0) return;

        const projNum = cleaned['Project Number'] || cleaned['Project No.'] || cleaned['Project No'] || cleaned['project_number'];
        if (projNum) {
          cleaned['SiteDrawingUrl'] = `${BASE_PATH}/api/pdf/Site ${projNum}_Drawing-only.pdf`;
          newHeaders.add('SiteDrawingUrl');
          cleaned['FullDesignPackUrl'] = `${BASE_PATH}/api/pdf/Site ${projNum}_Full-Pack.pdf`;
          newHeaders.add('FullDesignPackUrl');
        }

        const key = cleaned['Site No.'] || cleaned['Site No'] || cleaned['site_no'] || cleaned['Site Number'] || cleaned['site_number'];
        if (!key) return;

        const baseData = rowsToUpsertMap.has(key) ? rowsToUpsertMap.get(key).data : (existingSitesMap.has(key) ? existingSitesMap.get(key) : {});
        const mergedData = { ...baseData, ...cleaned };

        rowsToUpsertMap.set(key, {
          site_no: key,
          project_number: projNum || (rowsToUpsertMap.has(key) ? rowsToUpsertMap.get(key).project_number : null),
          data: mergedData
        });
      });
    }

    const rowsToUpsert = Array.from(rowsToUpsertMap.values());

    if (totalRawCount === 0) {
      return res.status(400).json({ success: false, error: 'The CSV files appear to be empty or could not be read.' });
    }

    if (rowsToUpsert.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: `Could not find a valid "Site No.", "Site No", or "Site Number" column. Found columns: ${Array.from(newHeaders).join(', ')}` 
      });
    }

    const chunkSize = 1000;
    for (let i = 0; i < rowsToUpsert.length; i += chunkSize) {
      const chunk = rowsToUpsert.slice(i, i + chunkSize);
      const { error } = await supabase.from('sites').upsert(chunk);
      if (error) throw error;
    }

    let configChanged = false;
    for (const h of newHeaders) {
      if (!(h in searchConfig)) {
        searchConfig[h] = !TECHNICAL_FIELDS.has(h);
        configChanged = true;
      }
    }
    if (configChanged) {
      await supabase.from('sites').upsert({ site_no: '__CONFIG__', project_number: null, data: searchConfig });
    }

    res.json({ success: true, count: rowsToUpsert.length, rawCount: totalRawCount });
  } catch (err) {
    console.error('CSV parse/upload error:', err);
    res.status(500).json({ success: false, error: String(err.message) });
  }
});

app.post(`${BASE_PATH}/admin/clear`, async (req, res) => {
  if (!checkAuth(req)) return res.status(401).json({ success: false, error: 'Unauthorized' });
  try {
    const sites = await fetchAllSites('site_no');
    const toDelete = (sites || []).map(s => s.site_no);
    if (toDelete.length > 0) {
      const chunkSize = 100;
      for (let i = 0; i < toDelete.length; i += chunkSize) {
        const chunk = toDelete.slice(i, i + chunkSize);
        await supabase.from('sites').delete().in('site_no', chunk);
      }
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get(`${BASE_PATH}`, (req, res) => {
  res.redirect(BASE_PATH + '/');
});

app.get('/', (req, res) => {
  res.redirect(BASE_PATH + '/');
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`SiteNav server running on port ${PORT} at ${BASE_PATH}/`);
  });
}

// Export for serverless
module.exports = app;
