// =====================================================================
// app.js — Main Application
// 
// JS calls GET /api/positions?lat=X&lon=Y
// The server runs SGP4 in Python, passes result to C++ 
// and returns only the filtered satellite positions.
//
// Only handles rendering
// =====================================================================

Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJmMjFlODNmMi04Njc5LTRkYWYtYjY2MS01ZTY5NWI4ODZiNDYiLCJpZCI6Mzk4NDEwLCJpYXQiOjE3NzI2OTA4MTV9.u6hd3Ctfcx0zerpizKuLsALR2m7q0B1lXYNYlyUc5KI';

// ==========================================
// GLOBALS
// ==========================================
window.userLocation = { lon: -123.50, lat: 48.45 };
const orbitalViewHeight = 20000000;
const MAX_SATS = 5000;

if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
        (pos) => { window.userLocation = { lon: pos.coords.longitude, lat: pos.coords.latitude }; },
        () => console.warn("Location denied. Using Langford fallback.")
    );
}

// ==========================================
// CESIUM VIEWER
// ==========================================
const viewer = new Cesium.Viewer('cesiumContainer', {
    baseLayerPicker: false, geocoder: false, homeButton: false,
    sceneModePicker: false, navigationHelpButton: false,
    timeline: false, animation: false, fullscreenButton: false, infoBox: false
});

// Globe styling
viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#050505');
viewer.scene.globe.enableLighting = true;
viewer.scene.globe.depthTestAgainstTerrain = true;

// Atmosphere
viewer.scene.skyAtmosphere.hueShift = -0.4;
viewer.scene.skyAtmosphere.brightnessShift = 0.2;
viewer.scene.skyAtmosphere.saturationShift = 0.5;

// Smooth camera panning
viewer.scene.screenSpaceCameraController.enableCollisionDetection = false;
viewer.scene.screenSpaceCameraController.minimumZoomDistance = 50;
viewer.scene.screenSpaceCameraController.maximumZoomDistance = 40000000;

// 3D Terrain (async — won't block page load)
Cesium.createWorldTerrainAsync({ requestWaterMask: true, requestVertexNormals: true })
    .then(t => { viewer.terrainProvider = t; console.log("3D Terrain online."); })
    .catch(e => console.warn("Terrain failed:", e));

// 3D Buildings (async — loaded ONCE)
Cesium.createOsmBuildingsAsync()
    .then(b => { viewer.scene.primitives.add(b); console.log("3D Cities online."); })
    .catch(e => console.warn("Buildings failed:", e));

// Start camera
viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(window.userLocation.lon, window.userLocation.lat, orbitalViewHeight),
    duration: 0
});


// ==========================================
// SVG MARKERS
// ==========================================
function createSatMarker(color) {
    const svg = `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
        <path d="M2 8 L2 2 L8 2 M24 2 L30 2 L30 8 M30 24 L30 30 L24 30 M8 30 L2 30 L2 24"
              fill="none" stroke="${color}" stroke-width="1.5" opacity="0.6"/>
        <polygon points="16,7 25,16 16,25 7,16"
                 fill="${color}" fill-opacity="0.25" stroke="${color}" stroke-width="1"/>
        <circle cx="16" cy="16" r="2" fill="${color}" opacity="0.9"/>
    </svg>`;
    return 'data:image/svg+xml;base64,' + btoa(svg);
}

function createAnomalyMarker() {
    const svg = `<svg width="36" height="36" viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg">
        <path d="M2 9 L2 2 L9 2 M27 2 L34 2 L34 9 M34 27 L34 34 L27 34 M9 34 L2 34 L2 27"
              fill="none" stroke="#ff0000" stroke-width="2" opacity="0.8"/>
        <polygon points="18,6 30,18 18,30 6,18"
                 fill="#ff0000" fill-opacity="0.2" stroke="#ff0000" stroke-width="1.5"/>
        <circle cx="18" cy="18" r="3" fill="#ff0000" opacity="0.9"/>
        <circle cx="18" cy="18" r="6" fill="none" stroke="#ff0000" stroke-width="0.5" opacity="0.5"/>
    </svg>`;
    return 'data:image/svg+xml;base64,' + btoa(svg);
}

function createAircraftMarker(color) {
    const svg = `
    <svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
        <path d="M16 2 L19 10 L30 16 L19 18 L17 26 L21 30 L11 30 L15 26 L13 18 L2 16 L13 10 Z" 
              fill="${color}" fill-opacity="0.5" stroke="${color}" stroke-width="1.5"/>
        <circle cx="16" cy="14" r="2" fill="#ffffff"/>
    </svg>`;
    return 'data:image/svg+xml;base64,' + btoa(svg);
}

const aircraftTexture = createAircraftMarker('#ff9900');
const ANOMALY_MARKER = createAnomalyMarker();

function createTacticalMarker(color) {
    const svg = `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <polygon points="12,2 22,12 12,22 2,12" fill="${color}" fill-opacity="0.3" stroke="${color}" stroke-width="1.5"/>
        <circle cx="12" cy="12" r="3" fill="${color}" opacity="0.9"/>
    </svg>`;
    return 'data:image/svg+xml;base64,' + btoa(svg);
}

const glowTextures = {
    LEO: createTacticalMarker('#ff3333'),
    MEO: createTacticalMarker('#ffcc00'),
    GEO: createTacticalMarker('#00e6e6'),
    HEO: createTacticalMarker('#b366ff')
};

const DOT_SIZES = { LEO: 20, MEO: 24, GEO: 28, HEO: 30 };


// ==========================================
// DATA STORES
// ==========================================
const billboards = viewer.scene.primitives.add(new Cesium.BillboardCollection());

// satIndex: norad_id -> { sat, billboard }
//
//   When the server returns position updates, we need to find the matching
//   billboard for each satellite. Array.find() is O(N) per lookup = O(N²)
//   total for 5,000 sats. A Map gives O(1) lookup — O(N) total.
const satIndex = new Map();

let allSatellites = []; // Full satellite metadata List (search/filter)
let satBillboards = []; // Array of {sat, billboard} for iteration
let currentFilter = 'all';

// ==========================================
// MAIN: LOAD SATELLITES
//
// Load: Fetch pre-computed positions from the server
// ==========================================
async function loadSatellites() {
    try {
        document.getElementById('loading').textContent = 'Fetching Orbital Positions';
        console.log('Requesting SGP4 Positions');
        
        // Single endpoint call: server runs SGP4 + ML + optional C++ filter,
        // returns a JSON payload. 
        const response = await fetch('http://localhost:5000/api/positions');
        if (!response.ok) throw new Error('Backend error: ' + response.status);

        const data = await response.json();
        const positions = data.positions;
        console.log(`Received ${positions.length} pre-computed satellite positions`);

        const counts = { LEO: 0, MEO: 0, GEO: 0, HEO: 0 };

        positions.forEach(sat => {
            const orbitType = sat.orbit_type;
            counts[orbitType] = (counts[orbitType] || 0) + 1;

            // Need to adapt response to shape app expects 
            const satRecord = {
                // Identity
                name:        sat.name,
                norad_id:    sat.norad_id,
                // Current position — updated every poll cycle
                position: {
                    latitude:  sat.lat,
                    longitude: sat.lon,
                    altitude:  sat.alt,
                    velocity:  sat.velocity,
                },
                // Orbital classification 
                orbitType:   orbitType,
                // Orbital parameters 
                inclination:  sat.inclination,
                eccentricity: sat.eccentricity,
                meanMotion:   sat.mean_motion,
                bstar:        sat.bstar,
                // Flags
                isRocketLab: sat.is_rocket_lab,
                isAnomaly:   sat.is_anomaly,
                anomalyData: sat.anomaly_data,
                // satrec stub — reference is for beams.js
                satrec: { satnum: sat.norad_id },
            };

            const billboard = billboards.add({
                position: Cesium.Cartesian3.fromDegrees(sat.lon, sat.lat, sat.alt * 1000),
                image:    glowTextures[orbitType],
                width:    DOT_SIZES[orbitType],
                height:   DOT_SIZES[orbitType],
                translucencyByDistance: new Cesium.NearFarScalar(2000000, 1.0, 300000000, 0.4),
                scaleByDistance:        new Cesium.NearFarScalar(1000000, 1.0, 100000000, 0.3),
                disableDepthTestDistance: 0,
                id: satRecord
            });

            const entry = { sat: satRecord, billboard };
            satBillboards.push(entry);
            satIndex.set(sat.norad_id, entry);  // O(1) future lookups
        });

        allSatellites = satBillboards.map(e => e.sat);

        // UI
        document.getElementById('loading').style.display = 'none';
        document.getElementById('controlPanel').style.display = 'block';
        document.getElementById('legend').style.display = 'block';
        updateStats(positions.length, counts);

        const label = document.getElementById('satCountLabel');
        if (label) label.textContent = 'TRACKING: ' + positions.length + ' OBJECTS';

        // Update ML status from the merged anomaly data
        const anomalyCount = positions.filter(p => p.is_anomaly).length;
        const mlEl = document.getElementById('mlStatus');
        if (mlEl) {
            mlEl.textContent = anomalyCount > 0 ? 'ML: ' + anomalyCount + ' ANOMALIES' : 'ML: CLEAN';
            if (anomalyCount > 0) mlEl.style.color = '#ff3333';
        }
        if (window.logTacticalEvent) {
            window.logTacticalEvent('ML PIPELINE: ' + anomalyCount + ' anomalies isolated.', anomalyCount > 0);
        }

        setupClickHandler();
        setupSearch();
        setupFilters();
        startPositionPolling();  

        if (typeof initRadarSystem === 'function') initRadarSystem(viewer);

    } catch (error) {
        console.error('Load failed:', error);
        document.getElementById('loading').textContent = 'Error: ' + error.message;
    }
}


// ==========================================
// POSITION POLLING 
//
//   Our position data has 2-second server-side resolution.
//   polling at 60fps for data that changes every 2s
//   is wasteful. setInterval(2000) matches the server's cache TTL exactly.
//   Cesium still renders at 60fps using the billboard positions we set here;
//   only the position DATA update rate is 2 seconds.
// ==========================================
function startPositionPolling() {
    // Immediately schedule the first update, then continue every 2s
    pollPositions();
    setInterval(pollPositions, 2000);
}

async function pollPositions() {
    try {
        // Build the URL: include grid coordinates if a grid is active
        // so the server applies C++ spatial filtering before responding
        let url = 'http://localhost:5000/api/positions';
        if (window.activeGrid) {
            url += `?lat=${window.activeGrid.lat}&lon=${window.activeGrid.lon}`;
        }

        const response = await fetch(url);
        if (!response.ok) return;  // Old positions stay visible

        const data = await response.json();

        // APPLY THE GRID FILTER to billboard visibility.
        // We've already calculated what should be seen.
        if (window.activeGrid) {
            // Build a Set of the returned norad_ids for O(1) lookup
            const visibleIds = new Set(data.positions.map(p => p.norad_id));
            satBillboards.forEach(entry => {
                entry.billboard.show = visibleIds.has(entry.sat.norad_id);
            });
        }

        // Update billboard positions for the returned satellites
        data.positions.forEach(pos => {
            // O(1) Map lookup
            const entry = satIndex.get(pos.norad_id);
            if (!entry) return;

            // Update the billboard's 3D position in Cesium's scene graph
            entry.billboard.position = Cesium.Cartesian3.fromDegrees(
                pos.lon, pos.lat, pos.alt * 1000
            );

            // Keep the satellite record in sync
            entry.sat.position.latitude  = pos.lat;
            entry.sat.position.longitude = pos.lon;
            entry.sat.position.altitude  = pos.alt;
            entry.sat.position.velocity  = pos.velocity;
        });

        // Live beam refresh 
        const beamBtn = document.getElementById('beamToggle');
        if (beamBtn && beamBtn.textContent === 'HIDE BEAMS') {
            showBeamsForGroup();
        }

    } catch (e) {
        console.warn('[POLL] Position update failed:', e.message); // Catch error and just keep old positions
    }
}


// ==========================================
// FILTER SYSTEM
// ==========================================
function setupFilters() {
    document.querySelectorAll('.filter-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.dataset.filter;
            if (currentFilter) applyFilter(currentFilter);
        });
    });
}

function applyFilter(filter) {
    let visibleCount = 0;
    const counts = { LEO: 0, MEO: 0, GEO: 0, HEO: 0 };

    satBillboards.forEach(function (entry) {
        const sat = entry.sat;
        let show = false;
        if (filter === 'all')       show = true;
        else if (filter === 'rocketlab') show = sat.isRocketLab;
        else if (filter === 'anomaly')   show = (sat.isAnomaly === true);
        else                             show = (sat.orbitType === filter);

        if (filter === 'anomaly' && sat.isAnomaly) {
            entry.billboard.image = ANOMALY_MARKER;
            entry.billboard.scale = 1.3;
        } else {
            entry.billboard.image = glowTextures[sat.orbitType];
            entry.billboard.scale = 1.0;
        }

        entry.billboard.show = show;
        if (show) { visibleCount++; counts[sat.orbitType]++; }
    });

    if (filter === 'anomaly') {
        viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#020202');
        viewer.scene.skyAtmosphere.brightnessShift = -0.5;
    } else {
        viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#050505');
        viewer.scene.skyAtmosphere.brightnessShift = 0.2;
    }

    updateStats(visibleCount, counts);
    clearBeams();

    const beamBtn = document.getElementById('beamToggle');
    beamBtn.style.display = (filter !== 'all') ? 'inline-block' : 'none';
    beamBtn.textContent = 'SHOW BEAMS';
}

function updateStats(total, counts) {
    const el = document.getElementById('stats');
    el.style.display = 'block';
    el.innerHTML =
        'VIS: <span>' + total + '</span>' +
        ' // LEO: <span>' + (counts.LEO||0) + '</span>' +
        ' // MEO: <span>' + (counts.MEO||0) + '</span>' +
        ' // GEO: <span>' + (counts.GEO||0) + '</span>' +
        ' // HEO: <span>' + (counts.HEO||0) + '</span>';
}


// ==========================================
// CLICK HANDLER 
// ==========================================
function setupClickHandler() {
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction(function (click) {
        const picked = viewer.scene.pick(click.position);
        if (Cesium.defined(picked) && picked.id) {
            if (picked.id.type === 'aircraft') {
                clearBeams();
                showAircraftPanel(picked.id.icao24);
                flyToAircraft(picked.id.icao24);
            } else if (picked.id.satrec) {
                clearBeams();
                showInfoPanel(picked.id);
                flyToSatellite(picked.id);
                addBeam(picked.id);
            }
        } else {
            document.getElementById('infoPanel').style.display = 'none';
        }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
}


// ==========================================
// INFO PANELS
// ==========================================
function showInfoPanel(sat) {
    const panel   = document.getElementById('infoPanel');
    const content = document.getElementById('infoPanelContent');
    const pos     = sat.position;

    const ORBIT_COLORS = { LEO: '#ff3333', MEO: '#ffcc00', GEO: '#00e6e6', HEO: '#b366ff' };
    const badges = [
        `<span class="orbit-badge" style="background:${ORBIT_COLORS[sat.orbitType]};color:#000;">${sat.orbitType}</span>`,
        sat.isRocketLab ? '<span class="orbit-badge" style="background:#00dc82;color:#000;">RL</span>'     : '',
        sat.isAnomaly   ? '<span class="orbit-badge" style="background:#ff2222;color:#fff;">ANOMALY</span>' : ''
    ].filter(Boolean).join(' ');

    const reasons = (sat.anomalyData && sat.anomalyData.reasons.length > 0)
        ? '<div style="margin-top:8px;padding:6px;background:rgba(255,50,50,0.08);border:1px solid rgba(255,50,50,0.2);border-radius:3px;font-size:10px;">' +
          '<div style="color:#ff6666;font-weight:600;margin-bottom:3px;">ANOMALY FLAGS:</div>' +
          sat.anomalyData.reasons.map(r =>
              `<div style="color:#ffaaaa;">▸ ${r.feature.toUpperCase()}: ${r.value} (z=${r.z_score})</div>`
          ).join('') +
          `<div style="color:rgba(255,255,255,0.3);margin-top:3px;">SCORE: ${sat.anomalyData.score}</div></div>`
        : '';

    content.innerHTML =
        `<h3>${sat.name}</h3>${badges}${reasons}` +
        '<div style="margin-top:10px;">' +
            infoRow('ALT',   pos.altitude.toFixed(1)  + ' km') +
            infoRow('LAT',   pos.latitude.toFixed(4)  + '°')   +
            infoRow('LON',   pos.longitude.toFixed(4) + '°')   +
            infoRow('VEL',   pos.velocity.toFixed(2)  + ' km/s') +
            infoRow('INC',   sat.inclination.toFixed(2)  + '°') +
            infoRow('ECC',   sat.eccentricity.toFixed(6))       +
            infoRow('REV/D', sat.meanMotion.toFixed(4))         +
            infoRow('BSTAR', sat.bstar.toExponential(4))        +
        '</div>';
    panel.style.display = 'block';
}

function showAircraftPanel(icao24) {
    const a = window.activeAircraft[icao24];
    if (!a) return;
    const d = a.data;
    document.getElementById('infoPanelContent').innerHTML =
        `<h3>${d.callsign}</h3>` +
        '<span class="orbit-badge" style="background:#ff9900;color:#000;">AIRCRAFT</span>' +
        '<div style="margin-top:10px;">' +
            infoRow('ICAO24', icao24.toUpperCase()) +
            infoRow('ALT',    d.baro_alt.toFixed(0) + ' m')   +
            infoRow('VEL',    d.velocity.toFixed(1) + ' m/s') +
            infoRow('HDG',    d.heading.toFixed(1)  + '°')    +
        '</div>';
    document.getElementById('infoPanel').style.display = 'block';
}

function infoRow(label, value) {
    return `<div class="info-row"><span class="info-label">${label}</span><span class="info-value">${value}</span></div>`;
}

function flyToSatellite(sat) {
    viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(
            sat.position.longitude, sat.position.latitude, sat.position.altitude * 1000 + 500000
        ),
        duration: 1.5
    });
}

function flyToAircraft(icao24) {
    const a = window.activeAircraft[icao24];
    if (!a) return;
    const c = Cesium.Cartographic.fromCartesian(a.billboard.position);
    viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, c.height + 3000),
        duration: 1.5
    });
}

document.getElementById('closePanel').addEventListener('click', () => {
    document.getElementById('infoPanel').style.display = 'none';
});


// ==========================================
// SEARCH (queries allSatellite array)
// ==========================================
function setupSearch() {
    const input = document.getElementById('searchInput');
    const rd    = document.getElementById('searchResults');

    input.addEventListener('input', function () {
        const q = input.value.trim().toLowerCase();
        if (q.length < 2) { rd.style.display = 'none'; return; }

        const m = allSatellites.filter(s => s.name.toLowerCase().includes(q)).slice(0, 20);
        if (!m.length) {
            rd.innerHTML = '<div class="search-result" style="color:rgba(255,255,255,0.25)">NO MATCH</div>';
            rd.style.display = 'block'; return;
        }

        rd.innerHTML = m.map(s => {
            const c = ORBIT_TYPES[s.orbitType].color;
            return '<div class="search-result">' + s.name +
                `<span class="orbit-tag" style="background:${c};color:#000;">${s.orbitType}</span>` +
                (s.isAnomaly ? '<span class="orbit-tag" style="background:#ff2222;color:#fff;">ML</span>' : '') +
            '</div>';
        }).join('');
        rd.style.display = 'block';

        rd.querySelectorAll('.search-result').forEach((el, i) => {
            el.addEventListener('click', () => {
                showInfoPanel(m[i]); flyToSatellite(m[i]);
                rd.style.display = 'none'; input.value = m[i].name;
            });
        });
    });

    document.addEventListener('click', e => {
        if (!e.target.closest('#controlPanel')) rd.style.display = 'none';
    });
}


// ==========================================
// BEAM TOGGLE 
// ==========================================
document.getElementById('beamToggle').addEventListener('click', function () {
    if (activeBeams.length > 0) {
        clearBeams(); this.textContent = 'SHOW BEAMS';
    } else {
        showBeamsForGroup(); this.textContent = 'HIDE BEAMS';
    }
});


// ==========================================
// TACTICAL MASTER CONTROLS 
// ==========================================
window.logTacticalEvent = function (msg, isAlert) {
    const log = document.getElementById('tacticalEventLog');
    if (!log) return;
    const t  = new Date().toISOString().substring(11, 19) + 'Z';
    const el = document.createElement('div');
    el.style.color      = isAlert ? '#ff3333' : '#00ff96';
    el.style.textShadow = isAlert ? '0 0 6px #ff3333' : '0 0 4px #00ff96';
    el.innerHTML = '[' + t + '] ' + msg;
    log.appendChild(el);
    if (log.children.length > 8) log.removeChild(log.firstChild);
};

let hudInterval;
document.getElementById('godsEyeToggleBtn').addEventListener('click', function () {
    const hud = document.getElementById('godsEyeHud');
    const on  = hud.style.display === 'block';
    if (on) {
        hud.style.display = 'none';
        clearInterval(hudInterval);
        this.textContent = "[ ] GOD'S EYE";
        this.style.background = '';
    } else {
        hud.style.display = 'block';
        this.textContent = "[X] GOD'S EYE";
        this.style.background = 'rgba(0,255,150,0.15)';
        hudInterval = setInterval(() => {
            const cam = Cesium.Cartographic.fromCartesian(viewer.camera.position);
            document.getElementById('hudLat').textContent = Cesium.Math.toDegrees(cam.latitude).toFixed(4)  + '°';
            document.getElementById('hudLon').textContent = Cesium.Math.toDegrees(cam.longitude).toFixed(4) + '°';
            document.getElementById('hudAlt').textContent = cam.height.toFixed(0) + ' m';
        }, 100);
    }
});

let isGroundPOV = false;
document.getElementById('groundPOVBtn').addEventListener('click', function () {
    isGroundPOV = !isGroundPOV;
    if (isGroundPOV) {
        viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(window.userLocation.lon, window.userLocation.lat, 50),
            orientation: { heading: 0, pitch: Cesium.Math.toRadians(85), roll: 0 }, duration: 3.0
        });
        this.textContent = 'ORBITAL VIEW'; this.style.background = 'rgba(0,255,150,0.15)';
    } else {
        viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(window.userLocation.lon, window.userLocation.lat, orbitalViewHeight),
            orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 }, duration: 2.5
        });
        this.textContent = 'GROUND POV'; this.style.background = '';
    }
});

// REGIONAL TARGETING
// When activeGrid is set, pollPositions()
// automatically appends ?lat=X&lon=Y to its request, and the server handles
// the C++ filtering before responding. Zero redundant data movement.
let targetingHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
let targetCircle     = null;

document.getElementById('regionalTargetBtn').addEventListener('click', function () {
    const btn = this;
    if (btn.classList.contains('active')) {
        btn.classList.remove('active');
        btn.style.background = '';
        btn.textContent = 'TARGET REGION';
        if (targetCircle) viewer.entities.remove(targetCircle);
        // Clear the grid 
        window.activeGrid = null;
        // Wipe airplanes
        if (typeof aircraftBillboards !== 'undefined' && aircraftBillboards) {
            aircraftBillboards.removeAll();
            window.activeAircraft = {};
        }
        applyFilter(currentFilter);
        return;
    }

    btn.classList.add('active');
    btn.style.background = 'rgba(255,200,0,0.15)';
    btn.textContent = 'CLICK GLOBE...';

    targetingHandler.setInputAction(function (click) {
        if (!btn.classList.contains('active')) return;
        const ep = viewer.camera.pickEllipsoid(click.position, viewer.scene.globe.ellipsoid);
        if (!ep) return;
        const carto = Cesium.Cartographic.fromCartesian(ep);
        const lon = Cesium.Math.toDegrees(carto.longitude);
        const lat = Cesium.Math.toDegrees(carto.latitude);

        if (targetCircle) viewer.entities.remove(targetCircle);
        targetCircle = viewer.entities.add({
            position: Cesium.Cartesian3.fromDegrees(lon, lat),
            ellipse: {
                semiMinorAxis: 500000, semiMajorAxis: 500000,
                material: Cesium.Color.fromCssColorString('#00ff96').withAlpha(0.03),
                outline: true,
                outlineColor: Cesium.Color.fromCssColorString('#00ff96').withAlpha(0.4)
            }
        });

        // The server does the C++ filtering and returns only nearby satellites.
        window.activeGrid = { lat, lon };

        btn.innerHTML = `<strong>[X] CLEAR GRID</strong> <span style="font-size:10px;">(${lat.toFixed(1)}N, ${lon.toFixed(1)}W)</span>`;

        fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`)
            .then(res => res.json())
            .then(data => {
                const place = data.address.city || data.address.town || data.address.state || data.address.country || 'UNKNOWN ZONE';
                btn.innerHTML = `<strong>[X] CLEAR GRID</strong> <span style="font-size:10px;">(${place.toUpperCase()})</span>`;
                if (window.logTacticalEvent) window.logTacticalEvent(`REGION LOCKED: ${place.toUpperCase()}`);
            })
            .catch(err => console.warn('Geocoding failed', err));

        if (typeof sweepAirspace === 'function') {
            const lamin = lat - 5, lamax = lat + 5, lomin = lon - 5, lomax = lon + 5;
            sweepAirspace(lamin, lomin, lamax, lomax);
            window.radarInterval = setInterval(() => sweepAirspace(lamin, lomin, lamax, lomax), 15000);
        }

    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
});


loadSatellites();