// Main Application

// Sets Cesium Globe
// Fetches TLE data from CelesTrak
// uses function from satellites.js to parse & compute positions
// draws dots
// handles clicking on satellites for details
// handles filtering and searching

// uses satellite.js functions

Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJmMjFlODNmMi04Njc5LTRkYWYtYjY2MS01ZTY5NWI4ODZiNDYiLCJpZCI6Mzk4NDEwLCJpYXQiOjE3NzI2OTA4MTV9.u6hd3Ctfcx0zerpizKuLsALR2m7q0B1lXYNYlyUc5KI';

// ************************************************************
const MAX_SATS = 5000; // lower if doesn't run well on macbook

// Create the Viewer
const viewer = new Cesium.Viewer('cesiumContainer', {
    baseLayerPicker: false,     // Don't let user switch map styles
    geocoder: false,            // No search bar
    homeButton: false,          // No "reset view" button
    sceneModePicker: false,     // No 2D/3D toggle
    navigationHelpButton: false,// No help button
    timeline: false,            // No timeline bar at bottom
    animation: false,           // No clock widget
    fullscreenButton: false,    // No fullscreen button
    infoBox: false              // Build custom later for personalization
});

// Black out the globe base color
viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#050505');

// Enable dynamic lighting (makes the dark side of the earth actually dark)
viewer.scene.globe.enableLighting = true;

// Ensure glowing dots don't render through the earth
viewer.scene.globe.depthTestAgainstTerrain = true;

// Holographic atmosphere styling (Cyan/Blue shift)
viewer.scene.skyAtmosphere.hueShift = -0.4; // Shifts toward blue/cyan
viewer.scene.skyAtmosphere.brightnessShift = 0.2;
viewer.scene.skyAtmosphere.saturationShift = 0.5;

// Optional: Hide the default stars/skybox if you want a pure black background
// viewer.scene.skyBox.show = false;
// ****************** switch to office location ************
// *****************************************************
// ******************************************************
viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(
    -123.50,   // longitude: Langford, BC
    48.45,     // latitude: Langford, BC
    20000000   // altitude: 20,000 km up (in meters)
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
                1000000,    // at 1,000 km: full opacity
                1.0,
                300000000,  // at 300,000 km: reduced opacity
                0.4
                ),
                // Scale dots when camera is far away so they can stay visible
                scaleByDistance: new Cesium.NearFarScalar(
                    1000000, 1.5,    // close: 1.5x size
                    100000000, 0.6   // far: 0.6x size
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
        // Fetch ML anomalies from backend
        fetchAnomalies();
        // Trigger the ML pipeline fetch after baseline render is complete
        await fetchAnomalies();

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
        } else if (filter === 'anomaly') {
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

    // Show coverage beams for Rocket Lab filter, clear for everything else
    updateStats(visibleCount, counts);
    clearBeams();
    // Show beam toggle button for group filters (not "all")
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

    if (Cesium.defined(picked) && picked.id && picked.id.satrec) {
        // we picked a satellite so we look it up
        const sat = picked.id;
            clearBeams();     // clear group beams
            showInfoPanel(sat);
            flyToSatellite(sat);
            addBeam(sat); // comment if getting annoying on clicks
    } else {
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

                matched++;
            } else {
                sat.isAnomaly = false;
                sat.anomalyData = null;
            }
        });

        console.log('Tactical override complete: ${matched} targets flagged on globe.');

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

// Ground POV
window.isGroundPOV = false;
window.userLocation = { lon: -123.50, lat: 48.45 }; // Default fallback my city
const orbitalViewHeight = 20000000;

// Fetch user location on site load
if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
        (position) => {
            // Reassign the whole object to ensure it stays intact
            window.userLocation = {
                lon: position.coords.longitude,
                lat: position.coords.latitude
            };
            console.log("Locked onto real-time coordinates:", window.userLocation);
        },
        (error) => console.warn("Location access denied. Using fallback.")
    );
}

document.getElementById('groundPOVBtn').addEventListener('click', function () {
    isGroundPOV = !isGroundPOV;
    const btn = this;

    if (isGroundPOV) {
        // Fly down to 50 meters
        viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(
                window.userLocation.lon,
                window.userLocation.lat,
                50 
            ),
            orientation: { 
                heading: 0,   
                pitch: Cesium.Math.toRadians(-15),
                roll: 0.0
            },
            duration: 3.0,
            complete: function() {
                // Tilt camera up into the sky
                viewer.camera.setView({
                    orientation: {
                        heading: 0,
                        pitch: Cesium.Math.toRadians(85), // Looking up
                        roll: 0.0
                    }
                });
                
                // Trigger beams
                if (typeof showBeamsForGroup === 'function') {
                    showBeamsForGroup();
                }
            }
        });
        
        btn.textContent = 'Orbital View';
        btn.style.background = 'rgba(100,255,200,0.35)';
        btn.style.borderColor = 'rgba(100,255,200,0.8)';
        
    } else {
        // Return to space
        viewer.camera.flyTo({ 
            destination: Cesium.Cartesian3.fromDegrees(
                window.userLocation.lon,
                window.userLocation.lat,
                orbitalViewHeight
            ),
            orientation: {
                heading: 0,
                pitch: Cesium.Math.toRadians(-90), // Look straight down
                roll: 0
            },
            duration: 2.5,
            complete: function() {
                if (typeof clearBeams === 'function') {
                    clearBeams();
                }
                const beamToggle = document.getElementById('beamToggle');
                if (beamToggle) {
                    beamToggle.classList.remove('active');
                    beamToggle.textContent = 'Show Beams';
                }
            }
        });
        
        btn.textContent = 'Ground POV';
        btn.style.background = 'rgba(20,40,30,0.6)';
        btn.style.borderColor = 'rgba(100,255,200,0.5)';
    }
});

loadSatellites();