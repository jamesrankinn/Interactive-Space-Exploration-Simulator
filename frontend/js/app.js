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

// way faster way of drawing thousands of dots
const points = viewer.scene.primitives.add(
new Cesium.PointPrimitiveCollection()
);

// We also keep the full list for searching
let allSatellites = [];

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
    console.log('Received TLE data: ' + rawText.length + ' bytes');

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
        const color = ORBIT_TYPES[orbitType].color;
        counts[orbitType]++;
        
        // Store the position and orbit type on the satellite object for info panel
        sat.position = pos;
        sat.orbitType = orbitType;

        // now we know location and what color we can place dot on the globe (enhance visual later probaly*****)
        // Cesium needs meters
        points.add({
            position: Cesium.Cartesian3.fromDegrees(
                pos.longitude,
                pos.latitude,
                pos.altitude * 1000 // kms to meters
            ),
            // ****************** Dot********
            pixelSize: 5,
            color: Cesium.Color.fromCssColorString(color),
            // ?
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            id: sat

        // ********** Invert globe view from ground POV method add after *******
        // *****************************************************************
        });

        rendered++; // each satellite we've rendered
    });

    allSatellites = satellites.filter(s => s.position); //only ones that rendered

    // Update UI
    document.getElementById('loading').style.display = 'none';
    document.getElementById('searchBox').style.display = 'block';

    const statsDiv = document.getElementById('stats');
    statsDiv.style.display = 'block';
    statsDiv.innerHTML =
        'Total: <span>' + rendered + '</span>' +
        ' &nbsp;|&nbsp; LEO: <span>' + counts.LEO + '</span>' +
        ' &nbsp;|&nbsp; MEO: <span>' + counts.MEO + '</span>' +
        ' &nbsp;|&nbsp; GEO: <span>' + counts.GEO + '</span>' +
        ' &nbsp;|&nbsp; HEO: <span>' + counts.HEO + '</span>';
    
    console.log('Rendered ' + rendered + ' satellites');

    // Now set up interactivity for clicks
    setupClickHandler();
    setupSearch();

} catch (error) {
    console.error('Failed:', error);
    document.getElementById('loading').textContent = 'Error: ' + error.message;
}
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
        // we picked a satellite so we look it up
        const sat = picked.id;
        showInfoPanel(sat);
        flyToSatellite(sat);
    } else {
        // clicked empty space
        // shouldn't be a porblem once i swap dots for better visual
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

// passing over to html to display info pannel
content.innerHTML = 
'<h3>' + sat.name + '</h3>' +

// Orbit type badge (colored to match the dot)
'<span class="orbit-badge" style="background:' + orbitInfo.color + '; color:#000;">' +
    sat.orbitType + ' — ' + orbitInfo.label +
'</span>' +

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
        resultsDiv.innerHTML = matches.map(sat => {
            const orbitInfo = ORBIT_TYPES[sat.orbitType];
            return '<div class="search-result" data-sat-name="' + sat.name + '">' +  // Use data-sat-name for uniqueness
                sat.name +
                '<span class="orbit-tag" style="background:' + orbitInfo.color + '; color:#000;">' +
                sat.orbitType +
                '</span>' +
            '</div>';
            }).join('');

            resultsDiv.style.display = 'block';
        });

        // user clicks best choice from list
        resultsDiv.addEventListener('click', function (e) {
            const resultEl = e.target.closest('.search-result');
            if (resultEl && resultEl.dataset.satName) {
            const satName = resultEl.dataset.satName;
            const sat = allSatellites.find(s => s.name === satName);
            if (sat) {
                showInfoPanel(sat);
                flyToSatellite(sat);
                resultsDiv.style.display = 'none';
                input.value = sat.name;
            }
        }
        });
        // Global click to hide results (add once)
        document.addEventListener('click', function (e) {
            if (!e.target.closest('#searchBox')) {
            resultsDiv.style.display = 'none';
            }
        });
}
    
// Run it
loadSatellites();