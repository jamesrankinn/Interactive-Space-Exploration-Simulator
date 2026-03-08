// =====================================================================
// app.js — Main Application
// Cesium globe, TLE fetch, rendering, click/search/filter, animation,
// ML anomaly integration, tactical controls, airplane routing
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
// CESIUM VIEWER (one clean setup — no duplicates)
// ==========================================
const viewer = new Cesium.Viewer('cesiumContainer', {
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    timeline: false,
    animation: false,
    fullscreenButton: false,
    infoBox: false
});

// Globe styling
viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#050505');
viewer.scene.globe.enableLighting = true;
viewer.scene.globe.depthTestAgainstTerrain = true;

// Atmosphere
viewer.scene.skyAtmosphere.hueShift = -0.4;
viewer.scene.skyAtmosphere.brightnessShift = 0.2;
viewer.scene.skyAtmosphere.saturationShift = 0.5;

// TACTICAL UPGRADE: Unlock smooth camera zooming and panning
viewer.scene.screenSpaceCameraController.enableCollisionDetection = false; 
viewer.scene.screenSpaceCameraController.minimumZoomDistance = 50; 
viewer.scene.screenSpaceCameraController.maximumZoomDistance = 40000000;

// 3D Terrain (async — won't block page load)
Cesium.createWorldTerrainAsync({ requestWaterMask: true, requestVertexNormals: true })
    .then(function (terrain) { viewer.terrainProvider = terrain; console.log("3D Terrain online."); })
    .catch(function (e) { console.warn("Terrain failed:", e); });

// 3D Buildings (async — loaded ONCE)
Cesium.createOsmBuildingsAsync()
    .then(function (buildings) { viewer.scene.primitives.add(buildings); console.log("3D Cities online."); })
    .catch(function (e) { console.warn("Buildings failed:", e); });

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
    // Tactical Jet Silhouette
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

const DOT_SIZES = { LEO: 20, MEO: 24, GEO: 28, HEO: 26 };


// ==========================================
// DATA STORES
// ==========================================
const billboards = viewer.scene.primitives.add(new Cesium.BillboardCollection());
let allSatellites = [];
let satBillboards = [];
let currentFilter = 'all';

// ==========================================
// MAIN: LOAD SATELLITES
// ==========================================
async function loadSatellites() {
    try {
        console.log('Fetching TLEs from CelesTrak...');
        console.log('Fetching TLEs via local backend proxy...');
        
        // Fetch from our Flask server instead of CelesTrak directly to avoid IP ban
        const response = await fetch('http://localhost:5000/api/tles');
        
        if (!response.ok) throw new Error('Backend proxy error: ' + response.status);

        const rawText = await response.text();
        let satellites = parseTLEs(rawText);
        if (satellites.length > MAX_SATS) satellites = satellites.slice(0, MAX_SATS);
        console.log('Parsed ' + satellites.length + ' satellites');

        const now = new Date();
        let rendered = 0;
        const counts = { LEO: 0, MEO: 0, GEO: 0, HEO: 0 };

        satellites.forEach(sat => {
            const pos = getPosition(sat.satrec, now);
            if (!pos) return;

            const orbitType = getOrbitType(pos.altitude);
            counts[orbitType]++;
            
            sat.position = pos;
            sat.orbitType = orbitType;
            sat.isRocketLab = isRocketLab(sat.name);
            sat.isAnomaly = false;
            sat.anomalyData = null;

            const billboard = billboards.add({
                position: Cesium.Cartesian3.fromDegrees(pos.longitude, pos.latitude, pos.altitude * 1000),
                image: glowTextures[orbitType],
                width: DOT_SIZES[orbitType],
                height: DOT_SIZES[orbitType],
                translucencyByDistance: new Cesium.NearFarScalar(2000000, 1.0, 300000000, 0.4),
                scaleByDistance: new Cesium.NearFarScalar(1000000, 1.0, 100000000, 0.3),
                disableDepthTestDistance: 0,
                id: sat
            });

            satBillboards.push({ sat, billboard });
            rendered++;
        });

        allSatellites = satellites.filter(s => s.position);

        // UI
        document.getElementById('loading').style.display = 'none';
        document.getElementById('controlPanel').style.display = 'block';
        document.getElementById('legend').style.display = 'block';
        updateStats(rendered, counts);
        console.log('Rendered ' + rendered + ' satellites');

        // Dashboard updates
        const label = document.getElementById('satCountLabel');
        if (label) label.textContent = 'TRACKING: ' + rendered + ' OBJECTS';

        // Setup interactivity
        setupClickHandler();
        setupSearch();
        setupFilters();
        startAnimation();

        // ML pipeline (async — doesn't block rendering)
        await fetchAnomalies();

        // Airplane radar system
        if (typeof initRadarSystem === 'function') {
            initRadarSystem(viewer);
        }

    } catch (error) {
        console.error('Failed:', error);
        document.getElementById('loading').textContent = 'Error: ' + error.message;
    }
}


// ==========================================
// ANIMATION — 2-second SGP4 update loop
// ==========================================
function startAnimation() {
    setInterval(function () {
        const now = new Date();
        
        satBillboards.forEach(function (entry) {
            const sat = entry.sat;
            
            // 1. Calculate new live math position
            const p = getPosition(sat.satrec, now);
            if (!p) return;
            sat.position = p;
            entry.billboard.position = Cesium.Cartesian3.fromDegrees(p.longitude, p.latitude, p.altitude * 1000);

            // 2. Check base filters first
            let show = false;
            if (currentFilter === 'all') show = true;
            else if (currentFilter === 'rocketlab') show = sat.isRocketLab;
            else if (currentFilter === 'anomaly') show = (sat.isAnomaly === true);
            else show = (sat.orbitType === currentFilter);

            // 3. TACTICAL GRID OVERRIDE (Dynamic Entry/Exit)
            // 3. TACTICAL GRID OVERRIDE (Dynamic Entry/Exit via C++ Engine)
            if (window.activeGrid && show) {
                // We no longer do the math here! We let the backend do it.
                // Note: In a true production app, we would batch these requests, 
                // but for this architecture, we will ping the C++ engine.
                
                const reqData = {
                    lat: window.activeGrid.lat,
                    lon: window.activeGrid.lon,
                    ids: [parseInt(sat.satrec.satnum)],
                    lats: [p.latitude],
                    lons: [p.longitude]
                };

                // This runs asynchronously so it doesn't freeze the browser
                fetch('http://localhost:5000/api/grid_filter', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(reqData)
                })
                .then(res => res.json())
                .then(data => {
                    // If the C++ engine returns an empty array, it's outside the 500km grid!
                    if (data.targets.length === 0) {
                        entry.billboard.show = false;
                    }
                })
                .catch(err => console.error("C++ Engine Offline:", err));
            } else {
                entry.billboard.show = show;
            }

            entry.billboard.show = show;
        });

        // Live Beam sweeping check
        const beamBtn = document.getElementById('beamToggle');
        if (beamBtn && beamBtn.textContent === 'HIDE BEAMS') {
            showBeamsForGroup(); 
        }

    }, 2000);
}

// ==========================================
// FILTER SYSTEM (single unified function)
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

        // Base filter logic
        if (filter === 'all') show = true;
        else if (filter === 'rocketlab') show = sat.isRocketLab;
        else if (filter === 'anomaly') show = (sat.isAnomaly === true);
        else show = (sat.orbitType === filter);

        // VISUAL SWAP: Only turn red if the Anomaly filter is explicitly active
        if (filter === 'anomaly' && sat.isAnomaly) {
            entry.billboard.image = ANOMALY_MARKER;
            entry.billboard.scale = 1.3;
        } else {
            // Otherwise, stay stealthy and use normal orbit colors
            entry.billboard.image = glowTextures[sat.orbitType];
            entry.billboard.scale = 1.0;
        }

        entry.billboard.show = show;
        if (show) { visibleCount++; counts[sat.orbitType]++; } 
    });

        // Darken for anomaly mode
        if (filter === 'anomaly') {
            viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#020202');
            viewer.scene.skyAtmosphere.brightnessShift = -0.5;
        } else {
            viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#050505');
            viewer.scene.skyAtmosphere.brightnessShift = 0.2;
        }

        updateStats(visibleCount, counts); // FIXED 'vis'
        clearBeams();

        //DElete this?
        const beamBtn = document.getElementById('beamToggle');
        beamBtn.style.display = (filter !== 'all') ? 'inline-block' : 'none';
        beamBtn.textContent = 'SHOW BEAMS';
    }

function updateStats(total, counts) {
    const el = document.getElementById('stats');
    el.style.display = 'block';
    el.innerHTML =
        'VIS: <span>' + total + '</span>' +
        ' // LEO: <span>' + counts.LEO + '</span>' +
        ' // MEO: <span>' + counts.MEO + '</span>' +
        ' // GEO: <span>' + counts.GEO + '</span>' +
        ' // HEO: <span>' + counts.HEO + '</span>';
}

// ==========================================
// CLICK HANDLER — Routes satellites vs aircraft
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
    const panel = document.getElementById('infoPanel');
    const content = document.getElementById('infoPanelContent');
    const pos = sat.position;

    // map satellites to proper colours
    const ORBIT_COLORS = { LEO: '#ff3333', MEO: '#ffcc00', GEO: '#00e6e6', HEO: '#b366ff' };
    
    const badges = [
        '<span class="orbit-badge" style="background:' + ORBIT_COLORS[sat.orbitType] + ';color:#000;">' + sat.orbitType + '</span>',
        sat.isRocketLab ? '<span class="orbit-badge" style="background:#00dc82;color:#000;">RL</span>' : '',
        sat.isAnomaly ? '<span class="orbit-badge" style="background:#ff2222;color:#fff;">ANOMALY</span>' : ''
    ].filter(Boolean).join(' ');

    const reasons = (sat.anomalyData && sat.anomalyData.reasons.length > 0)
        ? '<div style="margin-top:8px;padding:6px;background:rgba(255,50,50,0.08);border:1px solid rgba(255,50,50,0.2);border-radius:3px;font-size:10px;">' +
          '<div style="color:#ff6666;font-weight:600;margin-bottom:3px;">ANOMALY FLAGS:</div>' +
          sat.anomalyData.reasons.map(r =>
              '<div style="color:#ffaaaa;">\u25B8 ' + r.feature.toUpperCase() + ': ' + r.value + ' (z=' + r.z_score + ')</div>'
          ).join('') +
          '<div style="color:rgba(255,255,255,0.3);margin-top:3px;">SCORE: ' + sat.anomalyData.score + '</div></div>'
        : '';

    content.innerHTML =
        '<h3>' + sat.name + '</h3>' + badges + reasons +
        '<div style="margin-top:10px;">' +
            infoRow('ALT', pos.altitude.toFixed(1) + ' km') +
            infoRow('LAT', pos.latitude.toFixed(4) + '\u00B0') +
            infoRow('LON', pos.longitude.toFixed(4) + '\u00B0') +
            infoRow('VEL', pos.velocity.toFixed(2) + ' km/s') +
            infoRow('INC', sat.inclination.toFixed(2) + '\u00B0') +
            infoRow('ECC', sat.eccentricity.toFixed(6)) +
            infoRow('REV/D', sat.meanMotion.toFixed(4)) +
            infoRow('BSTAR', sat.bstar.toExponential(4)) +
        '</div>';
    panel.style.display = 'block';
}

function showAircraftPanel(icao24) {
    const a = window.activeAircraft[icao24];
    if (!a) return;
    const d = a.data;
    const content = document.getElementById('infoPanelContent');
    content.innerHTML =
        '<h3>' + d.callsign + '</h3>' +
        '<span class="orbit-badge" style="background:#ff9900;color:#000;">AIRCRAFT</span>' +
        '<div style="margin-top:10px;">' +
            infoRow('ICAO24', icao24.toUpperCase()) +
            infoRow('ALT', d.baro_alt.toFixed(0) + ' m') +
            infoRow('VEL', d.velocity.toFixed(1) + ' m/s') +
            infoRow('HDG', d.heading.toFixed(1) + '\u00B0') +
        '</div>';
    document.getElementById('infoPanel').style.display = 'block';
}

function infoRow(label, value) {
    return '<div class="info-row"><span class="info-label">' + label + '</span><span class="info-value">' + value + '</span></div>';
}

function flyToSatellite(sat) {
    viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(sat.position.longitude, sat.position.latitude, sat.position.altitude * 1000 + 500000),
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
// SEARCH
// ==========================================
function setupSearch() {
    const input = document.getElementById('searchInput');
    const rd = document.getElementById('searchResults');

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
                '<span class="orbit-tag" style="background:' + c + ';color:#000;">' + s.orbitType + '</span>' +
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
// ML ANOMALY FETCH
// ==========================================
async function fetchAnomalies() {
    const mlEl = document.getElementById('mlStatus');
    try {
        if (mlEl) mlEl.textContent = 'ML: PROCESSING...';
        const response = await fetch('http://localhost:5000/api/anomalies');
        if (!response.ok) throw new Error('HTTP ' + response.status);

        const data = await response.json();
        const anomalyMap = {};
        data.anomalies.forEach(a => { anomalyMap[a.norad_id] = a; });

        let matched = 0;
        satBillboards.forEach(entry => {
            const nid = parseInt(entry.sat.satrec.satnum);
            if (anomalyMap[nid]) {
                entry.sat.isAnomaly = true;
                entry.sat.anomalyData = anomalyMap[nid];
                matched++;
            }
        });

        if (mlEl) mlEl.textContent = 'ML: ' + matched + ' ANOMALIES';
        if (mlEl) mlEl.style.color = '#ff3333';
        if (window.logTacticalEvent) window.logTacticalEvent('ML PIPELINE: ' + matched + ' anomalies isolated.', true);

    } catch (e) {
        if (mlEl) mlEl.textContent = 'ML: OFFLINE';
        console.warn('Backend unavailable:', e.message);
    }
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


// Tactical Event Logger (scrolling terminal in HUD)
window.logTacticalEvent = function (msg, isAlert) {
    const log = document.getElementById('tacticalEventLog');
    if (!log) return;
    const t = new Date().toISOString().substring(11, 19) + 'Z';
    const el = document.createElement('div');
    el.style.color = isAlert ? '#ff3333' : '#00ff96';
    el.style.textShadow = isAlert ? '0 0 6px #ff3333' : '0 0 4px #00ff96';
    el.innerHTML = '[' + t + '] ' + msg;
    log.appendChild(el);
    if (log.children.length > 8) log.removeChild(log.firstChild);
};

// GOD'S EYE HUD
let hudInterval;
document.getElementById('godsEyeToggleBtn').addEventListener('click', function () {
    const hud = document.getElementById('godsEyeHud');
    const on = hud.style.display === 'block';

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
            document.getElementById('hudLat').textContent = Cesium.Math.toDegrees(cam.latitude).toFixed(4) + '\u00B0';
            document.getElementById('hudLon').textContent = Cesium.Math.toDegrees(cam.longitude).toFixed(4) + '\u00B0';
            document.getElementById('hudAlt').textContent = cam.height.toFixed(0) + ' m';
        }, 100);
    }
});

// GROUND POV
let isGroundPOV = false;
document.getElementById('groundPOVBtn').addEventListener('click', function () {
    isGroundPOV = !isGroundPOV;
    if (isGroundPOV) {
        viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(window.userLocation.lon, window.userLocation.lat, 50),
            orientation: { heading: 0, pitch: Cesium.Math.toRadians(85), roll: 0 },
            duration: 3.0
        });
        this.textContent = 'ORBITAL VIEW';
        this.style.background = 'rgba(0,255,150,0.15)';
    } else {
        viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(window.userLocation.lon, window.userLocation.lat, orbitalViewHeight),
            orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
            duration: 2.5
        });
        this.textContent = 'GROUND POV';
        this.style.background = '';
    }
});

// REGIONAL TARGETING
let targetingHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
let targetCircle = null;

document.getElementById('regionalTargetBtn').addEventListener('click', function () {
    const btn = this;
    if (btn.classList.contains('active')) {
        // TURN OFF TARGETING
        btn.classList.remove('active'); 
        btn.style.background = '';
        btn.textContent = 'TARGET REGION';
        
        if (targetCircle) viewer.entities.remove(targetCircle);
        if (typeof radarInterval !== 'undefined') clearInterval(radarInterval);
        
        // TACTICAL CLEANUP: Tell the system the grid is gone
        window.activeGrid = null; 

        // TACTICAL CLEANUP: Wipe all airplanes off the screen
        if (typeof aircraftBillboards !== 'undefined' && aircraftBillboards) {
            aircraftBillboards.removeAll();
            window.activeAircraft = {};
        }

        applyFilter(currentFilter); // Restore normal satellite view
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

        const lamin = lat - 5, lamax = lat + 5, lomin = lon - 5, lomax = lon + 5;
        
        // Let the system know a grid is currently active
        window.activeGrid = { lat: lat, lon: lon };

        // Temporarily show coordinates while we fetch the real name
        btn.innerHTML = `<strong>[X] CLEAR GRID</strong> <span style="font-size:10px;">(${lat.toFixed(1)}N, ${lon.toFixed(1)}W)</span>`;

        // TACTICAL UPGRADE: Reverse Geocoding for real-world location names
        fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`)
            .then(res => res.json())
            .then(data => {
                const place = data.address.city || data.address.town || data.address.state || data.address.country || "UNKNOWN ZONE";
                btn.innerHTML = `<strong>[X] CLEAR GRID</strong> <span style="font-size:10px;">(${place.toUpperCase()})</span>`;
                if (window.logTacticalEvent) window.logTacticalEvent(`REGION LOCKED: ${place.toUpperCase()}`);
            })
            .catch(err => console.warn("Geocoding failed", err));

        if (typeof radarInterval !== 'undefined') clearInterval(radarInterval);
        if (typeof sweepAirspace === 'function') {
            sweepAirspace(lamin, lomin, lamax, lomax);
            window.radarInterval = setInterval(() => sweepAirspace(lamin, lomin, lamax, lomax), 15000);
        }

        if (window.logTacticalEvent) window.logTacticalEvent('REGION LOCKED: ' + lat.toFixed(2) + 'N ' + lon.toFixed(2) + 'E');

    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
});


loadSatellites();