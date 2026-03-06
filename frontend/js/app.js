// Main Application

// Sets Cesium Globe
// Fetches TLE data from CelesTrak
// uses function from satellites.js to parse & compute positions
// draws dots
// handles clicking on satellites for details
// handles filtering and searching

// uses satellite.js functions

Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJmMjFlODNmMi04Njc5LTRkYWYtYjY2MS01ZTY5NWI4ODZiNDYiLCJpZCI6Mzk4NDEwLCJpYXQiOjE3NzI2OTA4MTV9.u6hd3Ctfcx0zerpizKuLsALR2m7q0B1lXYNYlyUc5KI';

// ==========================================
// --- GLOBALS & TACTICAL LOCATION ---
// ==========================================
window.userLocation = { lon: -123.50, lat: 48.45 }; // Default fallback (Langford)
const orbitalViewHeight = 20000000;

// Fetch user location quietly in the background
if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
        (position) => {
            window.userLocation = { lon: position.coords.longitude, lat: position.coords.latitude };
        },
        (error) => console.warn("Location access denied. Using fallback.")
    );
}

const MAX_SATS = 5000; // lower if doesn't run well on macbook

// Create the Viewer
// 1. Create the base Viewer (NO terrain inside here!)
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

// 2. Set Globe tactical styling
viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#050505');
viewer.scene.globe.enableLighting = true;
viewer.scene.globe.depthTestAgainstTerrain = true;
viewer.scene.skyAtmosphere.hueShift = -0.4;
viewer.scene.skyAtmosphere.brightnessShift = 0.2;
viewer.scene.skyAtmosphere.saturationShift = 0.5;

// 3. ASYNC TERRAIN (This brings the Earth back!)
Cesium.createWorldTerrainAsync({
    requestWaterMask: true, 
    requestVertexNormals: true 
}).then(function(terrainProvider) {
    viewer.terrainProvider = terrainProvider;
    console.log("3D Terrain online.");
}).catch(function(error) {
    console.warn("Terrain failed to load:", error);
});

// 4. ASYNC BUILDINGS (Ensure you deleted the old createOsmBuildings line!)
Cesium.createOsmBuildingsAsync().then(function(buildings) {
    viewer.scene.primitives.add(buildings);
    console.log("3D Cityscapes online.");
}).catch(function(error) {
    console.warn("Failed to load 3D cities:", error);
});

// Black out the globe base color
viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#050505');
viewer.scene.globe.enableLighting = true;
viewer.scene.globe.depthTestAgainstTerrain = true;
viewer.scene.skyAtmosphere.hueShift = -0.4;
viewer.scene.skyAtmosphere.brightnessShift = 0.2;
viewer.scene.skyAtmosphere.saturationShift = 0.5;

// FIX: Swapped to createOsmBuildingsAsync and wrapped in a Promise
Cesium.createOsmBuildingsAsync().then(function(buildings) {
    viewer.scene.primitives.add(buildings);
}).catch(function(error) {
    console.warn("Failed to load 3D cities:", error);
});

// Black out the globe base color
viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#050505');

// Enable dynamic lighting (makes the dark side of the earth actually dark)
viewer.scene.globe.enableLighting = true;

// 3D buildings
viewer.scene.primitives.add(Cesium.createOsmBuildings());

// Ensure glowing dots don't render through the earth
viewer.scene.globe.depthTestAgainstTerrain = true;

// Holographic atmosphere styling (Cyan/Blue shift)
viewer.scene.skyAtmosphere.hueShift = -0.4; // Shifts toward blue/cyan
viewer.scene.skyAtmosphere.brightnessShift = 0.2;
viewer.scene.skyAtmosphere.saturationShift = 0.5;

// uncomment to get rid of the stars
// viewer.scene.skyBox.show = false;

viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(
        window.userLocation.lon,
        window.userLocation.lat,
        orbitalViewHeight // 50 meters above the ground
    ),
    duration: 0
});

// might need this so we're not missing improper names
function isRocketLab(name) {
  const lower = name.toLowerCase();
  return lower.includes('rocket') || lower.includes('electron') || 
         lower.includes('photon') || lower.includes('capella') || 
         lower.includes('hawk') || lower.includes('strix') || lower.includes('scot');
}

// New Visual Textures (temp hopefully until I can integrate realism)
// temp glowing dot texture
/*
function createGlowTexture(color, size) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Radial gradient: bright center and transparent edge
    const gradient = ctx.createRadialGradient(
        size / 2, size / 2, 0, // inner
        size / 2, size / 2, size / 2 // outter circle
    )
    // random color settings
    gradient.addColorStop(0, color);
    gradient.addColorStop(0.3, color);
    gradient.addColorStop(0.6, color + '88');
    gradient.addColorStop(1, 'transparent');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    return canvas;
}
*/
//nanobananna svg image of satellites dots are commented out above
// Generates a sharp, tactical SVG marker as a Data URI
function createTacticalMarker(color) {
    const svg = `
    <svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
        <path d="M 2 8 L 2 2 L 8 2 M 24 2 L 30 2 L 30 8 M 30 24 L 30 30 L 24 30 M 8 30 L 2 30 L 2 24" 
              fill="none" stroke="${color}" stroke-width="1.5" opacity="0.7"/>
        <polygon points="16,6 26,16 16,26 6,16" 
                 fill="${color}" fill-opacity="0.3" stroke="${color}" stroke-width="1.5"/>
        <circle cx="16" cy="16" r="2" fill="#ffffff"/>
    </svg>`;
    
    // Convert the SVG string to a format Cesium's Billboard can render
    return 'data:image/svg+xml;base64,' + btoa(svg);
}

function createAircraftMarker(color) {
    const svg = `
        <svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <polygon points="12,2 22,20 12,16 2,20" 
                    fill="${color}" fill-opacity="0.6" stroke="${color}" stroke-width="1.5"/>
            <circle cx="12" cy="12" r="1.5" fill="#ffffff"/>
        </svg>`;
        return 'data:image/svg+xml;base64,' + btoa(svg);
}
const aircraftTexture = createAircraftMarker('#ff9900'); // High-visibility radar orange

// Pre-set glow features
const glowTextures = {
  LEO: createTacticalMarker('#ff3333'), // High-alert Red
  MEO: createTacticalMarker('#ffcc00'), // Warning Yellow
  GEO: createTacticalMarker('#00e6e6'), // Tactical Cyan
  HEO: createTacticalMarker('#b366ff')  // Deep Purple
};

// Billboard sizes per orbit (further out are bigger)
const DOT_SIZES = { LEO: 20, MEO: 24, GEO: 28, HEO: 26 };


// Billboard collection 
const billboards = viewer.scene.primitives.add(
  new Cesium.BillboardCollection()
);

// Data Stores
let allSatellites = [];   // We also keep the full list for searching
let satBillboards = [];   // Array of { sat, billboard } pairs (for animation + filtering)
let currentFilter = 'all';



   // MAIN FUNCTION
   /*
   Fetches TLE from CelesTrak

   Parse into satellite objects

   Calculates each satellite's current position

   Then add color dot
   */

   // wait to get TLE info

async function loadSatellites() {
    try {
        console.log('Fetching TLEs from CelesTrak');

        const response = await fetch(
            'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle'
        );
        if (!response.ok) {
            throw new Error('CelesTrak returned error: ' + response.status);
        }

        const rawText = await response.text();

        // parse through all satellites (from satellite.js)
        let satellites = parseTLEs(rawText);

        // Limit to MAX_SATS for ease of demonstration can lower if slow
        if (satellites.length > MAX_SATS) {
            satellites = satellites.slice(0, MAX_SATS);
        }
        console.log('Parsed ' + satellites.length + ' satellites');

        // Calculate positions
        const now = new Date();
        let rendered = 0;
        const counts = { LEO: 0, MEO: 0, GEO: 0, HEO: 0 };

        satellites.forEach(sat => {
            // re calculate where satellite is now (from satellite.js)
            const pos = getPosition(sat.satrec, now);
            
            if (!pos) return;

            // Figure out which orbit type and color (satellite.js)
            const orbitType = getOrbitType(pos.altitude);
            counts[orbitType]++;
            
            // Store the position and orbit type on the satellite object for info panel
            sat.position = pos;
            sat.orbitType = orbitType;
            sat.isRocketLab = isRocketLab(sat.name);

            // glowing billboard instead of plain dot
            const billboard = billboards.add({
                position: Cesium.Cartesian3.fromDegrees(
                    pos.longitude,
                    pos.latitude,
                    pos.altitude * 1000
                ),
                image: glowTextures[orbitType],
                width: DOT_SIZES[orbitType],
                height: DOT_SIZES[orbitType],
                // Translucency settings for the glow effect
                translucencyByDistance: new Cesium.NearFarScalar(
                    2000000, 1.0, 
                    12000000, 0.0 // Fades to 0 opacity at 12,000 km
                ),
                // Scale dots when camera is far away so they can stay visible
                scaleByDistance: new Cesium.NearFarScalar(
                    1000000, 1.0, 
                    12000000, 0.1
                ),
                disableDepthTestDistance: 0,
                id: sat  // attach satellite data for click detection
            });
            // Store the pair so we can update positions later (animation)
            satBillboards.push({ sat: sat, billboard: billboard });
            rendered++;
        });

        allSatellites = satellites.filter(s => s.position); //only ones that rendered

        // Update UI
        document.getElementById('loading').style.display = 'none';
        document.getElementById('controlPanel').style.display = 'block';
        document.getElementById('legend').style.display = 'block';

        updateStats(rendered, counts);
        console.log('Rendered ' + rendered + ' satellites');

        // How many RocketLabs available
        const rlCount = allSatellites.filter(s => s.isRocketLab).length;
        console.log('Found ' + rlCount + ' Rocket Lab related satellites');
        // Now set up interactivity for clicks
        setupClickHandler();
        setupSearch();
        setupFilters();

        startAnimation();

        // Trigger the ML pipeline fetch after baseline render is complete
        await fetchAnomalies();

        // Initialize local airspace radar
        if (typeof initRadarSystem === 'function') {
            initRadarSystem(viewer);
        }

    } catch (error) {
        console.error('Failed:', error);
        document.getElementById('loading').textContent = 'Error: ' + error.message;
    }
}

// Live Animation in Real Time
// Every 2 seconds re-run SGP4 for all satellites to update positions
function startAnimation() {
    setInterval(function () {
        const now = new Date();

        satBillboards.forEach(function (entry) {
            // only update for visible satellites
            if(!entry.billboard.show) return;

            const newPos = getPosition(entry.sat.satrec, now);
            if (!newPos) return;

            // update stored position
            entry.sat.position = newPos;
            //add a pulsing billboard
            entry.billboard.scale = 1.0 + (Math.sin(Date.now() / 2800) * 0.2); // dangerous line
            // Now move billboard to new location
            entry.billboard.position = Cesium.Cartesian3.fromDegrees(
                newPos.longitude,
                newPos.latitude,
                newPos.altitude * 1000
            );
            });
        }, 2000);  // every 2 seconds
    }

    // Filter Buttons
    // Each button has data filter attribute

function setupFilters() {
  const buttons = document.querySelectorAll('.filter-btn');

  buttons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      // Update button styling
      buttons.forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');

      currentFilter = btn.dataset.filter;
      applyFilter(currentFilter);
    });
  });
}

function applyFilter(filter) {
    let visibleCount = 0;
    const counts = { LEO: 0, MEO: 0, GEO: 0, HEO: 0 };

    satBillboards.forEach(function (entry) {
        const sat = entry.sat;
        let show = false;

        if (filter === 'all') {
            show = true;
        } else if (filter === 'rocketlab') {
            show = sat.isRocketLab;
        } else if (filter === 'isolation' || filter === 'anomaly') {
            // Tactical Isolation Mode: Only show the ML anomalies
            show = sat.isAnomaly === true;
        } else {
            show = sat.orbitType === filter;
        }

        entry.billboard.show = show;

        if (show) {
            visibleCount++;
            counts[sat.orbitType]++;
        }
    });

    // Darken the globe significantly in Isolation Mode for better contrast
    if (filter === 'isolation') {
        viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#020202');
        viewer.scene.skyAtmosphere.brightnessShift = -0.5; // Dim the sky
    } else {
        viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#050505');
        viewer.scene.skyAtmosphere.brightnessShift = 0.2; // Restore normal
    }

    updateStats(visibleCount, counts);
    clearBeams();
    
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

// Dot click handler
// Should work a lot better once I add replacement for the dots
// DELETE comment once done

// user clicks somewhere on screen
// viewer.scene.pick() casts a ray from taht screen pixel into the 3D scene
// If ray hits a PointPrimitive it returns that point
// We look up that point in map to get satellite data
// We fill the info panel with Satellites details

function setupClickHandler() {
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

    handler.setInputAction(function (click) {
    // Cast a ray from the click position
    const picked = viewer.scene.pick(click.position);

    if (Cesium.defined(picked) && picked.id) {
        // ROUTE 1: Airplane
        if (picked.id.type === 'aircraft') {
            clearBeams(); // Keep airspace clean
            showAircraftPanel(picked.id.icao24);
            flyToAircraft(picked.id.icao24);
        } 
        // ROUTE 2: Satellite
        else if (picked.id.satrec) {
            const sat = picked.id;
            clearBeams();     
            showInfoPanel(sat);
            flyToSatellite(sat);
            addBeam(sat); 
        }
    } else {
        // clicked empty space
        document.getElementById('infoPanel').style.display = 'none';
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
}

// Info Panel
function showInfoPanel(sat) {
    const panel = document.getElementById('infoPanel');
    const content = document.getElementById('infoPanelContent');
    const pos = sat.position;
    const orbitInfo = ORBIT_TYPES[sat.orbitType];

    // Rocket Lab badge if applicable
    const rlBadge = sat.isRocketLab
    ? ' <span class="orbit-badge" style="background:#00dc82; color:#000;">Rocket Lab</span>'
    : '';

    // passing over to html to display info pannel
    content.innerHTML = 
    '<h3>' + sat.name + '</h3>' +

    // Orbit type badge (colored to match the dot)
    '<span class="orbit-badge" style="background:' + orbitInfo.color + '; color:#000;">' +
        sat.orbitType + ' — ' + orbitInfo.label +
    '</span>' +
    rlBadge +
    // Anomaly badge if ML flagged this satellite
    (sat.isAnomaly ? ' <span class="orbit-badge" style="background:#ff2222; color:#fff;">ML ANOMALY</span>' : '') +
    // Show anomaly reasons if available
    (sat.anomalyData && sat.anomalyData.reasons.length > 0 ?
        '<div style="margin-top:10px; padding:8px; background:rgba(255,50,50,0.1); border:1px solid rgba(255,50,50,0.3); border-radius:8px; font-size:11px;">' +
        '<div style="color:#ff6666; font-weight:600; margin-bottom:4px;">Anomaly Reasons:</div>' +
        sat.anomalyData.reasons.map(function(r) {
            return '<div style="color:#ffaaaa;">• ' + r.feature + ': ' + r.value + ' (z=' + r.z_score + ', ' + r.direction + ')</div>';
        }).join('') +
        '<div style="color:#888; margin-top:4px;">Score: ' + sat.anomalyData.score + '</div></div>'
    : '') +

    // Data rows
    '<div style="margin-top: 14px;">' +
        infoRow('Altitude',     pos.altitude.toFixed(1) + ' km') +
        infoRow('Latitude',     pos.latitude.toFixed(4) + '°') +
        infoRow('Longitude',    pos.longitude.toFixed(4) + '°') +
        infoRow('Velocity',     pos.velocity.toFixed(2) + ' km/s') +
        infoRow('Inclination',  sat.inclination.toFixed(2) + '°') +
        infoRow('Eccentricity', sat.eccentricity.toFixed(6)) +
        infoRow('Mean Motion',  sat.meanMotion.toFixed(4) + ' rev/day') +
        infoRow('BSTAR Drag',   sat.bstar.toExponential(4)) +
    '</div>';

    panel.style.display = 'block';
    
}
// ATMOSPHERIC UI 
function showAircraftPanel(icao24) {
    const panel = document.getElementById('infoPanel');
    const content = document.getElementById('infoPanelContent');
    
    // Pull the live telemetry from the radar engine
    const aircraft = window.activeAircraft[icao24];
    if (!aircraft) return;

    const data = aircraft.data;

    // Tactical UI generation for aircraft
    content.innerHTML = 
        '<h3>' + data.callsign + '</h3>' +
        '<span class="orbit-badge" style="background:#ff9900; color:#000;">ATMOSPHERIC RADAR</span>' +
        '<div style="margin-top: 14px;">' +
            infoRow('ICAO24 Hex', icao24.toUpperCase()) +
            infoRow('Altitude', data.baro_alt.toFixed(0) + ' m') +
            infoRow('Velocity', data.velocity.toFixed(1) + ' m/s') +
            infoRow('Heading', data.heading.toFixed(1) + '°') +
        '</div>';

    panel.style.display = 'block';
}

function flyToAircraft(icao24) {
    const aircraft = window.activeAircraft[icao24];
    if (!aircraft) return;
    
    // Extract the precise 3D Cartesian coordinates
    const cartesianPos = aircraft.billboard.position.getValue(viewer.clock.currentTime) || aircraft.billboard.position;
    
    // Convert to map coordinates so we can safely add altitude
    const cartographic = Cesium.Cartographic.fromCartesian(cartesianPos);
    
    // Fly the camera to a tactical chase position (3km directly above the aircraft)
    viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromRadians(
            cartographic.longitude,
            cartographic.latitude,
            cartographic.height + 3000 
        ),
        duration: 1.5
    });
}

// extra function to create one row in the info panel
function infoRow(label, value) {
return '<div class="info-row">' +
'<span class="info-label">' + label + '</span>' +
'<span class="info-value">' + value + '</span>' +
'</div>';
}

// Ensure smooth flight path from camera towards clicked satellite
function flyToSatellite(sat) {
const pos = sat.position;
viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(
        pos.longitude,
        pos.latitude,
        pos.altitude * 1000 + 500000 // try 500km above the satellite
    ),
    duration: 1.5 // animation duration in seconds
});
}

// provide close button for the info panel
document.getElementById('closePanel').addEventListener('click', function () {
document.getElementById('infoPanel').style.display = 'none';
});

// Search to find satellites by name "rocket lab?"
// *******************************************
// clicking a result shoulf fly camera to that satellite and show info

function setupSearch() {
    const input = document.getElementById('searchInput');
    const resultsDiv = document.getElementById('searchResults');

    input.addEventListener('input', function () {
        const query = input.value.trim().toLowerCase();

        // add some small cases for search run time
        if (query.length < 2 ) {
            resultsDiv.style.display = 'none';
            return;
        }

        // Find satellites with matching texts
        const matches = allSatellites
            .filter(sat => sat.name.toLowerCase().includes(query))
            .slice(0, 20); // max 20 results shouldn't ever go that high

        // catch if no matches are found display message
        if (matches.length === 0) {
            resultsDiv.innerHTML = '<div class="search-result" style="color:#667">No matches found</div>';
            resultsDiv.style.display = 'block';
            return;
        }

        // Construct results list
        resultsDiv.innerHTML = matches.map(function (sat) {
            const orbitInfo = ORBIT_TYPES[sat.orbitType];
            const rlTag = sat.isRocketLab
                ? '<span class="orbit-tag" style="background:#00dc82; color:#000;">RL</span>'
                : '';
            return '<div class="search-result">' +
                sat.name +
                '<span class="orbit-tag" style="background:' + orbitInfo.color + '; color:#000;">' +
                sat.orbitType +
                '</span>' +
                rlTag +
            '</div>';
            }).join('');

            resultsDiv.style.display = 'block';

            resultsDiv.querySelectorAll('.search-result').forEach(function (el, index) {
            el.addEventListener('click', function () {
            const sat = matches[index];
            showInfoPanel(sat);
            flyToSatellite(sat);
            resultsDiv.style.display = 'none';
            input.value = sat.name;
            });
        });
    });
    // Global click to hide results (add once)
    document.addEventListener('click', function (e) {
        if (!e.target.closest('#controlPanel')) {
        resultsDiv.style.display = 'none';
        }
    });
}
// Fetch Anomaly data from Flask backend
// Backend runs IsolationForest on Oribtal features and returns
// NORAD IDs of flagged sattelites
// We match and flag those satellites
async function fetchAnomalies() {
    try {
        console.log('Fetching anomalies from backend');
        const response = await fetch('http://localhost:5000/api/anomalies');
        const data = await response.json();
        console.log(`Backend reports ${data.total_anomalies} anomalies isolated.`);

        // Need to build a lookup: NORAD ID -> anomaly data
        const anomalyMap = {};
        data.anomalies.forEach(function (a) {
            anomalyMap[a.norad_id] = a;
        });

        // Match against our rendered satellites
        // NORAD ID is in the TLE
        // Extract it from the satellite's TLE data
        let matched = 0;

        // Iterate over satBillboards to update the visual markers
        satBillboards.forEach(function (entry) {
            const sat = entry.sat;
            const noradId = parseInt(sat.satrec.satnum);

            // satellite.js stores the catalog number in satrec.satnum
            if (anomalyMap[noradId]) {
                sat.isAnomaly = true;
                sat.anomalyData = anomalyMap[noradId];

                // VISUAL OVERRIDE: Swap to a high-alert red tactical marker and scale it up
                entry.billboard.image = createTacticalMarker('#ff0000');
                // Set base scale slightly larger so anomalies pop out from the crowd
                entry.billboard.scale = 1.3;

                // Force ML Anomalies to be visible from across the globe
                entry.billboard.translucencyByDistance = new Cesium.NearFarScalar(1000000, 1.0, 50000000, 0.9);
                entry.billboard.scaleByDistance = new Cesium.NearFarScalar(1000000, 1.5, 50000000, 0.8);

                matched++;
            } else {
                sat.isAnomaly = false;
                sat.anomalyData = null;
            }
        });

        console.log(`Tactical override complete: ${matched} targets flagged on globe.`);
        if (window.logTacticalEvent) {
            window.logTacticalEvent(`ML OVERRIDE: ${matched} orbital anomalies isolated.`, true);
        }

    } catch (error) {
        console.warn('Backend not available: ' + error.message);
        console.warn('Start ML backend with: cd backend && python app.py');
    }
}

// Beam toggle button
// Only visible when a group filter (like Rocket Lab) is active.
// Clicking it toggles coverage beams on/off for all visible satellites.
document.getElementById('beamToggle').addEventListener('click', function () {
  const btn = document.getElementById('beamToggle');

  if (activeBeams.length > 0) {
    // Beams are on — turn them off
    clearBeams();
    btn.textContent = 'Show Beams';
    btn.classList.remove('active');
  } else {
    // Beams are off — turn them on
    showBeamsForGroup(satBillboards);
    btn.textContent = 'Hide Beams';
    btn.classList.add('active');
  }
});

// ==========================================
// --- TACTICAL MASTER CONTROLS & MATH ---
// ==========================================

// Spherical Math: Calculates distance between two points on the globe in meters
function getGroundDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Earth radius in meters
    const dLat = Cesium.Math.toRadians(lat2 - lat1);
    const dLon = Cesium.Math.toRadians(lon2 - lon1);
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(Cesium.Math.toRadians(lat1)) * Math.cos(Cesium.Math.toRadians(lat2)) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c; 
}

// Generates a live scrolling terminal log in the God's Eye HUD
window.logTacticalEvent = function(message, isAlert = false) {
    const log = document.getElementById('tacticalEventLog');
    if (!log) return;

    // Generate Zulu time timestamp
    const time = new Date().toISOString().substring(11, 19) + 'Z';
    const entry = document.createElement('div');
    
    // Alerts are red, standard logs are cyan/green
    entry.style.color = isAlert ? '#ff3333' : '#00ff96';
    entry.style.textShadow = isAlert ? '0 0 6px #ff3333' : '0 0 4px #00ff96';
    entry.innerHTML = `[${time}] ${message}`;

    log.appendChild(entry);

    // Keep the log clean by removing old entries (max 8 lines)
    if (log.children.length > 8) {
        log.removeChild(log.firstChild);
    }
};

// 1. ISOLATION OVERRIDE (Independent Toggle)
let isIsolationMode = false;
document.getElementById('isolationToggleBtn').addEventListener('click', function() {
    isIsolationMode = !isIsolationMode;
    this.style.background = isIsolationMode ? 'rgba(255,50,50,0.3)' : 'rgba(30,40,60,0.6)';
    this.textContent = isIsolationMode ? '[X] ISOLATION OVERRIDE' : '[ ] ISOLATION OVERRIDE';
    
    // Re-apply whatever the current orbit filter is, but with the override active
    applyFilter(currentFilter);
});

// Update applyFilter to respect the Isolation Override
function applyFilter(filter) {
    let visibleCount = 0;
    const counts = { LEO: 0, MEO: 0, GEO: 0, HEO: 0 };

    satBillboards.forEach(function (entry) {
        const sat = entry.sat;
        let show = false;

        // Base filter logic
        if (filter === 'all') show = true;
        else if (filter === 'rocketlab') show = sat.isRocketLab;
        else show = sat.orbitType === filter;

        // MASTER OVERRIDE: If Isolation is on, force-hide anything that isn't an anomaly
        if (isIsolationMode && !sat.isAnomaly) {
            show = false;
        }

        entry.billboard.show = show;
        if (show) { visibleCount++; counts[sat.orbitType]++; }
    });

    // Darken globe for Isolation Mode
    viewer.scene.globe.baseColor = isIsolationMode ? Cesium.Color.fromCssColorString('#020202') : Cesium.Color.fromCssColorString('#050505');
    viewer.scene.skyAtmosphere.brightnessShift = isIsolationMode ? -0.5 : 0.2;

    updateStats(visibleCount, counts);
    clearBeams();
}

// 2. GOD'S EYE HUD (Decoupled Toggle)
let isGodsEye = false;
let hudInterval;
document.getElementById('godsEyeToggleBtn').addEventListener('click', function() {
    isGodsEye = !isGodsEye;
    const hud = document.getElementById('godsEyeHud');
    this.style.background = isGodsEye ? 'rgba(0,255,150,0.2)' : 'rgba(30,40,60,0.6)';
    this.textContent = isGodsEye ? "[X] GOD'S EYE HUD" : "[ ] GOD'S EYE HUD";
    
    if (isGodsEye) {
        hud.style.display = 'block';
        hudInterval = setInterval(() => {
            const camCartographic = Cesium.Cartographic.fromCartesian(viewer.camera.position);
            document.getElementById('hudLat').textContent = Cesium.Math.toDegrees(camCartographic.latitude).toFixed(4) + '° N';
            document.getElementById('hudLon').textContent = Math.abs(Cesium.Math.toDegrees(camCartographic.longitude)).toFixed(4) + '° W';
            document.getElementById('hudAlt').textContent = (camCartographic.height).toFixed(0) + ' m';
        }, 100);
    } else {
        hud.style.display = 'none';
        clearInterval(hudInterval);
    }
});

// 3. GROUND POV (Manual Coordinates Fallback)
let isGroundPOV = false;

document.getElementById('groundPOVBtn').addEventListener('click', function() {
    isGroundPOV = !isGroundPOV;
    const btn = this;

    if (isGroundPOV) {
        viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(window.userLocation.lon, window.userLocation.lat, 50),
            orientation: { heading: 0, pitch: Cesium.Math.toRadians(85), roll: 0 },
            duration: 3.0
        });
        btn.textContent = 'Orbital View';
        btn.style.background = 'rgba(100,255,200,0.35)';
    } else {
        viewer.camera.flyTo({ 
            destination: Cesium.Cartesian3.fromDegrees(window.userLocation.lon, window.userLocation.lat, 20000000),
            orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
            duration: 2.5
        });
        btn.textContent = 'Ground POV';
        btn.style.background = 'rgba(20,40,30,0.6)';
    }
});

// 4. REGIONAL TARGETING (Click Map to establish radar grid)
let targetingHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
let targetCircle = null;

document.getElementById('regionalTargetBtn').addEventListener('click', function() {
    const btn = this;
    if (btn.classList.contains('active')) {
        // TURN OFF TARGETING
        btn.classList.remove('active');
        btn.style.background = 'rgba(30,40,60,0.6)';
        btn.textContent = 'Target Region (Map Click)';
        if (targetCircle) viewer.entities.remove(targetCircle);
        if (typeof radarInterval !== 'undefined') clearInterval(radarInterval);
        applyFilter(currentFilter); // Restore all sats
        return;
    }

    // TURN ON TARGETING (Wait for user to click globe)
    btn.classList.add('active');
    btn.style.background = 'rgba(255,204,0,0.3)';
    btn.textContent = 'Click globe to set grid...';

    targetingHandler.setInputAction(function (click) {
        if (!btn.classList.contains('active')) return;

        // Get lat/lon of where user clicked
        const earthPosition = viewer.camera.pickEllipsoid(click.position, viewer.scene.globe.ellipsoid);
        if (!earthPosition) return;
        
        const cartographic = Cesium.Cartographic.fromCartesian(earthPosition);
        const lon = Cesium.Math.toDegrees(cartographic.longitude);
        const lat = Cesium.Math.toDegrees(cartographic.latitude);

        // Draw tactical radius (500km)
        if (targetCircle) viewer.entities.remove(targetCircle);
        targetCircle = viewer.entities.add({
            position: Cesium.Cartesian3.fromDegrees(lon, lat),
            ellipse: {
                semiMinorAxis: 500000.0,
                semiMajorAxis: 500000.0,
                material: new Cesium.GridMaterialProperty({
                    color: Cesium.Color.YELLOW.withAlpha(0.2),
                    cellAlpha: 0.0,
                    lineCount: new Cesium.Cartesian2(8, 8),
                    lineThickness: new Cesium.Cartesian2(2.0, 2.0)
                }),
                outline: true, outlineColor: Cesium.Color.YELLOW
            }
        });

        // Calculate Bounding Box (Roughly 5 degrees around click)
        const lamin = lat - 5; const lamax = lat + 5;
        const lomin = lon - 5; const lomax = lon + 5;

        btn.textContent = `Grid Active: ${lat.toFixed(2)}N, ${lon.toFixed(2)}W`;

        // 1. Start Airspace Radar for this specific region
        if (typeof radarInterval !== 'undefined') clearInterval(radarInterval);
        if (typeof sweepAirspace === 'function') {
            sweepAirspace(lamin, lomin, lamax, lomax); // Initial ping
            window.radarInterval = setInterval(() => sweepAirspace(lamin, lomin, lamax, lomax), 15000);
        }

        // 2. Filter Satellites (Hide everything outside the 500km radius)
        satBillboards.forEach(entry => {
            if (!entry.sat.position) return;
            const dist = getGroundDistance(lat, lon, entry.sat.position.latitude, entry.sat.position.longitude);
            // Hide if further than 500km
            if (dist > 500000) entry.billboard.show = false;
        });

    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
});

loadSatellites();