// --- MAP INITIALIZATION ---
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

// Limit map bounds
map.setMaxBounds([[102.66830, 2.21776], [102.69816, 2.25551]]);
const boundsPolygon = turf.bboxPolygon([102.66830, 2.21776, 102.69816, 2.25551]);

// --- GPS VARIABLES ---
let gpsMode = 1, watchId = null, marker = null;
const iconImg = document.getElementById('gpsIconImg');
const gpsMsg = document.getElementById('gpsMessage');

// --- GPS FUNCTIONS ---
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

// --- GPS BUTTON ---
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

// Disable GPS mode on drag/touch
map.on('dragstart', stopGPS);
map.on('touchstart', stopGPS);
function stopGPS() {
  if (gpsMode !== 1) {
    gpsMode = 1;
    setIconColor();
    if (watchId) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    window.removeEventListener('deviceorientation', rotateMap);
  }
}

// --- POLYGON DATA GROUPS ---
const groups = {
  sawahring: 'sawahring.json',
  blok: ['blok1.json']
};

let blokNumberMarkers = [];
let blokNameMarkers = [];
let allFeatures = [];

// --- LABEL VISIBILITY BASED ON ZOOM ---
function updateLabelVisibility() {
  const zoom = map.getZoom();
  const opacityNum = zoom >= 14.5 ? 0 : 1;
  const opacityName = zoom >= 16.2 ? 1 : 0;

  blokNumberMarkers.forEach(m => m.getElement().style.opacity = opacityNum);
  blokNameMarkers.forEach(m => m.getElement().style.opacity = opacityName);
}

map.on('zoom', updateLabelVisibility);

// --- MAP LOAD ---
map.on('load', async () => {
  await loadGroup('sawahring', ['sawahring.json']);
  await loadGroup('blok', ['blok1.json']);
  showBlokNumbers();
  showBlokNames();
  updateLabelVisibility();
});

// --- LOAD GEOJSON GROUPS ---
async function loadGroup(group, files) {
  for (const filename of files) {
    const response = await fetch(filename);
    const data = await response.json();
    const sourceId = `${group}-${filename}`;

    data.features.forEach((f, i) => {
      f.properties._id = `${group}-${filename}-${i}`;
      if (group === 'sawahring') {
        const name = f.properties?.name || '';
        const match = name.toLowerCase().match(/blok\s+(\d+)/);
        if (match) f.properties.blok_no = match[1];
      }
    });

    allFeatures.push(...data.features);
    map.addSource(sourceId, { type: 'geojson', data });

    const baseOpacity = group === 'sawahring' ? 0.4 : 0;

    // Fill Layer
    map.addLayer({
      id: `${sourceId}-fill`,
      type: 'fill',
      source: sourceId,
      paint: {
        'fill-color': ['get', 'fill'],
        'fill-opacity': [
          'interpolate', ['linear'], ['zoom'],
          13, baseOpacity, 14, baseOpacity,
          15, 0.2, 16, 0.4
        ]
      }
    });

    // Line Layer
    map.addLayer({
      id: `${sourceId}-line`,
      type: 'line',
      source: sourceId,
      paint: {
        'line-color': '#004d26',
        'line-width': 1,
        'line-opacity': 1
      }
    });

    // Highlight Layer
    map.addLayer({
      id: `${sourceId}-highlight`,
      type: 'line',
      source: sourceId,
      paint: { 'line-color': '#ffcc00', 'line-width': 4 },
      filter: ['==', '_id', '']
    });

    // Click highlight logic
    map.on('click', `${sourceId}-fill`, e => {
      const zoom = map.getZoom();
      const f = e.features[0];
      if ((group === 'blok' && zoom >= 15) ||
          (group === 'sawahring' && zoom < 15)) highlightFeature(f);
    });
  }
}

// --- SHOW LABELS ---
function showBlokNumbers() {
  blokNumberMarkers.forEach(m => m.remove());
  blokNumberMarkers = [];

  allFeatures.forEach(f => {
    if (!f.properties._id.startsWith('sawahring')) return;
    const num = f.properties.blok_no;
    if (!num) return;
    const center = turf.centroid(f).geometry.coordinates;
    const el = document.createElement('div');
    el.textContent = `B${num}`;
    Object.assign(el.style, {
      fontSize: '13px', color: 'white', fontWeight: 'bold',
      textShadow: '1px 1px 2px black', transform: 'translate(-50%, -50%)'
    });
    blokNumberMarkers.push(new maplibregl.Marker(el).setLngLat(center).addTo(map));
  });
}

function showBlokNames() {
  blokNameMarkers.forEach(m => m.remove());
  blokNameMarkers = [];

  allFeatures.forEach(f => {
    if (!f.properties._id.startsWith('blok')) return;
    const center = turf.centroid(f).geometry.coordinates;
    const rawHTML = f.properties?.description?.value || '';
    const parser = new DOMParser();
    const doc = parser.parseFromString(rawHTML, 'text/html');
    const text = doc.body.textContent.toLowerCase();
    const benihMatch = text.match(/benih\s+(.+?)(?=\s+tarikh|$)/i);
    const benih = benihMatch ? benihMatch[1].trim().toUpperCase() : '';

    const el = document.createElement('div');
    el.innerHTML = `<div style="text-align:center;">
        <div style="font-weight:bold;">${f.properties.name}</div>
        <div>${benih}</div></div>`;
    Object.assign(el.style, {
      fontSize: '10px', color: 'white',
      textShadow: '1px 1px 2px black', transform: 'translate(-50%, -50%)'
    });
    blokNameMarkers.push(new maplibregl.Marker(el).setLngLat(center).addTo(map));
  });
}

// --- POPUP HIGHLIGHT ---
function highlightFeature(f) {
  Object.entries(groups).forEach(([g, files]) => {
    (Array.isArray(files) ? files : [files]).forEach(file => {
      const id = `${g}-${file}`;
      map.setFilter(`${id}-highlight`,
        f.properties._id.startsWith(id) ? ['==', '_id', f.properties._id] : ['==', '_id', '']);
    });
  });

  document.querySelectorAll('.maplibregl-popup').forEach(p => p.remove());

  const center = turf.centroid(f).geometry.coordinates;
  const areaEkar = (turf.area(f) / 4046.86).toFixed(2);
  const areaHek = (turf.area(f) * 0.405 / 4046.86).toFixed(2);

  let html = `<strong>${f.properties.name}</strong><br>${areaEkar} ekar atau ${areaHek} hektar`;

  const desc = f.properties?.description?.value || '';
  if (/benih/i.test(desc)) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(desc, 'text/html');
    const text = doc.body.textContent.toLowerCase();
    const tarikhMatch = text.match(/tarikh tanam\s+(\d{1,2}\/\d{1,2}\/\d{4})/);
    const tarikh = tarikhMatch ? tarikhMatch[1] : null;
    const days = tarikh ? Math.floor((new Date() - new Date(tarikh.split('/').reverse().join('-'))) / 86400000) : null;
    html += tarikh ? `<br>Tarikh tanam: ${tarikh}<br>Usia: ${days} hari` : '';
  }

  new maplibregl.Popup({ closeButton: false })
    .setLngLat(center).setHTML(html).addTo(map)
    .getElement().classList.add('popup-no-x');
}

// Clear highlight on empty click
map.on('click', e => {
  const features = map.queryRenderedFeatures(e.point);
  if (features.length === 0) {
    Object.entries(groups).forEach(([g, files]) => {
      (Array.isArray(files) ? files : [files])
        .forEach(f => map.setFilter(`${g}-${f}-highlight`, ['==', '_id', '']));
    });
    document.querySelectorAll('.maplibregl-popup').forEach(p => p.remove());
  }
});

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
  container.classList.add('active'); input.focus();
});
document.getElementById('closeBtn').addEventListener('click', () => {
  container.classList.remove('active');
  input.value = ''; suggestions.innerHTML = '';
});
map.getCanvas().addEventListener('click', () => {
  container.classList.remove('active');
  input.value = ''; suggestions.innerHTML = '';
});

// --- FILTERS + TUAI BUTTON ---
const filterContainer = document.createElement('div');
Object.assign(filterContainer.style, {
  position: 'absolute', top: '100px', right: '15px',
  display: 'flex', flexDirection: 'column', gap: '8px', zIndex: 1004
});
document.body.appendChild(filterContainer);

function createFilterButton(label) {
  const b = document.createElement('button');
  Object.assign(b.style, {
    width: '50px', height: '50px', borderRadius: '50%',
    background: '#333', color: 'white', border: 'none',
    cursor: 'pointer', fontSize: '12px'
  });
  b.textContent = label;
  return b;
}
const bajakBtn = createFilterButton('Bajak');
const calitBtn = createFilterButton('Calit');
const racunBtn = createFilterButton('Racun');
const tuaiBtn = createFilterButton('Tuai');
filterContainer.append(bajakBtn, calitBtn, racunBtn);
document.body.appendChild(tuaiBtn);

let checkMarkers = [];
function clearCheckMarkers() { checkMarkers.forEach(m => m.remove()); checkMarkers = []; }

function showCheckmarks(keyword) {
  clearCheckMarkers();
  allFeatures.forEach(f => {
    const desc = (f.properties?.description?.value || '').toLowerCase();
    if (!desc.includes(keyword.toLowerCase())) return;
    const center = turf.centroid(f).geometry.coordinates;
    const el = document.createElement('div');
    el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24">
      <path d="M18.047,4,22,8.325,9.3,20,2,12.68,6.136,8.533,9.474,11.88Z"
        fill="limegreen" stroke="black" stroke-width="1.5"/></svg>`;
    el.style.transform = 'translate(-50%, -50%)';
    checkMarkers.push(new maplibregl.Marker(el).setLngLat(center).addTo(map));
  });
}

let activeKeyword = null;
function handleFilterClick(keyword, btn) {
  const same = activeKeyword === keyword;
  clearCheckMarkers(); resetAllFilterButtons();
  if (!same) {
    activeKeyword = keyword;
    btn.style.color = 'limegreen';
    showCheckmarks(keyword);
  } else activeKeyword = null;
}
bajakBtn.onclick = () => handleFilterClick('bajak', bajakBtn);
calitBtn.onclick = () => handleFilterClick('calit', calitBtn);
racunBtn.onclick = () => handleFilterClick('racun', racunBtn);
function resetAllFilterButtons() {
  [bajakBtn, calitBtn, racunBtn].forEach(b => b.style.color = 'white');
}

// --- TUAI COLOR LOGIC ---
const tuaiLegend = document.getElementById('tuaiLegend');
let tuaiActive = false;
tuaiBtn.onclick = () => {
  tuaiActive = !tuaiActive;
  tuaiBtn.style.color = tuaiActive ? 'limegreen' : 'white';
  tuaiLegend.style.display = tuaiActive ? 'block' : 'none';
  applyTuaiColors();
};

function getRipenessColor(days, ripeDays) {
  if (days < 0) return '#999';
  if (days < ripeDays) return '#00cc00';
  if (days < ripeDays + 10) return '#b5a300';
  return '#802600';
}

function applyTuaiColors() {
  Object.entries(groups).forEach(([group, files]) => {
    (Array.isArray(files) ? files : [files]).forEach(filename => {
      const srcId = `${group}-${filename}`;
      const src = map.getSource(srcId);
      if (!src || !src._data) return;

      const updated = src._data.features.map(f => {
        const html = f.properties?.description?.value || '';
        const matchBenih = html.match(/benih\s+([A-Za-z0-9]+)/i);
        const benih = matchBenih ? matchBenih[1].toUpperCase() : '';
        const ripeMap = { CL: 100, 269: 104, 467: 110, 297: 110, HYBRID: 104 };
        const ripeDays = ripeMap[benih] || 110;
        const tarikh = html.match(/tarikh\s+tanam\s+(\d{1,2}\/\d{1,2}\/\d{4})/i);
        let color = f.properties.originalFill || '#888';
        if (tarikh) {
          const [d, m, y] = tarikh[1].split('/').map(Number);
          const days = Math.floor((new Date() - new Date(y, m - 1, d)) / 86400000);
          color = getRipenessColor(days, ripeDays);
        }
        return {
          ...f, properties: { ...f.properties, fill: color }
        };
      });
      src.setData({ type: 'FeatureCollection', features: updated });
    });
  });
}

setIconColor();

