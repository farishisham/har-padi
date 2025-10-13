// Keep everything inside DOMContentLoaded to ensure elements exist.
// With <script defer> this runs after the HTML is parsed.
document.addEventListener('DOMContentLoaded', () => {
  // ----------------------------
  // DOM REFS
  // ----------------------------
  const iconImg = document.getElementById('gpsIconImg');
  const gpsMsg = document.getElementById('gpsMessage');
  const gpsButton = document.getElementById('gpsButton');

  const searchContainer = document.getElementById('searchContainer');
  const searchInput = document.getElementById('searchInput');
  const searchBtn = document.getElementById('searchBtn');
  const closeBtn = document.getElementById('closeBtn');
  const suggestions = document.getElementById('suggestions');
  const tuaiLegend = document.getElementById('tuaiLegend');

  // Optional HUD (defined to avoid ReferenceErrors; hidden by default)
  const floatingHud = document.getElementById('floatingHud');

  // ----------------------------
  // MAP INIT (order exactly like original)
  // ----------------------------
  const map = new maplibregl.Map({
    container: 'map',
    style: {
      version: 8,
      sources: {
        'esri-satellite': {
          type: 'raster',
          tiles: [
            'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
          ],
          tileSize: 256
        }
      },
      layers: [
        { id: 'esri-layer', type: 'raster', source: 'esri-satellite' }
      ]
    },
    center: [102.68379, 2.23708],
    zoom: 13,
    minZoom: 13,
    maxZoom: 17.4
  });

  // Limit map bounds (order & values follow original)
  map.setMaxBounds([[102.66830, 2.21776], [102.69816, 2.25551]]);
  const boundsPolygon = turf.bboxPolygon([102.66830, 2.21776, 102.69816, 2.25551]);

  // ----------------------------
  // GLOBAL STATE (same names/order)
  // ----------------------------
  let gpsMode = 1, watchId = null, marker = null;
  let blokNumberMarkers = [];
  let blokNameMarkers = [];
  let allFeatures = [];
  let activeWordFilter = null;

  // for floating HUD logic; original referenced but didn’t define
  let currentPopup = null;
  let currentPopupLngLat = null;

  // ----------------------------
  // GPS HELPERS (order preserved)
  // ----------------------------
  function setIconColor() {
    iconImg.style.filter =
      gpsMode === 1 ? 'invert(100%)' :
      gpsMode === 2 ? 'invert(67%) sepia(92%) saturate(455%) hue-rotate(81deg)' :
                      'invert(45%) sepia(100%) saturate(3000%) hue-rotate(5deg)';
  }

  function showGPSMessage() {
    gpsMsg.style.display = 'block';
    setTimeout(() => (gpsMsg.style.display = 'none'), 3000);
  }

  function createMarker(lng, lat) {
    const el = document.createElement('div');
    el.className = 'gps-marker';
    el.innerHTML = '<div class="triangle"></div><div class="circle"></div>';
    marker = new maplibregl.Marker(el).setLngLat([lng, lat]).addTo(map);
  }

  function updateMarker(lng, lat) {
    if (marker) marker.setLngLat([lng, lat]);
    else createMarker(lng, lat);
    if (gpsMode === 3) map.setCenter([lng, lat]);
  }

  function rotateMap(event) {
    if (gpsMode !== 3) return;
    const heading = event.webkitCompassHeading ?? (360 - event.alpha);
    if (heading !== null && !isNaN(heading)) {
      map.rotateTo(heading, { duration: 100 });
    }
  }

  function handleOrientation() {
    if (window.DeviceOrientationEvent && DeviceOrientationEvent.requestPermission) {
      DeviceOrientationEvent.requestPermission().then(granted => {
        if (granted === 'granted') window.addEventListener('deviceorientation', rotateMap, true);
      }).catch(() => {});
    } else {
      window.addEventListener('deviceorientation', rotateMap, true);
    }
  }

  function updateLabelVisibility() {
    const zoom = map.getZoom();
    const opacityNumbers = zoom >= 14.5 ? 0 : 1;
    const opacityNames = zoom >= 16.2 ? 1 : 0;

    blokNumberMarkers.forEach(m => { const el = m.getElement(); if (el) el.style.opacity = opacityNumbers; });
    blokNameMarkers.forEach(m => { const el = m.getElement(); if (el) el.style.opacity = opacityNames; });
  }

  // ----------------------------
  // GPS BUTTON (order preserved)
  // ----------------------------
  gpsButton.addEventListener('click', () => {
    gpsMode = (gpsMode % 3) + 1;
    setIconColor();
    if (watchId) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    window.removeEventListener('deviceorientation', rotateMap);

    if (gpsMode === 1) return;

    watchId = navigator.geolocation.watchPosition(pos => {
      const [lng, lat] = [pos.coords.longitude, pos.coords.latitude];
      const point = turf.point([lng, lat]);
      if (!turf.booleanPointInPolygon(point, boundsPolygon)) {
        gpsMode = 1;
        setIconColor();
        showGPSMessage();
        if (watchId) navigator.geolocation.clearWatch(watchId);
        watchId = null;
        return;
      }
      updateMarker(lng, lat);
      if (gpsMode === 2) map.setCenter([lng, lat]);
    }, null, { enableHighAccuracy: true });

    if (gpsMode === 3) handleOrientation();
  });

  // Cancel GPS mode when user interacts (same as original)
  function cancelGPS() {
    if (gpsMode !== 1) {
      gpsMode = 1;
      setIconColor();
      if (watchId) navigator.geolocation.clearWatch(watchId);
      watchId = null;
      window.removeEventListener('deviceorientation', rotateMap);
    }
  }
  map.on('dragstart', cancelGPS);
  map.on('touchstart', cancelGPS);

  // ----------------------------
  // GROUPS & LOAD (same as original order)
  // ----------------------------
  const groups = {
    sawahring: 'sawahring.json',
    blok: ['blok1.json']
  };

  map.on('load', async () => {
    map.dragPan.enable();
    map.scrollZoom.enable();
    map.touchZoomRotate.enable();

    await loadGroup('sawahring', ['sawahring.json']); // Always first
    await loadGroup('blok', ['blok1.json']);

    showBlokNumbers(); // Number label for sawahring
    showBlokNames();   // Name label for blok
    updateLabelVisibility(); // Initial label visibility
  });

  async function loadGroup(group, files) {
    for (const filename of files) {
      const response = await fetch(filename);
      const data = await response.json();
      const sourceId = `${group}-${filename}`;

      // stamp _id and derive blok_no for sawahring
      data.features.forEach((f, i) => {
        f.properties._id = `${group}-${filename}-${i}`;
        if (group === 'sawahring') {
          const name = f.properties?.name || '';
          const blokNo = parseBlokNumber(name);
          if (blokNo) f.properties.blok_no = blokNo;
        }
      });

      // push after modifications
      allFeatures.push(...data.features);

      // source
      map.addSource(sourceId, { type: 'geojson', data });
      const baseOpacity = group === 'sawahring' ? 0.4 : 0;

      // fill
      map.addLayer({
        id: `${sourceId}-fill`,
        type: 'fill',
        source: sourceId,
        paint: {
          'fill-color': ['get', 'fill'],
          'fill-opacity': [
            'interpolate', ['linear'], ['zoom'],
            13, baseOpacity,
            14, baseOpacity,
            15, baseOpacity === 0.4 ? 0.2 : 0.2,
            16, baseOpacity === 0.4 ? 0 : 0.4
          ]
        }
      });

      // line
      map.addLayer({
        id: `${sourceId}-line`,
        type: 'line',
        source: sourceId,
        paint: {
          'line-color': '#004d26',
          'line-opacity': group === 'sawahring'
            ? ['interpolate', ['linear'], ['zoom'], 13, 1, 14, 1, 15, 1, 16, 0]
            : ['interpolate', ['linear'], ['zoom'], 13, 0, 14, 0, 15, 1, 16, 1],
          'line-width': 1
        }
      });

      // highlight layer
      map.addLayer({
        id: `${sourceId}-highlight`,
        type: 'line',
        source: sourceId,
        paint: { 'line-color': '#ffcc00', 'line-width': 4 },
        filter: ['==', '_id', '']
      });

      // click rules by zoom (like original)
      map.on('click', `${sourceId}-fill`, e => {
        const z = map.getZoom();
        if (group === 'blok' && z >= 15) highlightFeature(e.features[0]);
        if (group === 'sawahring' && z < 15) highlightFeature(e.features[0]);
      });

      // name markers for blok
      if (group === 'blok') {
        data.features.forEach(f => {
          const name = f.properties?.name || '';
          const c1 = turf.centroid(f).geometry.coordinates;
          const c2 = turf.pointOnFeature(f).geometry.coordinates;
          const center = [(c1[0] + c2[0]) / 2, (c1[1] + c2[1]) / 2];
          const el = document.createElement('div');
          el.textContent = name;
          el.style.fontSize = '10px';
          el.style.fontFamily = 'Helvetica, sans-serif';
          el.style.color = 'white';
          el.style.textShadow = '1px 1px 2px black';
          el.style.padding = '2px 4px';
          el.style.background = 'rgba(0,0,0,0.3)';
          el.style.borderRadius = '3px';
          el.style.opacity = '0';
          const marker = new maplibregl.Marker({ element: el }).setLngLat(center).addTo(map);
          blokNameMarkers.push(marker);
        });
      }
    }
  }

  // ----------------------------
  // FLOATING HUD SUPPORT (kept safe)
  // ----------------------------
  function updateFloatingHudVisibility() {
    if (!currentPopup || !currentPopupLngLat || !floatingHud) {
      if (floatingHud) floatingHud.style.display = 'none';
      return;
    }
    const point = map.project(currentPopupLngLat);
    const buffer = 50;
    const canvas = map.getCanvas();
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const offscreen = point.x < buffer || point.x > width - buffer || point.y < buffer || point.y > height - buffer;
    floatingHud.style.display = offscreen ? 'block' : 'none';
  }
  // If you want live HUD: uncomment these
  // map.on('move', updateFloatingHudVisibility);
  // map.on('zoomend', updateFloatingHudVisibility);

  // ----------------------------
  // LABEL MARKERS (numbers & names)
  // ----------------------------
  function showBlokNumbers() {
    blokNumberMarkers.forEach(m => m.remove());
    blokNumberMarkers = [];
    allFeatures.forEach(f => {
      const isSawahRing = f.properties._id?.startsWith('sawahring');
      const blokNo = f.properties.blok_no;
      if (!isSawahRing || !blokNo) return;
      const c1 = turf.centroid(f).geometry.coordinates;
      const c2 = turf.pointOnFeature(f).geometry.coordinates;
      const center = [(c1[0] + c2[0]) / 2, (c1[1] + c2[1]) / 2];
      const el = document.createElement('div');
      el.textContent = `B${blokNo}`;
      el.style.fontSize = '13px';
      el.style.color = 'white';
      el.style.fontWeight = 'bold';
      el.style.textShadow = '1px 1px 2px black';
      el.style.transform = 'translate(-50%, -50%)';
      el.style.pointerEvents = 'none';
      const m = new maplibregl.Marker(el).setLngLat(center).addTo(map);
      blokNumberMarkers.push(m);
    });
  }

  function showBlokNames() {
    blokNameMarkers.forEach(m => m.remove());
    blokNameMarkers = [];
    allFeatures.forEach(f => {
      const isBlok = f.properties._id?.startsWith('blok');
      const blokName = f.properties.name;
      if (!isBlok || !blokName) return;
      const c1 = turf.centroid(f).geometry.coordinates;
      const c2 = turf.pointOnFeature(f).geometry.coordinates;
      const center = [(c1[0] + c2[0]) / 2, (c1[1] + c2[1]) / 2];

      const rawHTML = f.properties?.description?.value || f.properties?.description || '';
      const parser = new DOMParser();
      const doc = parser.parseFromString(rawHTML, 'text/html');
      const text = doc.body.textContent.toLowerCase();
      const match = text.match(/benih\s+(.+?)(?=\s+tarikh|$)/i);
      const benih = match ? match[1].trim().toUpperCase() : '';

      const el = document.createElement('div');
      el.innerHTML = `
        <div style="text-align:center; line-height:1.1;">
          <div style="font-weight:bold;">${blokName}</div>
          <div style="font-weight:normal;">${benih}</div>
        </div>`;
      el.style.fontSize = '10px';
      el.style.color = 'white';
      el.style.textShadow = '1px 1px 2px black';
      el.style.transform = 'translate(-50%, -50%)';
      el.style.pointerEvents = 'none';

      const m = new maplibregl.Marker(el).setLngLat(center).addTo(map);
      blokNameMarkers.push(m);
    });
  }

  // ----------------------------
  // PARSERS (same logic/order)
  // ----------------------------
  function parseBlokNumber(name) {
    const match = String(name || '').toLowerCase().match(/blok\s+(\d+)/);
    return match ? match[1] : null;
  }
  function parseTarikhTanam(f) {
    const rawHTML = f.properties?.description?.value || f.properties?.description || '';
    const parser = new DOMParser();
    const doc = parser.parseFromString(rawHTML, 'text/html');
    const text = doc.body.textContent.toLowerCase().replace(/\s+/g, ' ').trim();
    const match = text.match(/tarikh tanam\s+(\d{1,2}\/\d{1,2}\/\d{4})/);
    if (!match) return 'Tiada info';
    const [day, month, year] = match[1].split('/').map(Number);
    const d = String(day).padStart(2, '0');
    const m = String(month).padStart(2, '0');
    return `${d}/${m}/${year}`;
  }
  function parseTaburInfo(f) {
    const rawHTML = f.properties?.description?.value || f.properties?.description || '';
    const parser = new DOMParser();
    const doc = parser.parseFromString(rawHTML, 'text/html');
    const text = doc.body.textContent.toLowerCase();
    const match = text.match(/tabur\s+\d+\s+beg/i);
    return match ? match[0].charAt(0).toUpperCase() + match[0].slice(1) : null;
  }
  function parseBenihType(f) {
    const rawHTML = f.properties?.description?.value || f.properties?.description || '';
    const parser = new DOMParser();
    const doc = parser.parseFromString(rawHTML, 'text/html');
    const text = doc.body.textContent.toLowerCase().replace(/\s+/g, ' ').trim();
    const match = text.match(/benih\s+(.+?)(?=\s+tarikh|$)/i);
    return match ? match[1].trim().toUpperCase() : null;
  }
  function getDaysSinceTanam(tarikhStr) {
    if (!tarikhStr || tarikhStr === 'Tiada info') return null;
    const [day, month, year] = tarikhStr.split('/').map(Number);
    const tanamDate = new Date(year, month - 1, day);
    const today = new Date();
    return Math.floor((today - tanamDate) / (1000 * 60 * 60 * 24));
  }
  function formatUsiaBenih(tarikhStr) {
    const days = getDaysSinceTanam(tarikhStr);
    return (days === null || isNaN(days)) ? 'Tiada info' : `${days} hari`;
  }

  // ----------------------------
  // HIGHLIGHT + POPUP (same logic, fixed currentPopup)
  // ----------------------------
  function highlightFeature(fPartial) {
    const f = allFeatures.find(feat => feat.properties._id === fPartial.properties._id);
    if (!f) return;

    // Toggle highlight filters across all highlight layers
    map.getStyle().layers.forEach(l => {
      if (l.id.endsWith('-highlight')) {
        const base = l.id.replace(/-highlight$/, '');
        const match = f.properties._id.startsWith(base);
        map.setFilter(l.id, match ? ['==', '_id', f.properties._id] : ['==', '_id', '']);
      }
    });

    // close GPS-follow
    gpsMode = 1;
    setIconColor();

    // fit + popup
    const c1 = turf.centroid(f).geometry.coordinates;
    const c2 = turf.pointOnFeature(f).geometry.coordinates;
    const center = [(c1[0] + c2[0]) / 2, (c1[1] + c2[1]) / 2];

    map.fitBounds(turf.bbox(f), { padding: 100, maxZoom: 17.4, bearing: map.getBearing() });

    const area = (turf.area(f) / 4046.86).toFixed(2);
    const areahectare = (turf.area(f) * 0.405 / 4046.86).toFixed(2);
    const isBlok = !String(f.properties.name || '').toLowerCase().includes('blok');

    let html = `<strong>${f.properties.name}</strong><br>${area} ekar atau ${areahectare} hektar`;

    if (isBlok) {
      const benih = parseBenihType(f);
      const tabur = parseTaburInfo(f);
      const tray = Math.round(area * 35);
      const tarikhTanam = parseTarikhTanam(f);
      const usiaText = formatUsiaBenih(tarikhTanam);
      html += `<br>Benih: ${benih || 'Tiada info'}`;
      if (tabur) html += `<br>${tabur}`;

      const raw = (f.properties.description?.value || f.properties.description || '').toLowerCase();
      if (raw.includes('calit')) {
        html += `<br>${tray} tray atau ${tray * 3} gulung<br>Tarikh tanam: ${tarikhTanam}<br>HLT: ${usiaText}`;
      }
    }

    document.querySelectorAll('.maplibregl-popup').forEach(p => p.remove());
    currentPopup = new maplibregl.Popup({ closeButton: false }).setLngLat(center).setHTML(html).addTo(map);
    currentPopupLngLat = center;

    // optional HUD
    updateFloatingHudVisibility();
  }

  // Clear highlight when clicking empty area
  map.on('click', e => {
    // collect all fill layers
    const fillLayers = map.getStyle().layers.filter(l => l.id.endsWith('-fill')).map(l => l.id);
    const f = map.queryRenderedFeatures(e.point, { layers: fillLayers })[0];
    if (!f) {
      map.getStyle().layers.forEach(l => {
        if (l.id.endsWith('-highlight')) map.setFilter(l.id, ['==', '_id', '']);
      });
      document.querySelectorAll('.maplibregl-popup').forEach(p => p.remove());
      currentPopup = null;
      currentPopupLngLat = null;
      updateFloatingHudVisibility();
    }
  });

  map.on('zoom', updateLabelVisibility);

  // ----------------------------
  // SEARCH (same behavior)
  // ----------------------------
  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase();
    suggestions.innerHTML = '';
    if (!q) return;
    const matches = allFeatures.filter(f => (f.properties.name || '').toLowerCase().includes(q));
    matches.forEach(f => {
      const div = document.createElement('div');
      div.textContent = f.properties.name;
      div.addEventListener('click', () => {
        searchInput.value = '';
        searchContainer.classList.remove('active');
        suggestions.innerHTML = '';
        highlightFeature(f);
      });
      suggestions.appendChild(div);
    });
  });

  searchBtn.addEventListener('click', () => {
    searchContainer.classList.add('active');
    searchInput.focus();
  });

  closeBtn.addEventListener('click', () => {
    searchContainer.classList.remove('active');
    searchInput.value = '';
    suggestions.innerHTML = '';
  });

  // Close search when tapping outside (the map canvas)
  map.getCanvas().addEventListener('click', () => {
    searchContainer.classList.remove('active');
    searchInput.value = '';
    suggestions.innerHTML = '';
  });

  // ----------------------------
  // FILTER BUTTONS UI (same positions/feel)
  // ----------------------------
  const filterContainer = document.createElement('div');
  filterContainer.style.position = 'absolute';
  filterContainer.style.top = '100px';
  filterContainer.style.right = '15px';
  filterContainer.style.display = 'flex';
  filterContainer.style.flexDirection = 'column';
  filterContainer.style.gap = '8px';
  filterContainer.style.zIndex = 1004;
  document.body.appendChild(filterContainer);

  function createFilterButton(label, id) {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.id = id;
    btn.style.width = '50px';
    btn.style.height = '50px';
    btn.style.borderRadius = '50%';
    btn.style.border = 'none';
    btn.style.background = '#333';
    btn.style.color = 'white';
    btn.style.fontSize = '12px';
    btn.style.cursor = 'pointer';
    btn.style.display = 'flex';
    btn.style.alignItems = 'center';
    btn.style.justifyContent = 'center';
    btn.style.userSelect = 'none';
    btn.style.transition = 'color 0.3s ease, background 0.3s ease';
    return btn;
  }

  const bajakBtn = createFilterButton('Bajak', 'bajakFilter');
  const calitBtn = createFilterButton('Calit', 'calitFilter');
  const racunBtn = createFilterButton('Racun', 'racunFilter');
  filterContainer.appendChild(bajakBtn);
  filterContainer.appendChild(calitBtn);
  filterContainer.appendChild(racunBtn);

  // TUAI button (fixed bottom-left)
  const tuaiBtn = document.createElement('button');
  tuaiBtn.textContent = 'Tuai';
  tuaiBtn.style.position = 'fixed';
  tuaiBtn.style.bottom = '35px';
  tuaiBtn.style.left = '15px';
  tuaiBtn.style.width = '50px';
  tuaiBtn.style.height = '50px';
  tuaiBtn.style.borderRadius = '50%';
  tuaiBtn.style.border = 'none';
  tuaiBtn.style.background = '#333';
  tuaiBtn.style.color = 'white';
  tuaiBtn.style.fontSize = '12px';
  tuaiBtn.style.cursor = 'pointer';
  tuaiBtn.style.display = 'flex';
  tuaiBtn.style.alignItems = 'center';
  tuaiBtn.style.justifyContent = 'center';
  tuaiBtn.style.zIndex = 1001;
  document.body.appendChild(tuaiBtn);

  // Checkmark overlay helpers
  let checkMarkers = [];
  function clearCheckMarkers() {
    checkMarkers.forEach(m => m.remove());
    checkMarkers = [];
  }
  function showCheckmarks(keyword) {
    clearCheckMarkers();
    const key = String(keyword || '').toLowerCase();
    allFeatures.forEach(f => {
      const rawHTML = f.properties?.description?.value || f.properties?.description || '';
      const parser = new DOMParser();
      const doc = parser.parseFromString(rawHTML, 'text/html');
      const text = doc.body.textContent.toLowerCase();
      if (!text.includes(key)) return;

      const c1 = turf.centroid(f).geometry.coordinates;
      const c2 = turf.pointOnFeature(f).geometry.coordinates;
      const center = [(c1[0] + c2[0]) / 2, (c1[1] + c2[1]) / 2 + 0.00005];

      const el = document.createElement('div');
      el.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24">
          <path d="M18.047,4,22,8.325,9.3,20,2,12.68,6.136,8.533,9.474,11.88Z" fill="limegreen" />
          <path d="M18.047,4,22,8.325,9.3,20,2,12.68,6.136,8.533,9.474,11.88Z" fill="none" stroke="black" stroke-width="1.5" />
        </svg>`;
      el.style.transform = 'translate(-50%, -50%)';
      const m = new maplibregl.Marker(el).setLngLat(center).addTo(map);
      checkMarkers.push(m);
    });
  }

  let activeKeywordBtn = null;
  function resetFilterBtnColors() {
    bajakBtn.style.color = 'white';
    calitBtn.style.color = 'white';
    racunBtn.style.color = 'white';
  }
  function attachKeywordButton(btn, keyword) {
    btn.addEventListener('click', () => {
      const isActive = activeKeywordBtn === btn;
      clearCheckMarkers();
      resetFilterBtnColors();
      if (isActive) {
        activeKeywordBtn = null;
      } else {
        activeKeywordBtn = btn;
        btn.style.color = 'limegreen';
        showCheckmarks(keyword);
      }
    });
  }
  attachKeywordButton(bajakBtn, 'bajak');
  attachKeywordButton(calitBtn, 'calit');
  attachKeywordButton(racunBtn, 'racun');

  // ----------------------------
  // TUAI color mode (same outputs)
  // ----------------------------
  function getRipenessColor(days, ripeDays) {
    if (days < 0) return '#999999';
    if (days < ripeDays * 0.25) return '#00cc00';
    if (days < ripeDays * 0.5) return '#00cc00';
    if (days < ripeDays * 0.75) return '#00cc00';
    if (days < ripeDays) return '#00cc00';
    if (days < ripeDays + 10) return '#ffd700';
    return '#802600';
  }
  function extractDescriptionText(f) {
    const rawHTML = f.properties?.description?.value || f.properties?.description || '';
    const parser = new DOMParser();
    const doc = parser.parseFromString(rawHTML, 'text/html');
    return doc.body.textContent?.toLowerCase() || '';
  }

  let tuaiActive = false;
  function toggleTuai() {
    tuaiActive = !tuaiActive;
    tuaiBtn.style.color = tuaiActive ? 'limegreen' : 'white';
    tuaiLegend.style.display = tuaiActive ? 'block' : 'none';

    // find all base layer ids (prefix before -fill)
    const style = map.getStyle();
    const bases = style.layers
      .filter(l => l.id.endsWith('-fill'))
      .map(l => l.id.replace(/-fill$/, ''));

    bases.forEach(base => {
      const source = map.getSource(base);
      if (!source || !source._data) return;

      const updated = source._data.features.map(f => {
        if (!tuaiActive) {
          return { ...f, properties: { ...f.properties, fill: f.properties.originalFill || f.properties.fill || '#ffffff' } };
        }
        const descText = extractDescriptionText(f);
        const benihMatch = descText.match(/benih\s+([^\s]+)/i);
        const benih = benihMatch ? benihMatch[1].toUpperCase() : null;
        const tarikhMatch = descText.match(/tarikh\s+tanam\s+(\d{1,2}\/\d{1,2}\/\d{4})/i);
        const tarikhStr = tarikhMatch ? tarikhMatch[1] : null;

        const ripeDaysMap = { 'CL': 100, '269': 104, '467': 110, '297': 110, 'HYBRID': 104 };
        const ripeDays = ripeDaysMap[benih] || 110;
        let color = '#888';

        if (tarikhStr) {
          const [d, m, y] = tarikhStr.split('/').map(Number);
          const tanamDate = new Date(y, m - 1, d);
          const now = new Date();
          const days = Math.floor((now - tanamDate) / (1000 * 60 * 60 * 24));
          color = getRipenessColor(days, ripeDays);
        }

        return { ...f, properties: { ...f.properties, originalFill: f.properties.fill || '#ffffff', fill: color } };
      });

      source.setData({ type: 'FeatureCollection', features: updated });

      const fillId = `${base}-fill`;
      const lineId = `${base}-line`;
      const isSawahRing = base.includes('sawahring');

      if (map.getLayer(fillId)) {
        map.setPaintProperty(
          fillId,
          'fill-opacity',
          tuaiActive
            ? (isSawahRing ? 0 : 0.5)
            : [
                'interpolate', ['linear'], ['zoom'],
                13, isSawahRing ? 0.4 : 0,
                14, isSawahRing ? 0.4 : 0,
                15, isSawahRing ? 0.2 : 0.2,
                16, isSawahRing ? 0 : 0.4
              ]
        );
      }
      if (map.getLayer(lineId)) {
        if (tuaiActive) {
          map.setPaintProperty(lineId, 'line-opacity', isSawahRing ? 0 : 1);
          map.setPaintProperty(lineId, 'line-width', isSawahRing ? 0 : 1);
        } else {
          map.setPaintProperty(lineId, 'line-opacity', 1);
          map.setPaintProperty(lineId, 'line-width', 1);
        }
      }
    });
  }
  tuaiBtn.addEventListener('click', toggleTuai);

  // ----------------------------
  // FINAL INIT
  // ----------------------------
  setIconColor();

  // define to avoid reference in an old function name; not used elsewhere, kept for parity
  let sawahRingLabels = [];
});
