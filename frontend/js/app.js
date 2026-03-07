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
function createTacticalMarker(color) {
    const svg = `
    <svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
        <path d="M 2 8 L 2 2 L 8 2 M 24 2 L 30 2 L 30 8 M 30 24 L 30 30 L 24 30 M 8 30 L 2 30 L 2 24"
              fill="none" stroke="${color}" stroke-width="1.5" opacity="0.7"/>
        <polygon points="16,6 26,16 16,26 6,16"
                 fill="${color}" fill-opacity="0.3" stroke="${color}" stroke-width="1.5"/>
        <circle cx="16" cy="16" r="2" fill="#ffffff"/>
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

const glowTextures = {
    LEO: createTacticalMarker('#ff3333'),
    MEO: createTacticalMarker('#ffcc00'),
    GEO: createTacticalMarker('#00e6e6'),
    HEO: createTacticalMarker('#b366ff')
};

// Separate anomaly marker so normal sats keep their orbit color
const ANOMALY_MARKER = createTacticalMarker('#ff0000');

const DOT_SIZES = { LEO: 20, MEO: 24, GEO: 28, HEO: 26 };


// ==========================================
// DATA STORES
// ==========================================
const billboards = viewer.scene.primitives.add(new Cesium.BillboardCollection());
let allSatellites = [];
let satBillboards = [];
let currentFilter = 'all';
let isIsolationMode = false;
let activeLaserTrail = null;

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
                // FIX: Normal sats visible out to 300,000km (was 12,000km = invisible)
                translucencyByDistance: new Cesium.NearFarScalar(2000000, 1.0, 300000000, 0.4),
                scaleByDistance: new Cesium.NearFarScalar(1000000, 1.0, 100000000, 0.3),
                disableDepthTestDistance: 0,
                id: sat
            });

            satBillboards.push({ sat: sat, billboard: billboard });
            rendered++;
        });

        allSatellites = satellites.filter(s => s.position);

        // UI
        document.getElementById('loading').style.display = 'none';
        document.getElementById('controlPanel').style.display = 'block';
        document.getElementById('legend').style.display = 'block';
        updateStats(rendered, counts);
        console.log('Rendered ' + rendered + ' satellites');

        const rlCount = allSatellites.filter(s => s.isRocketLab).length;
        console.log('Found ' + rlCount + ' Rocket Lab satellites');

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
            if (!entry.billboard.show) return;

            const newPos = getPosition(entry.sat.satrec, now);
            if (!newPos) return;

            entry.sat.position = newPos;
            entry.billboard.position = Cesium.Cartesian3.fromDegrees(
                newPos.longitude, newPos.latitude, newPos.altitude * 1000
            );
        });
    }, 2000);
}


// ==========================================
// FILTER SYSTEM (single unified function)
// ==========================================
function setupFilters() {
    const buttons = document.querySelectorAll('.filter-btn');
    buttons.forEach(function (btn) {
        btn.addEventListener('click', function () {
            buttons.forEach(function (b) { b.classList.remove('active'); });
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
        else if (filter === 'anomaly' || filter === 'isolation') show = (sat.isAnomaly === true);
        else show = (sat.orbitType === filter);

        // Isolation override: hide non-anomalies regardless of filter
        if (isIsolationMode) {
            if (!sat.isAnomaly) {
                show = false; // Hide normal traffic
            } else {
                // Tactical Red for Anomalies in Isolation Mode
                entry.billboard.image = ANOMALY_MARKER;
                entry.billboard.scale = 1.3;
            }
        } else {
            // Revert back to normal stealthy colors when Isolation is off
            entry.billboard.image = glowTextures[sat.orbitType];
            entry.billboard.scale = 1.0;
        }
        entry.billboard.show = show;
        
        if (show) { 
            visibleCount++; 
            if (counts[sat.orbitType] !== undefined) {
                counts[sat.orbitType]++; 
            }
        }
    });

    // Darken globe in isolation mode
    if (isIsolationMode || filter === 'isolation' || filter === 'anomaly') {
        viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#020202');
        viewer.scene.skyAtmosphere.brightnessShift = -0.5;
    } else {
        viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#050505');
        viewer.scene.skyAtmosphere.brightnessShift = 0.2;
    }

    updateStats(visibleCount, counts);
    clearBeams();

    // Show beam toggle for non-"all" filters
    const beamBtn = document.getElementById('beamToggle');
    if (filter !== 'all') {
        beamBtn.style.display = 'inline-block';
        beamBtn.textContent = 'Show Beams';
        beamBtn.classList.remove('active');
    } else {
        beamBtn.style.display = 'none';
    }
}

function updateStats(total, counts) {
    const statsDiv = document.getElementById('stats');
    statsDiv.style.display = 'block';
    statsDiv.innerHTML =
        'Visible: <span>' + total + '</span>' +
        ' &nbsp;|&nbsp; LEO: <span>' + counts.LEO + '</span>' +
        ' &nbsp;|&nbsp; MEO: <span>' + counts.MEO + '</span>' +
        ' &nbsp;|&nbsp; GEO: <span>' + counts.GEO + '</span>' +
        ' &nbsp;|&nbsp; HEO: <span>' + counts.HEO + '</span>';
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
                const sat = picked.id;
                clearBeams();
                showInfoPanel(sat);
                flyToSatellite(sat);
                addBeam(sat);
                drawLaserTrail(sat);
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
    const orbitInfo = ORBIT_TYPES[sat.orbitType];

    const rlBadge = sat.isRocketLab
        ? ' <span class="orbit-badge" style="background:#00dc82; color:#000;">Rocket Lab</span>' : '';

    const anomalyBadge = sat.isAnomaly
        ? ' <span class="orbit-badge" style="background:#ff2222; color:#fff;">ML ANOMALY</span>' : '';

    const anomalyReasons = (sat.anomalyData && sat.anomalyData.reasons.length > 0)
        ? '<div style="margin-top:10px; padding:8px; background:rgba(255,50,50,0.1); border:1px solid rgba(255,50,50,0.3); border-radius:8px; font-size:11px;">' +
          '<div style="color:#ff6666; font-weight:600; margin-bottom:4px;">Anomaly Reasons:</div>' +
          sat.anomalyData.reasons.map(r =>
              '<div style="color:#ffaaaa;">\u2022 ' + r.feature + ': ' + r.value + ' (z=' + r.z_score + ', ' + r.direction + ')</div>'
          ).join('') +
          '<div style="color:#888; margin-top:4px;">Score: ' + sat.anomalyData.score + '</div></div>'
        : '';

    content.innerHTML =
        '<h3>' + sat.name + '</h3>' +
        '<span class="orbit-badge" style="background:' + orbitInfo.color + '; color:#000;">' +
            sat.orbitType + ' — ' + orbitInfo.label + '</span>' +
        rlBadge + anomalyBadge + anomalyReasons +
        '<div style="margin-top: 14px;">' +
            infoRow('Altitude',     pos.altitude.toFixed(1) + ' km') +
            infoRow('Latitude',     pos.latitude.toFixed(4) + '\u00B0') +
            infoRow('Longitude',    pos.longitude.toFixed(4) + '\u00B0') +
            infoRow('Velocity',     pos.velocity.toFixed(2) + ' km/s') +
            infoRow('Inclination',  sat.inclination.toFixed(2) + '\u00B0') +
            infoRow('Eccentricity', sat.eccentricity.toFixed(6)) +
            infoRow('Mean Motion',  sat.meanMotion.toFixed(4) + ' rev/day') +
            infoRow('BSTAR Drag',   sat.bstar.toExponential(4)) +
        '</div>';

    panel.style.display = 'block';
}

function showAircraftPanel(icao24) {
    const panel = document.getElementById('infoPanel');
    const content = document.getElementById('infoPanelContent');
    const aircraft = window.activeAircraft[icao24];
    if (!aircraft) return;

    const data = aircraft.data;
    content.innerHTML =
        '<h3>' + data.callsign + '</h3>' +
        '<span class="orbit-badge" style="background:#ff9900; color:#000;">ATMOSPHERIC RADAR</span>' +
        '<div style="margin-top: 14px;">' +
            infoRow('ICAO24 Hex', icao24.toUpperCase()) +
            infoRow('Altitude', data.baro_alt.toFixed(0) + ' m') +
            infoRow('Velocity', data.velocity.toFixed(1) + ' m/s') +
            infoRow('Heading', data.heading.toFixed(1) + '\u00B0') +
        '</div>';

    panel.style.display = 'block';
}

function infoRow(label, value) {
    return '<div class="info-row">' +
        '<span class="info-label">' + label + '</span>' +
        '<span class="info-value">' + value + '</span></div>';
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
    const aircraft = window.activeAircraft[icao24];
    if (!aircraft) return;
    const cartPos = aircraft.billboard.position;
    const carto = Cesium.Cartographic.fromCartesian(cartPos);
    viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, carto.height + 3000),
        duration: 1.5
    });
}

document.getElementById('closePanel').addEventListener('click', function () {
    document.getElementById('infoPanel').style.display = 'none';

    // TACTICAL CLEANUP: Remove the laser trail if it exists
    if (activeLaserTrail) {
        viewer.entities.remove(activeLaserTrail);
        activeLaserTrail = null; // Reset the variable
    }
    
    // Optional: Also clear the scanning beams when you close the panel
    if (typeof clearBeams === 'function') {
        clearBeams();
    }
});


// ==========================================
// SEARCH
// ==========================================
function setupSearch() {
    const input = document.getElementById('searchInput');
    const resultsDiv = document.getElementById('searchResults');

    input.addEventListener('input', function () {
        const query = input.value.trim().toLowerCase();
        if (query.length < 2) { resultsDiv.style.display = 'none'; return; }

        const matches = allSatellites
            .filter(sat => sat.name.toLowerCase().includes(query))
            .slice(0, 20);

        if (matches.length === 0) {
            resultsDiv.innerHTML = '<div class="search-result" style="color:#667">No matches found</div>';
            resultsDiv.style.display = 'block';
            return;
        }

        resultsDiv.innerHTML = matches.map(function (sat) {
            const orbitInfo = ORBIT_TYPES[sat.orbitType];
            const rlTag = sat.isRocketLab ? '<span class="orbit-tag" style="background:#00dc82; color:#000;">RL</span>' : '';
            const mlTag = sat.isAnomaly ? '<span class="orbit-tag" style="background:#ff2222; color:#fff;">ML</span>' : '';
            return '<div class="search-result">' + sat.name +
                '<span class="orbit-tag" style="background:' + orbitInfo.color + '; color:#000;">' + sat.orbitType + '</span>' +
                rlTag + mlTag + '</div>';
        }).join('');

        resultsDiv.style.display = 'block';

        resultsDiv.querySelectorAll('.search-result').forEach(function (el, index) {
            el.addEventListener('click', function () {
                showInfoPanel(matches[index]);
                flyToSatellite(matches[index]);
                resultsDiv.style.display = 'none';
                input.value = matches[index].name;
            });
        });
    });

    document.addEventListener('click', function (e) {
        if (!e.target.closest('#controlPanel')) resultsDiv.style.display = 'none';
    });
}


// ==========================================
// ML ANOMALY FETCH
// ==========================================
async function fetchAnomalies() {
    try {
        console.log('Fetching anomalies from backend...');
        const response = await fetch('http://localhost:5000/api/anomalies');
        if (!response.ok) throw new Error('Backend returned ' + response.status);

        const data = await response.json();
        console.log('Backend reports ' + data.total_anomalies + ' anomalies.');

        const anomalyMap = {};
        data.anomalies.forEach(function (a) { anomalyMap[a.norad_id] = a; });

        let matched = 0;
        satBillboards.forEach(function (entry) {
            const noradId = parseInt(entry.sat.satrec.satnum);

            if (anomalyMap[noradId]) {
                entry.sat.isAnomaly = true;
                entry.sat.anomalyData = anomalyMap[noradId];
                matched++;
            }
        });

        console.log('Tagged ' + matched + ' anomalies on globe.');
        if (window.logTacticalEvent) {
            window.logTacticalEvent('ML OVERRIDE: ' + matched + ' orbital anomalies isolated.', true);
        }

    } catch (error) {
        console.warn('Backend not available: ' + error.message);
        console.warn('Start with: cd backend && python app.py');
    }
}


// ==========================================
// BEAM TOGGLE
// ==========================================
document.getElementById('beamToggle').addEventListener('click', function () {
    const btn = this;
    if (activeBeams.length > 0) {
        clearBeams();
        btn.textContent = 'Show Beams';
        btn.classList.remove('active');
    } else {
        showBeamsForGroup();
        btn.textContent = 'Hide Beams';
        btn.classList.add('active');
    }
});

function drawLaserTrail(sat) {
    if (activeLaserTrail) viewer.entities.remove(activeLaserTrail);
    
    const positions = [];
    const now = new Date();
    
    // Project 45 minutes into the future, computing position every 1 minute
    for (let i = 0; i <= 45; i++) {
        const futureTime = new Date(now.getTime() + i * 60000);
        const pos = getPosition(sat.satrec, futureTime);
        if (pos) {
            positions.push(Cesium.Cartesian3.fromDegrees(pos.longitude, pos.latitude, pos.altitude * 1000));
        }
    }

    activeLaserTrail = viewer.entities.add({
        polyline: {
            positions: positions,
            width: 3,
            material: new Cesium.PolylineGlowMaterialProperty({
                glowPower: 0.3,
                taperPower: 1.0,
                color: Cesium.Color.fromCssColorString('#00ff96').withAlpha(0.8)
            })
        }
    });
}

// ==========================================
// TACTICAL MASTER CONTROLS
// ==========================================

// Haversine (also in beams.js, duplicated here for regional targeting)
function getGroundDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = Cesium.Math.toRadians(lat2 - lat1);
    const dLon = Cesium.Math.toRadians(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(Cesium.Math.toRadians(lat1)) * Math.cos(Cesium.Math.toRadians(lat2)) *
              Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Tactical Event Logger (scrolling terminal in HUD)
window.logTacticalEvent = function (message, isAlert) {
    const log = document.getElementById('tacticalEventLog');
    if (!log) return;
    const time = new Date().toISOString().substring(11, 19) + 'Z';
    const entry = document.createElement('div');
    entry.style.color = isAlert ? '#ff3333' : '#00ff96';
    entry.style.textShadow = isAlert ? '0 0 6px #ff3333' : '0 0 4px #00ff96';
    entry.innerHTML = '[' + time + '] ' + message;
    log.appendChild(entry);
    if (log.children.length > 8) log.removeChild(log.firstChild);
};

// 1. ISOLATION OVERRIDE
document.getElementById('isolationToggleBtn').addEventListener('click', function () {
    isIsolationMode = !isIsolationMode;
    this.style.background = isIsolationMode ? 'rgba(255,50,50,0.3)' : 'rgba(30,40,60,0.6)';
    this.textContent = isIsolationMode ? '[X] ISOLATION OVERRIDE' : '[ ] ISOLATION OVERRIDE';
    applyFilter(currentFilter);
});

// 2. GOD'S EYE HUD
let isGodsEye = false;
let hudInterval;
document.getElementById('godsEyeToggleBtn').addEventListener('click', function () {
    isGodsEye = !isGodsEye;
    const hud = document.getElementById('godsEyeHud');
    this.style.background = isGodsEye ? 'rgba(0,255,150,0.2)' : 'rgba(30,40,60,0.6)';
    this.textContent = isGodsEye ? "[X] GOD'S EYE HUD" : "[ ] GOD'S EYE HUD";

    if (isGodsEye) {
        hud.style.display = 'block';
        hudInterval = setInterval(() => {
            const cam = Cesium.Cartographic.fromCartesian(viewer.camera.position);
            document.getElementById('hudLat').textContent = Cesium.Math.toDegrees(cam.latitude).toFixed(4) + '\u00B0 N';
            document.getElementById('hudLon').textContent = Math.abs(Cesium.Math.toDegrees(cam.longitude)).toFixed(4) + '\u00B0 W';
            document.getElementById('hudAlt').textContent = cam.height.toFixed(0) + ' m';
        }, 100);
    } else {
        hud.style.display = 'none';
        clearInterval(hudInterval);
    }
});

// 3. GROUND POV
let isGroundPOV = false;
document.getElementById('groundPOVBtn').addEventListener('click', function () {
    isGroundPOV = !isGroundPOV;
    const btn = this;

    if (isGroundPOV) {
        viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(window.userLocation.lon, window.userLocation.lat, 250),
            orientation: { heading: 0, pitch: Cesium.Math.toRadians(-10), roll: 0 },
            duration: 3.0
        });
        btn.textContent = 'Orbital View';
        btn.style.background = 'rgba(100,255,200,0.35)';
    } else {
        viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(window.userLocation.lon, window.userLocation.lat, orbitalViewHeight),
            orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
            duration: 2.5
        });
        btn.textContent = 'Ground POV';
        btn.style.background = 'rgba(20,40,30,0.6)';
    }
});

// 4. REGIONAL TARGETING
let targetingHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
let targetCircle = null;

document.getElementById('regionalTargetBtn').addEventListener('click', function () {
    const btn = this;
    if (btn.classList.contains('active')) {
        btn.classList.remove('active');
        btn.style.background = 'rgba(30,40,60,0.6)';
        btn.textContent = 'Target Region (Map Click)';
        if (targetCircle) viewer.entities.remove(targetCircle);
        if (typeof radarInterval !== 'undefined') clearInterval(radarInterval);
        applyFilter(currentFilter);
        return;
    }

    btn.classList.add('active');
    btn.style.background = 'rgba(255,204,0,0.3)';
    btn.textContent = 'Click globe to set grid...';

    targetingHandler.setInputAction(function (click) {
        if (!btn.classList.contains('active')) return;

        const earthPos = viewer.camera.pickEllipsoid(click.position, viewer.scene.globe.ellipsoid);
        if (!earthPos) return;

        const carto = Cesium.Cartographic.fromCartesian(earthPos);
        const lon = Cesium.Math.toDegrees(carto.longitude);
        const lat = Cesium.Math.toDegrees(carto.latitude);

        // Draw tactical grid
        if (targetCircle) viewer.entities.remove(targetCircle);
        targetCircle = viewer.entities.add({
            position: Cesium.Cartesian3.fromDegrees(lon, lat),
            ellipse: {
                semiMinorAxis: 500000, semiMajorAxis: 500000,
                material: new Cesium.GridMaterialProperty({
                    color: Cesium.Color.YELLOW.withAlpha(0.2),
                    cellAlpha: 0.0,
                    lineCount: new Cesium.Cartesian2(8, 8),
                    lineThickness: new Cesium.Cartesian2(2.0, 2.0)
                }),
                outline: true, outlineColor: Cesium.Color.YELLOW
            }
        });

        const lamin = lat - 5, lamax = lat + 5;
        const lomin = lon - 5, lomax = lon + 5;
        
        // DASHBOARD UPGRADE: Transform the button to a Clear action
        btn.innerHTML = `<strong>[X] CLEAR GRID</strong> <span style="font-size:10px;">(${lat.toFixed(1)}N, ${lon.toFixed(1)}W)</span>`;
        btn.style.background = 'rgba(255,50,50,0.3)';
        btn.style.borderColor = '#ff3333';

        // Force the "Show Beams" button to appear next to it
        const beamBtn = document.getElementById('beamToggle');
        if (beamBtn) beamBtn.style.display = 'inline-block';

        // Start airplane radar for this region
        if (typeof radarInterval !== 'undefined') clearInterval(radarInterval);
        if (typeof sweepAirspace === 'function') {
            sweepAirspace(lamin, lomin, lamax, lomax);
            window.radarInterval = setInterval(() => sweepAirspace(lamin, lomin, lamax, lomax), 15000);
        }

        // Filter satellites to 500km radius
        let visibleInGrid = 0;
        satBillboards.forEach(entry => {
            if (!entry.sat.position) return;
            const dist = getGroundDistance(lat, lon, entry.sat.position.latitude, entry.sat.position.longitude);
            if (dist > 500000) {
                entry.billboard.show = false;
            } else {
                // Keep it visible if it matches the current orbit filter
                if (currentFilter === 'all' || entry.sat.orbitType === currentFilter || (currentFilter === 'rocketlab' && entry.sat.isRocketLab)) {
                    entry.billboard.show = true;
                    visibleInGrid++;
                }
            }
        });
        
        if (window.logTacticalEvent) {
            window.logTacticalEvent(`GRID ESTABLISHED: ${visibleInGrid} orbital targets in sector.`);
        }

    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
});


loadSatellites();