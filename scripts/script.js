document.addEventListener('DOMContentLoaded', () => {

// ========== MAP INITIALIZATION ==========
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
const boundsPolygon = turf.bboxPolygon([102.66830, 2.21776, 102.69816, 2.25551]);
map.setMaxBounds([[102.66830, 2.21776], [102.69816, 2.25551]]);

// ========== GPS MODE ==========
let gpsMode = 1, watchId = null, marker = null;
const gpsIcon = document.getElementById('gpsIconImg');
const gpsMsg = document.getElementById('gpsMessage');

function setIconColor() {
  gpsIcon.style.filter =
    gpsMode === 1 ? 'invert(100%)' :
    gpsMode === 2 ? 'invert(67%) sepia(92%) saturate(455%) hue-rotate(81deg)' :
                    'invert(45%) sepia(100%) saturate(3000%) hue-rotate(5deg)';
}

function showGPSMessage() {
  gpsMsg.style.display = 'block';
  setTimeout(() => gpsMsg.style.display = 'none', 3000);
}

function createGPSMarker(lng, lat) {
  const el = document.createElement('div');
  el.className = 'gps-marker';
  el.innerHTML = '<div class="triangle"></div><div class="circle"></div>';
  marker = new maplibregl.Marker(el).setLngLat([lng, lat]).addTo(map);
}

function updateGPSMarker(lng, lat) {
  if (marker) marker.setLngLat([lng, lat]);
  else createGPSMarker(lng, lat);
  if (gpsMode === 3) map.setCenter([lng, lat]);
}

function rotateMap(event) {
  if (gpsMode !== 3) return;
  const heading = event.webkitCompassHeading ?? (360 - event.alpha);
  if (!isNaN(heading)) map.rotateTo(heading, { duration: 100 });
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

// GPS toggle button
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
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
      return;
    }
    updateGPSMarker(lng, lat);
    if (gpsMode === 2) map.setCenter([lng, lat]);
  }, null, { enableHighAccuracy: true });

  if (gpsMode === 3) handleOrientation();
});

// Reset GPS on user map interaction
['dragstart', 'touchstart'].forEach(evt =>
  map.on(evt, () => {
    if (gpsMode !== 1) {
      gpsMode = 1;
      setIconColor();
      if (watchId) navigator.geolocation.clearWatch(watchId);
      window.removeEventListener('deviceorientation', rotateMap);
    }
  })
);

// ========== DATA & LABELS ==========
const groups = {
  sawahring: 'sawahring.json',
  blok: ['blok1.json']
};

let allFeatures = [];
let blokNumberMarkers = [];
let blokNameMarkers = [];

// Load and render polygons
map.on('load', async () => {
  await loadGroup('sawahring', ['sawahring.json']);
  await loadGroup('blok', ['blok1.json']);
  showBlokNumbers();
  showBlokNames();
  updateLabelVisibility();
});

async function loadGroup(group, files) {
  for (const filename of files) {
    const res = await fetch(filename);
    const data = await res.json();
    const sourceId = `${group}-${filename}`;

    data.features.forEach((f, i) => {
      f.properties._id = `${group}-${filename}-${i}`;
      if (group === 'sawahring') {
        const match = f.properties.name?.match(/blok\s+(\d+)/i);
        if (match) f.properties.blok_no = match[1];
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
          16, group === 'sawahring' ? 0 : 0.4
        ]
      }
    });

    map.addLayer({
      id: `${sourceId}-line`,
      type: 'line',
      source: sourceId,
      paint: { 'line-color': '#004d26', 'line-width': 1 }
    });

    map.addLayer({
      id: `${sourceId}-highlight`,
      type: 'line',
      source: sourceId,
      paint: { 'line-color': '#ffcc00', 'line-width': 4 },
      filter: ['==', '_id', '']
    });

    // Click feature
    map.on('click', `${sourceId}-fill`, e => highlightFeature(e.features[0]));
  }
}

function updateLabelVisibility() {
  const zoom = map.getZoom();
  const showBlokNames = zoom >= 15;
  blokNumberMarkers.forEach(m => m.getElement().style.opacity = showBlokNames ? 0 : 1);
  blokNameMarkers.forEach(m => m.getElement().style.opacity = showBlokNames ? 1 : 0);
}
map.on('zoom', updateLabelVisibility);

// BLOK label markers
function showBlokNumbers() {
  blokNumberMarkers.forEach(m => m.remove());
  blokNumberMarkers = [];
  allFeatures.filter(f => f.properties.blok_no).forEach(f => {
    const center = turf.centroid(f).geometry.coordinates;
    const el = document.createElement('div');
    el.textContent = `B${f.properties.blok_no}`;
    el.style.cssText = 'font-size:13px;color:white;font-weight:bold;text-shadow:1px 1px 2px black;pointer-events:none;transform:translate(-50%,-50%)';
    blokNumberMarkers.push(new maplibregl.Marker(el).setLngLat(center).addTo(map));
  });
}

function showBlokNames() {
  blokNameMarkers.forEach(m => m.remove());
  blokNameMarkers = [];
  allFeatures.filter(f => f.properties._id.startsWith('blok')).forEach(f => {
    const center = turf.centroid(f).geometry.coordinates;
    const raw = f.properties.description?.value || '';
    const benihMatch = raw.toLowerCase().match(/benih\s+(.+?)(?=\s+tarikh|$)/i);
    const benih = benihMatch ? benihMatch[1].toUpperCase() : '';
    const el = document.createElement('div');
    el.innerHTML = `<div style="text-align:center;line-height:1.1"><b>${f.properties.name}</b><br>${benih}</div>`;
    el.style.cssText = 'font-size:10px;color:white;text-shadow:1px 1px 2px black;pointer-events:none;transform:translate(-50%,-50%)';
    blokNameMarkers.push(new maplibregl.Marker(el).setLngLat(center).addTo(map));
  });
}

// ========== POPUP & HIGHLIGHT ==========
function highlightFeature(f) {
  Object.entries(groups).forEach(([g, files]) => {
    (Array.isArray(files) ? files : [files]).forEach(file =>
      map.setFilter(`${g}-${file}-highlight`, f.properties._id.includes(file) ? ['==', '_id', f.properties._id] : ['==', '_id', ''])
    );
  });

  document.querySelectorAll('.maplibregl-popup').forEach(p => p.remove());
  gpsMode = 1; setIconColor();

  const center = turf.centroid(f).geometry.coordinates;
  const area = (turf.area(f) / 4046.86).toFixed(2);
  const benih = (f.properties.description?.value || '').match(/benih\s+([^\s]+)/i)?.[1]?.toUpperCase() || 'Tiada info';
  const tarikh = (f.properties.description?.value || '').match(/tarikh\s+tanam\s+(\d{1,2}\/\d{1,2}\/\d{4})/i)?.[1] || '-';

  const popupHTML = `<strong>${f.properties.name}</strong><br>${area} ekar<br>Benih: ${benih}<br>Tarikh tanam: ${tarikh}`;
  new maplibregl.Popup({ closeButton: false }).setLngLat(center).setHTML(popupHTML).addTo(map).getElement().classList.add('popup-no-x');
}

// Click outside clears highlight
map.on('click', e => {
  const f = map.queryRenderedFeatures(e.point);
  if (!f.length) {
    Object.entries(groups).forEach(([g, files]) => {
      (Array.isArray(files) ? files : [files]).forEach(file =>
        map.setFilter(`${g}-${file}-highlight`, ['==', '_id', ''])
      );
    });
    document.querySelectorAll('.maplibregl-popup').forEach(p => p.remove());
  }
});

// ========== SEARCH ==========
const searchInput = document.getElementById('searchInput');
const searchContainer = document.getElementById('searchContainer');
const suggestions = document.getElementById('suggestions');
const searchBtn = document.getElementById('searchBtn');
const closeBtn = document.getElementById('closeBtn');

searchInput.addEventListener('input', () => {
  const q = searchInput.value.trim().toLowerCase();
  suggestions.innerHTML = '';
  if (!q) return;
  allFeatures.filter(f => f.properties.name?.toLowerCase().includes(q)).forEach(f => {
    const div = document.createElement('div');
    div.textContent = f.properties.name;
    div.onclick = () => {
      searchInput.value = '';
      searchContainer.classList.remove('active');
      suggestions.innerHTML = '';
      highlightFeature(f);
    };
    suggestions.appendChild(div);
  });
});

searchBtn.onclick = () => { searchContainer.classList.add('active'); searchInput.focus(); };
closeBtn.onclick = () => { searchContainer.classList.remove('active'); searchInput.value = ''; suggestions.innerHTML = ''; };
map.getCanvas().addEventListener('click', () => searchContainer.classList.remove('active'));

// ========== FILTERS ==========
const filterContainer = document.createElement('div');
filterContainer.style.cssText = 'position:absolute;top:100px;right:15px;display:flex;flex-direction:column;gap:8px;z-index:1004';
document.body.appendChild(filterContainer);

function createFilterButton(label) {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.style.cssText = 'width:50px;height:50px;border-radius:50%;border:none;background:#333;color:white;font-size:12px;cursor:pointer';
  filterContainer.appendChild(btn);
  return btn;
}

const bajakBtn = createFilterButton('Bajak');
const calitBtn = createFilterButton('Calit');
const racunBtn = createFilterButton('Racun');

let activeFilter = null;
function resetFilterButtons() {
  [bajakBtn, calitBtn, racunBtn].forEach(b => b.style.color = 'white');
}
function showCheckmarks(keyword) {
  clearCheckmarks();
  allFeatures.forEach(f => {
    const desc = (f.properties.description?.value || '').toLowerCase();
    if (desc.includes(keyword)) {
      const center = turf.centroid(f).geometry.coordinates;
      const el = document.createElement('div');
      el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
        <path d="M18.047,4,22,8.325,9.3,20,2,12.68,6.136,8.533,9.474,11.88Z"
        fill="limegreen" stroke="black" stroke-width="1.5"/>
      </svg>`;
      el.style.transform = 'translate(-50%,-50%)';
      new maplibregl.Marker(el).setLngLat(center).addTo(map);
      checkMarkers.push(el);
    }
  });
}
let checkMarkers = [];
function clearCheckmarks() {
  document.querySelectorAll('svg').forEach(e => e.remove());
  checkMarkers = [];
}
function attachFilter(btn, keyword) {
  btn.onclick = () => {
    const isActive = activeFilter === keyword;
    resetFilterButtons(); clearCheckmarks();
    if (!isActive) {
      activeFilter = keyword;
      btn.style.color = 'limegreen';
      showCheckmarks(keyword);
    } else activeFilter = null;
  };
}
attachFilter(bajakBtn, 'bajak');
attachFilter(calitBtn, 'calit');
attachFilter(racunBtn, 'racun');

// ========== TUAI BUTTON ==========
const tuaiBtn = document.createElement('button');
tuaiBtn.textContent = 'Tuai';
tuaiBtn.style.cssText = 'position:fixed;bottom:35px;left:15px;width:50px;height:50px;border-radius:50%;border:none;background:#333;color:white;font-size:12px;cursor:pointer;z-index:1001';
document.body.appendChild(tuaiBtn);
const tuaiLegend = document.getElementById('tuaiLegend');

let tuaiActive = false;
tuaiBtn.onclick = () => {
  tuaiActive = !tuaiActive;
  tuaiBtn.style.color = tuaiActive ? 'limegreen' : 'white';
  tuaiLegend.style.display = tuaiActive ? 'block' : 'none';
  Object.entries(groups).forEach(([g, files]) => {
    (Array.isArray(files) ? files : [files]).forEach(file => {
      const src = map.getSource(`${g}-${file}`);
      if (!src || !src._data) return;
      const updated = src._data.features.map(f => {
        if (!tuaiActive) return { ...f, properties: { ...f.properties, fill: f.properties.originalFill || '#fff' } };
        const raw = (f.properties.description?.value || '').toLowerCase();
        const benih = raw.match(/benih\s+([^\s]+)/i)?.[1]?.toUpperCase() || '';
        const tarikh = raw.match(/tarikh\s+tanam\s+(\d{1,2}\/\d{1,2}\/\d{4})/i)?.[1];
        const ripeDays = { CL: 100, '269': 120, HYBRID: 110 }[benih] || 110;
        let color = '#888';
        if (tarikh) {
          const [d,m,y] = tarikh.split('/').map(Number);
          const days = (new Date() - new Date(y,m-1,d)) / 86400000;
          color = days < ripeDays ? '#00cc00' : days < ripeDays+10 ? '#ffd700' : '#802600';
        }
        return { ...f, properties: { ...f.properties, originalFill: f.properties.fill, fill: color } };
      });
      src.setData({ type: 'FeatureCollection', features: updated });
    });
  });
};

setIconColor();

}); // DOM ready end
