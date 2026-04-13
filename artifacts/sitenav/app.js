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
    'W3W', 'w3w', 'Latitude', 'Longitude', 'latitude', 'longitude',
    'W3W (Camera)', 'W3W (Cabinet)'
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
      window.siteSearchConfig = data.searchConfig || {};
    } catch (_) {}
  }

  function buildMapUrl(lat, lon, zoom = 16) {
    return `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lon}&zoom=${zoom}&size=600x300&markers=color:red%7C${lat},${lon}&key=${mapsApiKey}`;
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
    btn.classList.add('copied');
    setTimeout(() => {
      btn.textContent = orig;
      btn.classList.remove('copied');
    }, 1500);
  }

  function scoreMatch(site, terms) {
    const siteNo  = (site['Site No.'] || site['Site No'] || site['Site Number'] || site['site_number'] || '').toLowerCase();
    
    let searchableString = '';
    const config = window.siteSearchConfig || {};
    for (const [k, v] of Object.entries(site)) {
        if (config[k] === true && v) {
            searchableString += ' ' + String(v).toLowerCase();
        }
    }

    let score = 0;
    for (const t of terms) {
      if (siteNo.includes(t)) {
        const idx = siteNo.indexOf(t);
        score += idx === 0 ? 6 : siteNo[idx - 1] === ' ' ? 5 : 4;
      } else if (searchableString.includes(t)) {
        score += 1;
      } else {
        return -1;
      }
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
    const sNo = site['Site No.'] || site['Site No'] || site['Site Number'] || site['site_number'];
    let list = getRecent().filter(s => (s['Site No.'] || s['Site No'] || s['Site Number'] || s['site_number']) !== sNo);
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
      const siteNo = site['Site No.'] || site['Site No'] || site['Site Number'] || site['site_number'] || '';
      const ref = site['Site Reference'] || '';
      const addr = site['Address'] || '';
      const type = site['Type'] || '';
      const item = el('button', {
        className: 'dd-item',
        role: 'option',
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
      const siteNo = site['Site No.'] || site['Site No'] || site['Site Number'] || site['site_number'] || '';
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
      const site = allSites.find(s => (s['Site No.'] || s['Site No'] || s['Site Number'] || s['site_number']) === siteNo);
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

  function svgIcon(pathD, viewBox) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', viewBox || '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.width = '16px';
    svg.style.height = '16px';
    svg.style.flexShrink = '0';
    if (Array.isArray(pathD)) {
      pathD.forEach(d => {
        const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p.setAttribute('d', d);
        svg.appendChild(p);
      });
    } else {
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', pathD);
      svg.appendChild(p);
    }
    return svg;
  }

  const SVG_PATHS = {
    camera: 'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z',
    cameraCircle: 'M12 13m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0',
    cabinet: 'M4 2h16a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z',
    cabinetLine: 'M2 12h20',
    pin: ['M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z', 'M12 10m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0'],
    nav: 'M5 12h14M12 5l7 7-7 7',
    arrowLeft: 'M19 12H5M12 19l-7-7 7-7',
    link: ['M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71', 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'],
    externalLink: ['M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6', 'M15 3h6v6', 'M10 14L21 3'],
    starFilled: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
    starOutline: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
    share: ['M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8', 'M16 6l-4-4-4 4', 'M12 2v13']
  };

  function buildMapBlock(label, lat, lon, w3wStr, iconType) {
    const wrap = el('div', { className: 'map-section' });
    const inner = el('div', { className: 'map-section-inner' });
    const heading = el('h3', { className: 'map-heading' });

    if (iconType === 'camera') {
      const icon = svgIcon(SVG_PATHS.camera);
      const icon2 = svgIcon(SVG_PATHS.cameraCircle);
      icon.appendChild(icon2.querySelector('path'));
      heading.appendChild(icon);
    } else if (iconType === 'cabinet') {
      const icon = svgIcon(SVG_PATHS.cabinet);
      const line = svgIcon(SVG_PATHS.cabinetLine);
      icon.appendChild(line.querySelector('path'));
      heading.appendChild(icon);
    } else {
      const icon = svgIcon(SVG_PATHS.pin);
      heading.appendChild(icon);
    }
    heading.appendChild(document.createTextNode(label));
    inner.appendChild(heading);

    if (w3wStr) {
      const w3wRow = el('div', { className: 'w3w-row' });
      const w3wVal = el('span', { className: 'w3w-val' }, ['///' + w3wStr]);
      const copyBtn = el('button', {
        className: 'copy-btn',
        'aria-label': 'Copy W3W address',
        onclick: function () { copyText('///' + w3wStr, this); }
      }, ['Copy']);
      const w3wLink = el('a', {
        className: 'w3w-link-btn',
        href: `https://what3words.com/${w3wStr}`,
        target: '_blank',
        rel: 'noopener',
        'aria-label': 'Open in What3Words'
      }, ['Open W3W']);
      const extIcon = svgIcon(SVG_PATHS.externalLink);
      extIcon.style.width = '12px';
      extIcon.style.height = '12px';
      w3wLink.appendChild(extIcon);
      w3wRow.appendChild(w3wVal);
      w3wRow.appendChild(copyBtn);
      w3wRow.appendChild(w3wLink);
      inner.appendChild(w3wRow);
    }

    if (lat && lon) {
      const mapUrl = buildMapUrl(lat, lon);
      if (mapUrl) {
        const img = el('img', {
          className: 'static-map',
          alt: 'Map of ' + label,
          src: mapUrl
        });
        img.onerror = function () {
          const fallback = el('div', { className: 'map-offline' });
          const pinIcon = svgIcon(SVG_PATHS.pin);
          pinIcon.style.width = '24px';
          pinIcon.style.height = '24px';
          fallback.appendChild(pinIcon);
          fallback.appendChild(document.createTextNode('Map unavailable offline'));
          this.parentNode.replaceChild(fallback, this);
        };
        inner.appendChild(img);
      } else {
        const coordDisp = el('div', { className: 'coord-display' }, [`${lat}, ${lon}`]);
        inner.appendChild(coordDisp);
      }

      const navBtn = el('a', {
        className: 'nav-btn',
        href: buildNavUrl(lat, lon),
        target: '_blank',
        rel: 'noopener',
        'aria-label': 'Navigate to ' + label
      });
      const navIcon = svgIcon(SVG_PATHS.nav);
      navIcon.style.width = '18px';
      navIcon.style.height = '18px';
      navBtn.appendChild(navIcon);
      navBtn.appendChild(document.createTextNode('Navigate'));
      inner.appendChild(navBtn);
    } else if (lat || lon) {
      const coordDisp = el('div', { className: 'coord-display' }, [lat ? lat : lon]);
      inner.appendChild(coordDisp);
    }

    wrap.appendChild(inner);
    return wrap;
  }

  function renderSiteCard(site) {
    const card = $('card-view');
    card.innerHTML = '';
    currentSite = site;

    const siteNo = site['Site No.'] || site['Site No'] || site['Site Number'] || site['site_number'] || '';
    const siteType = site['Type'] || '';
    const isDual = DUAL_TYPES.has(siteType);

    const lat = site['Latitude'] || site['latitude'] || site['Lat'] || '';
    const lon = site['Longitude'] || site['longitude'] || site['Lon'] || '';

    const w3w = site['W3W'] || site['w3w'] || site['W3W (Camera)'] || '';
    const cabW3w = site['W3W (Cabinet)'] || '';

    const topBar = el('div', { className: 'card-topbar' });
    const backBtn = el('button', { className: 'back-btn', 'aria-label': 'Go back', onclick: closeCard });
    const backIcon = svgIcon(SVG_PATHS.arrowLeft);
    backBtn.appendChild(backIcon);
    backBtn.appendChild(document.createTextNode('Back'));

    const savedNow = isSaved(siteNo);
    function makeStarSvg(filled) {
      const svg = svgIcon(SVG_PATHS.starFilled);
      svg.style.width = '24px';
      svg.style.height = '24px';
      if (filled) { svg.setAttribute('fill', 'currentColor'); }
      return svg;
    }
    const starBtn = el('button', {
      className: 'star-btn' + (savedNow ? ' starred' : ''),
      'data-siteno': siteNo,
      'aria-label': savedNow ? 'Unsave site' : 'Save site',
      onclick: function () {
        const saved = toggleSaved(siteNo);
        this.innerHTML = '';
        this.appendChild(makeStarSvg(saved));
        this.classList.toggle('starred', saved);
        this.setAttribute('aria-label', saved ? 'Unsave site' : 'Save site');
        renderSavedTab();
      }
    });
    starBtn.appendChild(makeStarSvg(savedNow));
    const topRight = el('div', { style: 'display: flex; gap: 4px;' });
    const shareBtn = el('button', {
      className: 'star-btn',
      'aria-label': 'Share site',
      title: 'Share site link',
      onclick: async function() {
        const url = window.location.origin + '/' + encodeURIComponent(siteNo);
        if (navigator.share) {
          try {
            await navigator.share({
              title: 'SiteNav: ' + siteNo,
              text: 'View details for site ' + siteNo,
              url: url
            });
          } catch (err) {
            // User cancelled or share failed
          }
        } else {
          copyText(url, this);
        }
      }
    });
    const shareIcon = svgIcon(SVG_PATHS.share);
    shareIcon.style.width = '20px';
    shareIcon.style.height = '20px';
    shareBtn.appendChild(shareIcon);

    topRight.appendChild(shareBtn);
    topRight.appendChild(starBtn);
    
    topBar.appendChild(backBtn);
    topBar.appendChild(topRight);
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
      if (key === 'SiteDrawingUrl' || key === 'FullDesignPackUrl') continue;
      if (!value || String(value).trim() === '') continue;
      const dt = el('dt', { className: 'field-key' }, [key]);
      let dd;
      if (key === 'Twin Site') {
        dd = el('dd', { className: 'field-val' });
        const twinBtn = el('button', {
          className: 'twin-site-btn',
          'aria-label': 'Go to twin site ' + String(value).trim(),
          onclick: () => openSite(String(value).trim())
        });
        const linkIcon = svgIcon(SVG_PATHS.link);
        twinBtn.appendChild(linkIcon);
        twinBtn.appendChild(document.createTextNode(String(value).trim()));
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
      if (lat || lon || w3w) {
        mapArea.appendChild(buildMapBlock('Camera', lat, lon, w3w, 'camera'));
      }
      if (cabW3w) {
        mapArea.appendChild(buildMapBlock('Cabinet', null, null, cabW3w, 'cabinet'));
      }
    } else {
      if (lat || lon || w3w) {
        mapArea.appendChild(buildMapBlock('Location', lat, lon, w3w, 'pin'));
      }
    }

    if (mapArea.children.length) card.appendChild(mapArea);

    const pdfButtons = el('div', { className: 'pdf-buttons-area' });
    card.appendChild(pdfButtons);

    function addPdfButton(url, text, bgColor) {
      const filename = url.split('/').pop();
      if (!filename) return;

      const btn = el('a', { className: 'nav-btn', href: url, target: '_blank', rel: 'noopener', style: `background: ${bgColor}; color: #fff; margin-bottom: 12px; margin-top: 16px; display: none;` }, [text]);
      pdfButtons.appendChild(btn);

      fetch(BASE + '/api/pdf-check/' + filename)
        .then(r => r.json())
        .then(d => {
          if (d.exists) btn.style.display = 'block';
        })
        .catch(e => console.error('PDF check failed', e));
    }

    if (site['SiteDrawingUrl']) addPdfButton(site['SiteDrawingUrl'], 'View Site Drawing PDF', '#1E2ED9');
    if (site['FullDesignPackUrl']) addPdfButton(site['FullDesignPackUrl'], 'View Full Design Pack', '#000');

    $('search-view').style.display = 'none';
    $('saved-view').style.display = 'none';
    $('card-view').style.display = 'block';
  }

  function openSite(siteNo, avoidPush = false) {
    const site = allSites.find(s => (s['Site No.'] || s['Site No'] || s['Site Number'] || s['site_number']) === siteNo);
    if (!site) {
      showStatus('Site not found in local database.', 'warn');
      return;
    }
    
    if (!avoidPush) {
      history.pushState(null, '', '/' + encodeURIComponent(siteNo));
    }
    
    addRecent(site);
    renderSiteCard(site);
    renderRecent();
  }

  function closeCard(avoidPush = false) {
    $('card-view').style.display = 'none';
    if (activeTab === 'saved') {
      $('saved-view').style.display = 'block';
    } else {
      $('search-view').style.display = 'block';
      setSitesIncludedVisible(true);
    }
    currentSite = null;
    
    if (!avoidPush) {
      history.pushState(null, '', activeTab === 'saved' ? '/saved' : '/');
    }
  }

  let activeTab = 'search';

  function showTab(tab, avoidPush = false) {
    activeTab = tab;
    $('tab-search').classList.toggle('tab-active', tab === 'search');
    $('tab-saved').classList.toggle('tab-active', tab === 'saved');
    $('search-view').style.display = tab === 'search' ? 'block' : 'none';
    $('saved-view').style.display = tab === 'saved' ? 'block' : 'none';
    $('card-view').style.display = 'none';
    if (tab === 'saved') renderSavedTab();
    
    if (!avoidPush) {
      history.pushState(null, '', tab === 'saved' ? '/saved' : '/');
    }
  }

  function handleRoute() {
    let path = window.location.pathname.replace(/\/$/, '');
    if (path === '' || path === '/' || path === '/home') {
      closeCard(true);
      showTab('search', true);
    } else if (path === '/saved') {
      closeCard(true);
      showTab('saved', true);
    } else if (path.length > 1) {
      const siteNo = decodeURIComponent(path.substring(1));
      openSite(siteNo, true);
    }
  }

  window.addEventListener('popstate', handleRoute);

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

    const homeLink = $('header-home-link');
    if (homeLink) {
      homeLink.addEventListener('click', e => {
        e.preventDefault();
        history.pushState(null, '', '/');
        handleRoute();
      });
    }

    const searchInput = $('search-input');
    searchInput.addEventListener('input', () => {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => {
        performSearch(searchInput.value.trim());
      }, 250);
    });

    $('search-form').addEventListener('submit', e => {
      e.preventDefault();
      const dd = $('search-dropdown');
      clearTimeout(searchDebounce);

      const highlighted = dd.querySelector('.dd-item.dd-active');
      if (highlighted) { highlighted.click(); return; }

      const query = searchInput.value.trim();
      if (!query) return;

      const exact = allSites.find(s =>
        (s['Site No.'] || s['Site No'] || s['Site Number'] || s['site_number'] || '').toLowerCase() === query.toLowerCase()
      );
      if (exact) {
        openSite(exact['Site No.'] || exact['Site No'] || exact['Site Number'] || exact['site_number']);
        dd.style.display = 'none';
        searchInput.value = '';
        setSitesIncludedVisible(true);
        return;
      }

      performSearch(query);
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
        await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      } catch (e) {
        console.warn('SW registration failed:', e);
      }
    }

    await Promise.all([loadConfig(), loadData()]);
    renderRecent();
    handleRoute();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
