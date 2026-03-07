// --- ATMOSPHERIC RADAR SYSTEM (DYNAMIC) ---
window.activeAircraft = {}; 
let aircraftBillboards;

function initRadarSystem(cesiumViewer) {
    if (!aircraftBillboards) {
        aircraftBillboards = cesiumViewer.scene.primitives.add(new Cesium.BillboardCollection());
    }
    console.log("Atmospheric radar ready. Awaiting region coordinates...");
}

// Accepts a bounding box to scan
async function sweepAirspace(lamin, lomin, lamax, lomax) {
    // Route through our Flask backend to avoid CORS/rate-limit issues
    const BACKEND_URL = `http://localhost:5000/api/aircraft?lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`;

    try {
        const response = await fetch(BACKEND_URL);
        if (!response.ok) throw new Error('Backend radar: HTTP ' + response.status);

        const data = await response.json();
        if (!data.states) throw new Error("Airspace empty.");

        console.log('Radar lock: ' + data.states.length + ' live targets.');
        if (window.logTacticalEvent) {
            window.logTacticalEvent('RADAR PING: ' + data.states.length + ' atmospheric contacts.');
        }
        processRadarData(data.states);

    } catch (error) {
        console.warn('Radar feed failed (' + error.message + '). Injecting ghost aircraft.');

        const centerLat = (lamin + lamax) / 2;
        const centerLon = (lomin + lomax) / 2;

        const ghostStates = [
            ['GHOST1', 'MIL-C17', 'US', null, null, centerLon + 0.1,  centerLat + 0.1,  8000,  false, 220, 45],
            ['GHOST2', 'AWACS',   'US', null, null, centerLon - 0.2,  centerLat - 0.1,  12000, false, 180, 120],
            ['GHOST3', 'UAV-X',   'US', null, null, centerLon + 0.05, centerLat - 0.2,  5000,  false, 300, 270]
        ];

        console.log('Injected ' + ghostStates.length + ' ghost targets.');
        if (window.logTacticalEvent) {
            window.logTacticalEvent('GHOST MODE: ' + ghostStates.length + ' simulated contacts.');
        }
        processRadarData(ghostStates);
    }
}

function processRadarData(states) {
    const currentSweepIds = new Set();

    states.forEach(state => {
        const icao24 = state[0];
        const callsign = state[1] ? state[1].trim() : "UNKNOWN";
        const lon = state[5];
        const lat = state[6];
        const baro_alt = state[7] || 5000; 
        const velocity = state[9] || 0; 
        const heading = state[10] || 0; 

        if (lon === null || lat === null) return;
        currentSweepIds.add(icao24);

        const position = Cesium.Cartesian3.fromDegrees(lon, lat, baro_alt);
        const rotationRadians = Cesium.Math.toRadians(heading - 90);

        if (window.activeAircraft[icao24]) {
            // Update exisiting aircraft position
            const entry = window.activeAircraft[icao24];
            entry.billboard.position = position;
            entry.billboard.rotation = -rotationRadians;
            entry.data = { callsign, baro_alt, velocity, heading };
        } else {
            // New aircraft - add billboard
            const billboard = aircraftBillboards.add({
                position: position,
                image: aircraftTexture,
                width: 24, height: 24,
                rotation: -rotationRadians,
                alignedAxis: Cesium.Cartesian3.UNIT_Z,
                id: { type: 'aircraft', icao24: icao24 }
            });
            window.activeAircraft[icao24] = { billboard, data: { callsign, baro_alt, velocity, heading } };
        }
    });
    // Remove aircrafts that disappear from radar
    Object.keys(window.activeAircraft).forEach(icao24 => {
        if (!currentSweepIds.has(icao24)) {
            aircraftBillboards.remove(window.activeAircraft[icao24].billboard);
            delete window.activeAircraft[icao24];
        }
    });
}







