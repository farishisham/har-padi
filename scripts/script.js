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
    layers: [{
      id: 'esri-layer',
      type: 'raster',
      source: 'esri-satellite'
    }]
  },
  center: [102.68379, 2.23708],
  zoom: 13,
  minZoom: 13,
  maxZoom: 17.4
});

// ===== COOKIE UTILS =====
function setCookie(name, value, days) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/`;
}

function getCookie(name) {
  return document.cookie.split('; ').reduce((r, v) => {
    const parts = v.split('=');
    return parts[0] === name ? decodeURIComponent(parts[1]) : r;
  }, '');
}

function deleteCookie(name) {
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
}


// Limit map bounds
map.setMaxBounds([[102.66830, 2.21776], [102.69816, 2.25551]]);
const boundsPolygon = turf.bboxPolygon([102.66830, 2.21776, 102.69816, 2.25551]);

// GPS and Marker
let gpsMode = 1, watchId = null, marker = null;
const iconImg = document.getElementById('gpsIconImg');
const gpsMsg = document.getElementById('gpsMessage');

// FUNCTIONS
function setIconColor() {
  iconImg.style.filter =
    gpsMode === 1 ? 'invert(100%)' :
    gpsMode === 2 ? 'invert(67%) sepia(92%) saturate(455%) hue-rotate(81deg)' :
                    'invert(45%) sepia(100%) saturate(3000%) hue-rotate(5deg)';
}

function showGPSMessage() {
  gpsMsg.style.display = 'block';
  setTimeout(() => gpsMsg.style.display = 'none', 3000);
}

function createMarker(lng, lat) {
  const el = document.createElement('div');
  el.className = 'gps-marker';
  el.innerHTML = '<div class="triangle"></div><div class="circle"></div>';
  marker = new maplibregl.Marker(el).setLngLat([lng, lat]).addTo(map);
}

function updateMarker(lng, lat) {
  if (marker) {
    marker.setLngLat([lng, lat]);
  } else {
    createMarker(lng, lat);
  }
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
  if (DeviceOrientationEvent.requestPermission) {
    DeviceOrientationEvent.requestPermission().then(granted => {
      if (granted === 'granted') window.addEventListener('deviceorientation', rotateMap, true);
    });
  } else {
    window.addEventListener('deviceorientation', rotateMap, true);
  }
}

function updateLabelVisibility() {
  const zoom = map.getZoom();
  const opacity = zoom >= 14.5 ? 0 : 1;
  const opacity2 = zoom >= 16.2 ? 1 : 0;

  blokNumberMarkers.forEach(marker => {
    if (marker.getElement()) {
      marker.getElement().style.opacity = opacity;
    }
  });

  blokNameMarkers.forEach(marker => {
    if (marker.getElement()) {
      marker.getElement().style.opacity = opacity2;
    }
  });
}

// GPS Button Click
document.getElementById('gpsButton').addEventListener('click', () => {
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

// Cancel GPS mode when user interacts
map.on('dragstart', () => {
  if (gpsMode !== 1) {
    gpsMode = 1;
    setIconColor();
    if (watchId) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    window.removeEventListener('deviceorientation', rotateMap);
  }
});

map.on('touchstart', () => {
  if (gpsMode !== 1) {
    gpsMode = 1;
    setIconColor();
    if (watchId) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    window.removeEventListener('deviceorientation', rotateMap);
  }
});

// --- POLYGONS ---
const groups = {
  sawahring: 'sawahring.json',
  blok: ['blok1.json']
};

let blokNumberMarkers = [];
let blokNameMarkers = [];
let allFeatures = [];
let activeWordFilter = null;

// On load
map.on('load', async () => {
  map.dragPan.enable();
  map.scrollZoom.enable();
  map.touchZoomRotate.enable();

  await loadGroup('sawahring', ['sawahring.json']);
  await loadGroup('blok', ['blok1.json']);

  showBlokNumbers();
  showBlokNames();
  updateLabelVisibility();
});

async function loadGroup(group, files) {
  for (const filename of files) {
    const response = await fetch(filename);
    const data = await response.json();
    const sourceId = `${group}-${filename}`;

    data.features.forEach((f, i) => {
      f.properties._id = `${group}-${filename}-${i}`;
      if (group === 'sawahring') {
        const name = f.properties?.name || '';
        const blokNo = parseBlokNumber(name);
        if (blokNo) f.properties.blok_no = blokNo;
      }
    });

    allFeatures.push(...data.features);

    map.addSource(sourceId, { type: 'geojson', data });

    const baseOpacity = group === 'sawahring' ? 0.4 : 0;
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

    map.addLayer({
      id: `${sourceId}-line`,
      type: 'line',
      source: sourceId,
      paint: {
        'line-color': '#004d26',
        'line-opacity': 1,
        'line-width': 1
      }
    });

    map.addLayer({
      id: `${sourceId}-highlight`,
      type: 'line',
      source: sourceId,
      paint: {
        'line-color': '#ffcc00',
        'line-width': 4
      },
      filter: ['==', '_id', '']
    });
    
    map.on('click', `${sourceId}-fill`, e => {
      const zoom = map.getZoom();
      if ((group === 'blok' && zoom >= 15) || (group === 'sawahring' && zoom < 15))
        highlightFeature(e.features[0]);
    });
  }
}

function showBlokNumbers() {
  blokNumberMarkers.forEach(m => m.remove());
  blokNumberMarkers = [];

  allFeatures.forEach(f => {
    const isSawahRing = f.properties._id?.startsWith('sawahring');
    const blokNo = f.properties.blok_no;
    if (isSawahRing && blokNo) {
      const center1 = turf.centroid(f).geometry.coordinates;
      const center2 = turf.pointOnFeature(f).geometry.coordinates;
      const offsetCenter = [(center1[0] + center2[0]) / 2,(center1[1] + center2[1]) / 2];
      const center = offsetCenter;
      const el = document.createElement('div');
      el.textContent = `B${blokNo}`;
      el.style.fontSize = '13px';
      el.style.color = 'white';
      el.style.fontWeight = 'bold';
      el.style.textShadow = '1px 1px 2px black';
      el.style.transform = 'translate(-50%, -50%)';
      el.style.pointerEvents = 'none';
      const marker = new maplibregl.Marker(el)
        .setLngLat(center)
        .addTo(map);
      blokNumberMarkers.push(marker);
    }
  });
}

function showBlokNames() {
  blokNameMarkers.forEach(m => m.remove());
  blokNameMarkers = [];

  allFeatures.forEach(f => {
    const isBlok = f.properties._id?.startsWith('blok');
    const blokName = f.properties.name;
    if (isBlok && blokName) {
      const center1 = turf.centroid(f).geometry.coordinates;
      const center2 = turf.pointOnFeature(f).geometry.coordinates;
      const center = [
        (center1[0] + center2[0]) / 2,
        (center1[1] + center2[1]) / 2
      ];
      const rawHTML = f.properties?.description?.value || '';
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
        </div>
      `;
      el.style.fontSize = '10px';
      el.style.color = 'white';
      el.style.textShadow = '1px 1px 2px black';
      el.style.transform = 'translate(-50%, -50%)';
      el.style.pointerEvents = 'none';
      const marker = new maplibregl.Marker(el)
        .setLngLat(center)
        .addTo(map);
      blokNameMarkers.push(marker);
    }
  });
}

function parseBlokNumber(name) {
  const match = name.toLowerCase().match(/blok\s+(\d+)/);
  return match ? match[1] : null;
}

function parseTarikhTanam(f) {
  const rawHTML = f.properties?.description?.value || '';
  const parser = new DOMParser();
  const doc = parser.parseFromString(rawHTML, 'text/html');
  const text = doc.body.textContent.toLowerCase().replace(/\s+/g, ' ').trim();
  const match = text.match(/tarikh tanam\s+(\d{1,2}\/\d{1,2}\/\d{4})/);
  if (!match) return 'Tiada info';
  const [day, month, year] = match[1].split('/').map(Number);
  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
}

function parseTaburInfo(f) {
  const rawHTML = f.properties?.description?.value || '';
  const parser = new DOMParser();
  const doc = parser.parseFromString(rawHTML, 'text/html');
  const text = doc.body.textContent.toLowerCase();
  const match = text.match(/tabur\s+\d+\s+beg/i);
  return match ? match[0].charAt(0).toUpperCase() + match[0].slice(1) : null;
}

function parseBenihType(f) {
  const rawHTML = f.properties?.description?.value || '';
  const parser = new DOMParser();
  const doc = parser.parseFromString(rawHTML, 'text/html');
  const text = doc.body.textContent.toLowerCase().replace(/\s+/g, ' ').trim();
  const match = text.match(/benih\s+(.+?)(?=\s+tarikh|$)/i);
  return match ? match[1].trim().toUpperCase() : null;
}

function getDaysSinceTanam(tarikhStr) {
  if (!tarikhStr) return null;
  const [day, month, year] = tarikhStr.split('/').map(Number);
  const tanamDate = new Date(year, month - 1, day);
  const today = new Date();
  return Math.floor((today - tanamDate) / (1000 * 60 * 60 * 24));
}

function formatUsiaBenih(tarikhStr) {
  const days = getDaysSinceTanam(tarikhStr);
  return isNaN(days) || days === null ? 'Tiada info' : `${days} hari`;
}

function highlightFeature(fPartial) {
  const f = allFeatures.find(feat => feat.properties._id === fPartial.properties._id);
  if (!f) return;

  Object.entries(groups).forEach(([group, files]) => {
    (Array.isArray(files) ? files : [files]).forEach(file => {
      const id = `${group}-${file}`;
      const filter = f.properties._id.startsWith(id)
        ? ['==', '_id', f.properties._id]
        : ['==', '_id', ''];
      map.setFilter(`${id}-highlight`, filter);
    });
  });

  document.querySelectorAll('.maplibregl-popup').forEach(p => p.remove());
  gpsMode = 1;
  setIconColor();

  const center1 = turf.centroid(f).geometry.coordinates;
  const center2 = turf.pointOnFeature(f).geometry.coordinates;
  const center = [(center1[0] + center2[0]) / 2, (center1[1] + center2[1]) / 2];

  map.fitBounds(turf.bbox(f), { padding: 100, maxZoom: 17.4, bearing: map.getBearing() });

  const area = (turf.area(f) / 4046.86).toFixed(2);
  const areahectare = (turf.area(f) * 0.405 / 4046.86).toFixed(2);
  const isBlok = !f.properties.name?.toLowerCase().includes('blok');

  let popupHTML = `<strong>${f.properties.name}</strong><br>${area} ekar atau [${areahectare} hektar]`;
  if (isBlok) {
    const benih = parseBenihType(f);
    const tabur = parseTaburInfo(f);
    const tray = Math.round(area * 35);
    const tarikhTanam = parseTarikhTanam(f);
    const usiaText = formatUsiaBenih(tarikhTanam);
    popupHTML += `<br>Benih: ${benih || 'Tiada info'}<br>${tray} tray atau ${tray * 3} gulung`;
    if (tabur) popupHTML += `<br>${tabur}`;
    if (f.properties.description?.value?.toLowerCase().includes('calit'))
      popupHTML += `<br>Tarikh tanam: ${tarikhTanam}<br>HLT: ${usiaText}`;
  }

  new maplibregl.Popup({ closeButton: false })
    .setLngLat(center)
    .setHTML(popupHTML)
    .addTo(map)
    .getElement()
    .classList.add('popup-no-x');
}

map.on('click', e => {
  const allLayers = [];
  Object.entries(groups).forEach(([g, files]) => {
    (Array.isArray(files) ? files : [files]).forEach(f => {
      allLayers.push(`${g}-${f}-fill`);
    });
  });
  const f = map.queryRenderedFeatures(e.point, { layers: allLayers })[0];
  if (!f) {
    Object.entries(groups).forEach(([g, files]) => {
      (Array.isArray(files) ? files : [files]).forEach(file => {
        map.setFilter(`${g}-${file}-highlight`, ['==', '_id', '']);
      });
    });
    document.querySelectorAll('.maplibregl-popup').forEach(p => p.remove());
  }
});

map.on('zoom', updateLabelVisibility);

// --- SEARCH ---
const input = document.getElementById('searchInput');
const container = document.getElementById('searchContainer');
const suggestions = document.getElementById('suggestions');

input.addEventListener('input', () => {
  const q = input.value.trim().toLowerCase();
  suggestions.innerHTML = '';
  if (!q) return;
  const matches = allFeatures.filter(f => f.properties.name?.toLowerCase().includes(q));
  matches.forEach(f => {
    const div = document.createElement('div');
    div.textContent = f.properties.name;
    div.addEventListener('click', () => {
      input.value = '';
      container.classList.remove('active');
      suggestions.innerHTML = '';
      highlightFeature(f);
    });
    suggestions.appendChild(div);
  });
});

document.getElementById('searchBtn').addEventListener('click', () => {
  container.classList.add('active');
  input.focus();
});

document.getElementById('closeBtn').addEventListener('click', () => {
  container.classList.remove('active');
  input.value = '';
  suggestions.innerHTML = '';
});

map.getCanvas().addEventListener('click', () => {
  container.classList.remove('active');
  input.value = '';
  suggestions.innerHTML = '';
});

// --- FILTER BUTTONS ---
const filterContainer = document.createElement('div');
filterContainer.style.position = 'absolute';
filterContainer.style.top = '100px';
filterContainer.style.right = '15px';
filterContainer.style.display = 'flex';
filterContainer.style.flexDirection = 'column';
filterContainer.style.gap = '8px';
filterContainer.style.touchAction = 'none';
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

const tuaiBtn = document.createElement('button');
tuaiBtn.textContent = 'Tuai';
tuaiBtn.style.position = 'fixed';
tuaiBtn.style.display = 'flex';
tuaiBtn.style.alignItems = 'center';
tuaiBtn.style.justifyContent = 'center';
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
tuaiBtn.style.zIndex = 1001;
document.body.appendChild(tuaiBtn);

const benihRipenessDays = { 'cl': 100, '269': 120, 'hybrid': 110 };

filterContainer.appendChild(tuaiBtn);
filterContainer.appendChild(bajakBtn);
filterContainer.appendChild(calitBtn);
filterContainer.appendChild(racunBtn);

function extractDescriptionText(f) {
  const rawHTML = f.properties?.description?.value || f.properties?.description || '';
  const parser = new DOMParser();
  const doc = parser.parseFromString(rawHTML, 'text/html');
  return doc.body.textContent?.toLowerCase() || '';
}

function getRipenessColor(days, ripeDays) {
  if (days < 0) return '#999999';
  if (days < ripeDays * 0.25) return '#00cc00';
  if (days < ripeDays * 0.5) return '#00cc00';
  if (days < ripeDays * 0.75) return '#00cc00';
  if (days < ripeDays) return '#00cc00';
  if (days < ripeDays + 10) return '#ffd700';
  return '#802600';
}

let tuaiActive = false;

function toggleTuai() {
  tuaiActive = !tuaiActive;
  tuaiBtn.style.color = tuaiActive ? 'limegreen' : 'white';
  tuaiLegend.style.display = tuaiActive ? 'block' : 'none';

  Object.entries(groups).forEach(([group, files]) => {
    const isSawahRing = group === 'sawahring';
    const fileList = Array.isArray(files) ? files : [files];

    fileList.forEach(filename => {
      const sourceId = `${group}-${filename}`;
      const fillId = `${sourceId}-fill`;
      const lineId = `${sourceId}-line`;
      const source = map.getSource(sourceId);
      if (!source || !source._data) return;

      const updatedFeatures = source._data.features.map(f => {
        if (!tuaiActive) {
          return { ...f, properties: { ...f.properties, fill: f.properties.originalFill || '#ffffff' } };
        }

        const descText = extractDescriptionText(f);
        const benihMatch = descText.match(/benih\s+([^\s]+)/i);
        const benih = benihMatch ? benihMatch[1].toUpperCase() : null;
        const tarikhMatch = descText.match(/tarikh\s+tanam\s+(\d{1,2}\/\d{1,2}\/\d{4})/i);
        const tarikhStr = tarikhMatch ? tarikhMatch[1] : null;
        const ripeDays = { CL: 100, '269': 104, '467': 110, '297': 110, 'HYBRID': 104 }[benih] || 110;
        let color = '#888';
        if (tarikhStr) {
          const [d, m, y] = tarikhStr.split('/').map(Number);
          const tanamDate = new Date(y, m - 1, d);
          const now = new Date();
          const days = Math.floor((now - tanamDate) / (1000 * 60 * 60 * 24));
          color = getRipenessColor(days, ripeDays);
        }
        return {
          ...f,
          properties: {
            ...f.properties,
            originalFill: f.properties.fill || '#ffffff',
            fill: color
          }
        };
      });
      source.setData({ type: 'FeatureCollection', features: updatedFeatures });
    });
  });
}

const tuaiLegend = document.getElementById('tuaiLegend');
tuaiBtn.addEventListener('click', toggleTuai);

let checkMarkers = [];

function clearCheckMarkers() {
  checkMarkers.forEach(m => m.remove());
  checkMarkers = [];
}

function showCheckmarks(keyword) {
  clearCheckMarkers();
  allFeatures.forEach(f => {
    const rawHTML = f.properties?.description?.value || '';
    const parser = new DOMParser();
    const doc = parser.parseFromString(rawHTML, 'text/html');
    const text = doc.body.textContent.toLowerCase();
    if (text.includes(keyword.toLowerCase())) {
      const center1 = turf.centroid(f).geometry.coordinates;
      const center2 = turf.pointOnFeature(f).geometry.coordinates;
      const center = [(center1[0] + center2[0]) / 2, (center1[1] + center2[1]) / 2 + 0.00005];
      const el = document.createElement('div');
      el.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24">
          <path d="M18.047,4,22,8.325,9.3,20,2,12.68,6.136,8.533,9.474,11.88Z" fill="limegreen" />
          <path d="M18.047,4,22,8.325,9.3,20,2,12.68,6.136,8.533,9.474,11.88Z"
            fill="none" stroke="black" stroke-width="1.5"/>
        </svg>`;
      el.style.transform = 'translate(-50%, -50%)';
      const marker = new maplibregl.Marker(el).setLngLat(center).addTo(map);
      checkMarkers.push(marker);
    }
  });
}

let activeKeyword = null;

function resetAllFilterButtons() {
  bajakBtn.style.color = 'white';
  calitBtn.style.color = 'white';
  racunBtn.style.color = 'white';
}

function handleFilterClick(keyword, button) {
  const isSame = activeKeyword === keyword;
  clearCheckMarkers();
  resetAllFilterButtons();
  if (!isSame) {
    activeKeyword = keyword;
    button.style.color = 'limegreen';
    showCheckmarks(keyword);
  } else {
    activeKeyword = null;
  }
}

bajakBtn.addEventListener('click', () => handleFilterClick('bajak', bajakBtn));
calitBtn.addEventListener('click', () => handleFilterClick('calit', calitBtn));
racunBtn.addEventListener('click', () => handleFilterClick('racun', racunBtn));

setIconColor();

// ===== ADMIN LOGIN (HIDDEN ON LOAD + LOGIN BUTTON) =====
const loginToggleBtn = document.getElementById('loginToggleBtn');
const adminModal = document.getElementById('adminModal');
const adminPanel = document.getElementById('adminPanel');
const loginBtn = document.getElementById('loginBtn');
const logoutBtn = document.getElementById('logoutBtn');
const uploadJsonBtn = document.getElementById('uploadJsonBtn');
const loginError = document.getElementById('loginError');

const ADMIN_USER = 'admin';
const ADMIN_PASS_HASH = '81dc9bdb52d04dc20036dbd8313ed055'; // "1234" hashed (MD5)

// --- Cookie utilities ---
function setCookie(name, value, days) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/`;
}
function getCookie(name) {
  return document.cookie.split('; ').reduce((r, v) => {
    const parts = v.split('=');
    return parts[0] === name ? decodeURIComponent(parts[1]) : r;
  }, '');
}
function deleteCookie(name) {
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
}
function md5(str) {
  return CryptoJS.MD5(str).toString();
}

// --- Update UI based on login state ---
function updateLoginUI() {
  const session = getCookie('admin_session');
  if (session === 'valid_admin_session') {
    adminPanel.style.display = 'block';
    adminModal.style.display = 'none';
    loginToggleBtn.textContent = 'Admin';
  } else {
    adminPanel.style.display = 'none';
    adminModal.style.display = 'none'; // make sure it's hidden by default
    loginToggleBtn.textContent = 'Login';
  }
}

// --- When clicking top-right button ---
loginToggleBtn.addEventListener('click', () => {
  const session = getCookie('admin_session');
  if (session === 'valid_admin_session') {
    // maybe later toggle admin panel visibility
  } else {
    adminModal.style.display = 'flex';
    loginError.textContent = ''; // clear any old error
  }
});

// --- Login attempt ---
loginBtn.addEventListener('click', () => {
  const user = document.getElementById('adminUser').value.trim();
  const pass = document.getElementById('adminPass').value.trim();
  const closeLoginModal = document.getElementById('closeLoginModal');


  if (user === ADMIN_USER && md5(pass) === ADMIN_PASS_HASH) {
    setCookie('admin_session', 'valid_admin_session', 1);
    adminModal.style.display = 'none';
    updateLoginUI();
  } else {
    loginError.textContent = 'Invalid username or password';
  }
});

// --- Close modal when "×" is clicked ---
closeLoginModal.addEventListener('click', () => {
  adminModal.style.display = 'none';
});

// --- Close modal when clicking outside ---
window.addEventListener('click', (e) => {
  if (e.target === adminModal) {
    adminModal.style.display = 'none';
  }
});

// --- Logout ---
logoutBtn.addEventListener('click', () => {
  deleteCookie('admin_session');
  updateLoginUI();
});

// --- Upload placeholder ---
uploadJsonBtn.addEventListener('click', () => {
  alert('Upload JSON coming soon...');
});

// Initialize state on page load
updateLoginUI();

const email = username + "@padi.local";




