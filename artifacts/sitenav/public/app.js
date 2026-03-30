(function () {
  'use strict';

  const BASE = '/sitenav';
  const RECENT_KEY = 'sitenav_recent';
  const SAVED_KEY = 'sitenav_saved';
  const IDB_DB = 'sitenav-db';
  const IDB_STORE = 'sites-cache';
  const IDB_KEY = 'all-sites';
  const SEARCH_LIMIT = 20;
  const RECENT_LIMIT = 5;

  const MAP_COORD_KEYS = new Set([
    'W3W (Camera)', 'Coordinates (Camera', 'Coordinates (Camera)',
    'W3W (Cabinet)', 'Coordinates (Cabinet)'
  ]);

  const DUAL_TYPES = new Set(['CC Enforcement', 'LEZ']);

  let allSites = [];
  let mapsApiKey = '';
  let currentSite = null;
  let searchDebounce = null;
  let idbDb = null;

  const $ = id => document.getElementById(id);

  function el(tag, attrs = {}, children = []) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'className') e.className = v;
      else if (k.startsWith('on')) e[k] = v;
      else e.setAttribute(k, v);
    }
    for (const c of children) {
      if (typeof c === 'string') e.appendChild(document.createTextNode(c));
      else if (c) e.appendChild(c);
    }
    return e;
  }

  async function openIDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_DB, 1);
      req.onupgradeneeded = e => {
        e.target.result.createObjectStore(IDB_STORE);
      };
      req.onsuccess = e => resolve(e.target.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbGet(key) {
    if (!idbDb) return null;
    return new Promise(resolve => {
      const tx = idbDb.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  }

  async function idbSet(key, value) {
    if (!idbDb) return;
    return new Promise(resolve => {
      const tx = idbDb.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
  }

  async function loadData() {
    try {
      idbDb = await openIDB();
    } catch (e) {
      console.warn('IndexedDB unavailable:', e);
    }

    const cached = await idbGet(IDB_KEY);
    if (Array.isArray(cached) && cached.length > 0) {
      allSites = cached;
      renderRecent();
      if (!navigator.onLine) return;
    }

    try {
      const res = await fetch(BASE + '/api/sites');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (Array.isArray(data)) {
        allSites = data;
        await idbSet(IDB_KEY, data);
        renderRecent();
      }
    } catch (e) {
      if (allSites.length === 0) {
        showStatus('Could not load site data. You may be offline.', 'warn');
      }
    }
  }

  async function loadConfig() {
    try {
      const res = await fetch(BASE + '/api/config');
      const data = await res.json();
      mapsApiKey = data.mapsApiKey || '';
    } catch (_) {}
  }

  function parseCoords(str) {
    if (!str) return null;
    const parts = str.split(',');
    if (parts.length < 2) return null;
    const lat = parseFloat(parts[0].trim());
    const lon = parseFloat(parts[1].trim());
    if (isNaN(lat) || isNaN(lon)) return null;
    return { lat, lon };
  }

  function buildNavUrl(lat, lon) {
    return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
  }

  async function copyText(text, btn) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    btn.style.background = '#00E38C';
    btn.style.color = '#000';
    setTimeout(() => {
      btn.textContent = orig;
      btn.style.background = '';
      btn.style.color = '';
    }, 1500);
  }

  function scoreMatch(site, terms) {
    const haystack = (site['Site No.'] || site['Site No'] || '').toLowerCase();

    let score = 0;
    for (const t of terms) {
      if (!haystack.includes(t)) return -1;
      const idx = haystack.indexOf(t);
      if (idx === 0) score += 3;
      else if (haystack[idx - 1] === ' ') score += 2;
      else score += 1;
    }
    return score;
  }

  function fuzzySearch(query) {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const results = [];
    for (const site of allSites) {
      const s = scoreMatch(site, terms);
      if (s > -1) results.push({ site, score: s });
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, SEARCH_LIMIT).map(r => r.site);
  }

  function getRecent() {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch { return []; }
  }

  function addRecent(site) {
    let list = getRecent().filter(s => s['Site No.'] !== site['Site No.']);
    list.unshift(site);
    list = list.slice(0, RECENT_LIMIT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  }

  function getSaved() {
    try { return JSON.parse(localStorage.getItem(SAVED_KEY)) || []; } catch { return []; }
  }

  function isSaved(siteNo) {
    return getSaved().includes(siteNo);
  }

  function toggleSaved(siteNo) {
    let list = getSaved();
    if (list.includes(siteNo)) {
      list = list.filter(s => s !== siteNo);
    } else {
      list.unshift(siteNo);
    }
    localStorage.setItem(SAVED_KEY, JSON.stringify(list));
    return list.includes(siteNo);
  }

  function showStatus(msg, type = 'info') {
    const el2 = $('status-bar');
    if (!el2) return;
    el2.textContent = msg;
    el2.className = 'status-bar ' + type;
    el2.style.display = 'block';
    if (type !== 'warn') setTimeout(() => { el2.style.display = 'none'; }, 3000);
  }

  function updateConnectionStatus() {
    const dot = $('conn-dot');
    const label = $('conn-label');
    if (!dot || !label) return;
    if (navigator.onLine) {
      dot.style.background = '#00E38C';
      label.textContent = 'Online';
    } else {
      dot.style.background = '#e53e3e';
      label.textContent = 'Offline';
    }
  }

  function setSitesIncludedVisible(visible) {
    const el = $('sites-included');
    if (el) el.style.display = visible ? 'block' : 'none';
  }

  function renderDropdown(results) {
    const dd = $('search-dropdown');
    dd.innerHTML = '';
    if (!results.length) {
      dd.style.display = 'none';
      return;
    }
    for (const site of results) {
      const siteNo = site['Site No.'] || site['Site No'] || '';
      const ref = site['Site Reference'] || '';
      const addr = site['Address'] || '';
      const type = site['Type'] || '';
      const item = el('button', {
        className: 'dd-item',
        onclick: () => { openSite(siteNo); dd.style.display = 'none'; $('search-input').value = ''; setSitesIncludedVisible(true); }
      }, [
        el('span', { className: 'dd-primary' }, [siteNo + (ref ? ' — ' + ref : '')]),
        el('span', { className: 'dd-secondary' }, [addr + (type ? ' · ' + type : '')])
      ]);
      dd.appendChild(item);
    }
    dd.style.display = 'block';
    dd.onmousemove = () => {
      dd.querySelectorAll('.dd-item.dd-active').forEach(i => i.classList.remove('dd-active'));
    };
  }

  function renderRecent() {
    const container = $('recent-section');
    if (!container) return;
    const list = getRecent();
    if (!list.length) { container.style.display = 'none'; return; }
    container.style.display = 'block';
    const itemsEl = $('recent-items');
    itemsEl.innerHTML = '';
    for (const site of list) {
      const siteNo = site['Site No.'] || site['Site No'] || '';
      const ref = site['Site Reference'] || site['Address'] || '';
      const chip = el('button', {
        className: 'recent-chip',
        onclick: () => openSite(siteNo)
      }, [
        el('span', { className: 'chip-no' }, [siteNo]),
        el('span', { className: 'chip-ref' }, [ref])
      ]);
      itemsEl.appendChild(chip);
    }
  }

  function renderSavedTab() {
    const container = $('saved-list');
    if (!container) return;
    const savedNos = getSaved();
    container.innerHTML = '';
    if (!savedNos.length) {
      container.innerHTML = '<p class="empty-msg">No saved sites yet. Star a site to save it.</p>';
      return;
    }
    for (const siteNo of savedNos) {
      const site = allSites.find(s => (s['Site No.'] || s['Site No']) === siteNo);
      const addr = site ? (site['Address'] || site['Site Reference'] || '') : '';
      const type = site ? (site['Type'] || '') : '';
      const item = el('button', {
        className: 'saved-item',
        onclick: () => openSite(siteNo)
      }, [
        el('span', { className: 'saved-no' }, [siteNo]),
        el('span', { className: 'saved-info' }, [addr + (type ? ' · ' + type : '')])
      ]);
      container.appendChild(item);
    }
  }

  function buildMapBlock(label, coordStr, w3wStr) {
    const coords = parseCoords(coordStr);
    const wrap = el('div', { className: 'map-section' });
    const heading = el('h3', { className: 'map-heading' }, [label]);
    wrap.appendChild(heading);

    if (w3wStr) {
      const w3wRow = el('div', { className: 'w3w-row' });
      const w3wVal = el('span', { className: 'w3w-val' }, ['///' + w3wStr]);
      const copyBtn = el('button', {
        className: 'copy-btn',
        onclick: function () { copyText('///' + w3wStr, this); }
      }, ['Copy']);
      const w3wLink = el('a', {
        className: 'w3w-link-btn',
        href: `https://what3words.com/${w3wStr}`,
        target: '_blank',
        rel: 'noopener'
      }, ['Open W3W ↗']);
      w3wRow.appendChild(w3wVal);
      w3wRow.appendChild(copyBtn);
      w3wRow.appendChild(w3wLink);
      wrap.appendChild(w3wRow);
    }

    if (coords) {
      const mapUrl = buildMapUrl(coords.lat, coords.lon);
      if (mapUrl) {
        const img = el('img', {
          className: 'static-map',
          alt: 'Map of ' + label,
          src: mapUrl
        });
        img.onerror = function () {
          const fallback = el('div', { className: 'map-offline' }, ['📍 Map unavailable offline']);
          this.parentNode.replaceChild(fallback, this);
        };
        wrap.appendChild(img);
      } else {
        const coordDisp = el('div', { className: 'coord-display' }, [coordStr]);
        wrap.appendChild(coordDisp);
      }

      const navBtn = el('a', {
        className: 'nav-btn',
        href: buildNavUrl(coords.lat, coords.lon),
        target: '_blank',
        rel: 'noopener'
      }, ['▶ Navigate']);
      wrap.appendChild(navBtn);
    } else if (coordStr) {
      const coordDisp = el('div', { className: 'coord-display' }, [coordStr]);
      wrap.appendChild(coordDisp);
    }

    return wrap;
  }

  function renderSiteCard(site) {
    const card = $('card-view');
    card.innerHTML = '';
    currentSite = site;

    const siteNo = site['Site No.'] || site['Site No'] || '';
    const siteType = site['Type'] || '';
    const isDual = DUAL_TYPES.has(siteType);

    const camCoord = site['Coordinates (Camera'] || site['Coordinates (Camera)'] || '';
    const camW3w = site['W3W (Camera)'] || '';
    const cabCoord = site['Coordinates (Cabinet)'] || '';
    const cabW3w = site['W3W (Cabinet)'] || '';

    const topBar = el('div', { className: 'card-topbar' });
    const backBtn = el('button', { className: 'back-btn', onclick: closeCard }, ['← Back']);
    const savedNow = isSaved(siteNo);
    const starBtn = el('button', {
      className: 'star-btn' + (savedNow ? ' starred' : ''),
      'data-siteno': siteNo,
      onclick: function () {
        const saved = toggleSaved(siteNo);
        this.textContent = saved ? '★' : '☆';
        this.classList.toggle('starred', saved);
        renderSavedTab();
      }
    }, [savedNow ? '★' : '☆']);
    topBar.appendChild(backBtn);
    topBar.appendChild(starBtn);
    card.appendChild(topBar);

    const title = el('h2', { className: 'card-title' }, [siteNo]);
    card.appendChild(title);

    if (siteType) {
      const badge = el('span', { className: 'type-badge' }, [siteType]);
      card.appendChild(badge);
    }

    const fieldList = el('dl', { className: 'field-list' });
    for (const [key, value] of Object.entries(site)) {
      if (MAP_COORD_KEYS.has(key)) continue;
      if (!value || String(value).trim() === '') continue;
      const dt = el('dt', { className: 'field-key' }, [key]);
      let dd;
      if (key === 'Twin Site') {
        dd = el('dd', { className: 'field-val' });
        const twinBtn = el('button', {
          className: 'twin-site-btn',
          onclick: () => openSite(String(value).trim())
        }, ['🔗 ' + String(value).trim()]);
        dd.appendChild(twinBtn);
      } else {
        dd = el('dd', { className: 'field-val' }, [String(value)]);
      }
      fieldList.appendChild(dt);
      fieldList.appendChild(dd);
    }
    card.appendChild(fieldList);

    const mapArea = el('div', { className: 'map-area' });

    if (isDual) {
      if (camCoord || camW3w) {
        mapArea.appendChild(buildMapBlock('📷 Camera', camCoord, camW3w));
      }
      if (cabCoord || cabW3w) {
        mapArea.appendChild(buildMapBlock('🗄 Cabinet', cabCoord, cabW3w));
      }
    } else {
      if (camCoord || camW3w) {
        mapArea.appendChild(buildMapBlock('📍 Location', camCoord, camW3w));
      }
    }

    if (mapArea.children.length) card.appendChild(mapArea);

    $('search-view').style.display = 'none';
    $('saved-view').style.display = 'none';
    $('card-view').style.display = 'block';
  }

  function openSite(siteNo) {
    const site = allSites.find(s => (s['Site No.'] || s['Site No']) === siteNo);
    if (!site) {
      showStatus('Site not found in local database.', 'warn');
      return;
    }
    addRecent(site);
    renderSiteCard(site);
    renderRecent();
  }

  function closeCard() {
    $('card-view').style.display = 'none';
    if (activeTab === 'saved') {
      $('saved-view').style.display = 'block';
    } else {
      $('search-view').style.display = 'block';
      setSitesIncludedVisible(true);
    }
    currentSite = null;
  }

  let activeTab = 'search';

  function showTab(tab) {
    activeTab = tab;
    $('tab-search').classList.toggle('tab-active', tab === 'search');
    $('tab-saved').classList.toggle('tab-active', tab === 'saved');
    $('search-view').style.display = tab === 'search' ? 'block' : 'none';
    $('saved-view').style.display = tab === 'saved' ? 'block' : 'none';
    $('card-view').style.display = 'none';
    if (tab === 'saved') renderSavedTab();
  }

  function performSearch(query) {
    if (!query) {
      renderDropdown([]);
      setSitesIncludedVisible(true);
      return;
    }
    setSitesIncludedVisible(false);
    const results = fuzzySearch(query);
    renderDropdown(results);
  }

  async function init() {
    $('tab-search').addEventListener('click', () => showTab('search'));
    $('tab-saved').addEventListener('click', () => showTab('saved'));

    const searchInput = $('search-input');
    searchInput.addEventListener('input', () => {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => {
        performSearch(searchInput.value.trim());
      }, 250);
    });

    searchInput.addEventListener('keydown', e => {
      const dd = $('search-dropdown');
      const items = () => Array.from(dd.querySelectorAll('.dd-item'));

      if (e.key === 'Escape') {
        dd.style.display = 'none';
        setSitesIncludedVisible(true);
        searchInput.blur();
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const list = items();
        if (!list.length) return;
        const cur = dd.querySelector('.dd-item.dd-active');
        if (!cur) {
          list[0].classList.add('dd-active');
          list[0].scrollIntoView({ block: 'nearest' });
        } else {
          const idx = list.indexOf(cur);
          cur.classList.remove('dd-active');
          const next = list[Math.min(idx + 1, list.length - 1)];
          next.classList.add('dd-active');
          next.scrollIntoView({ block: 'nearest' });
        }
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        const list = items();
        const cur = dd.querySelector('.dd-item.dd-active');
        if (!cur) return;
        const idx = list.indexOf(cur);
        cur.classList.remove('dd-active');
        if (idx > 0) {
          list[idx - 1].classList.add('dd-active');
          list[idx - 1].scrollIntoView({ block: 'nearest' });
        } else {
          searchInput.focus();
        }
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        clearTimeout(searchDebounce);

        const highlighted = dd.querySelector('.dd-item.dd-active');
        if (highlighted) { highlighted.click(); return; }

        const query = searchInput.value.trim();
        if (!query) return;

        const exact = allSites.find(s =>
          (s['Site No.'] || s['Site No'] || '').toLowerCase() === query.toLowerCase()
        );
        if (exact) {
          openSite(exact['Site No.'] || exact['Site No']);
          dd.style.display = 'none';
          searchInput.value = '';
          setSitesIncludedVisible(true);
          return;
        }

        performSearch(query);
      }
    });

    document.addEventListener('click', e => {
      if (!e.target.closest('#search-wrap')) {
        $('search-dropdown').style.display = 'none';
        setSitesIncludedVisible(true);
      }
    });

    window.addEventListener('online', () => {
      updateConnectionStatus();
      loadData();
    });
    window.addEventListener('offline', updateConnectionStatus);
    updateConnectionStatus();

    if ('serviceWorker' in navigator) {
      try {
        await navigator.serviceWorker.register('/sitenav/sw.js', { scope: '/sitenav/' });
      } catch (e) {
        console.warn('SW registration failed:', e);
      }
    }

    await Promise.all([loadConfig(), loadData()]);
    renderRecent();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
