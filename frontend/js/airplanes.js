// --- ATMOSPHERIC RADAR SYSTEM (DYNAMIC) ---
window.activeAircraft = {}; 
let aircraftBillboards;
let radarInterval;

function initRadarSystem(cesiumViewer) {
    if (!aircraftBillboards) {
        aircraftBillboards = cesiumViewer.scene.primitives.add(new Cesium.BillboardCollection());
    }
    console.log("Atmospheric radar ready. Awaiting region coordinates...");
}

// Now accepts a specific region to scan
async function sweepAirspace(lamin, lomin, lamax, lomax) {
    const OPENSKY_URL = `https://opensky-network.org/api/states/all?lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`;
    
    try {
        const response = await fetch(OPENSKY_URL);
        if (!response.ok) throw new Error(`Radar blocked: HTTP ${response.status}`);
        
        const data = await response.json();
        if (!data.states) throw new Error("Airspace empty.");

        console.log(`Radar lock: ${data.states.length} live targets found.`);
        if (window.logTacticalEvent) {
            window.logTacticalEvent(`RADAR PING: ${data.states.length} atmospheric contacts found.`);
        }
        processRadarData(data.states);

    } catch (error) {
        console.warn(`Live feed severed (${error.message}). Injecting tactical ghosts for UI testing.`);
        
        // GHOST PLANES: Dynamically spawned inside whatever region you are looking at
        const centerLat = (lamin + lamax) / 2;
        const centerLon = (lomin + lomax) / 2;
        
        const ghostStates = [
            ['GHOST1', 'MIL-C17', centerLon + 0.1, centerLat + 0.1, 8000, null, null, null, null, 220, 45],
            ['GHOST2', 'AWACS', centerLon - 0.2, centerLat - 0.1, 12000, null, null, null, null, 180, 120],
            ['GHOST3', 'UAV-X', centerLon + 0.05, centerLat - 0.2, 5000, null, null, null, null, 300, 270]
        ];
        console.log(`Radar lock: ${data.states.length} live targets found.`);
        if (window.logTacticalEvent) {
            window.logTacticalEvent(`RADAR PING: ${data.states.length} atmospheric contacts found.`);
        }
        processRadarData(data.states);
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
            const entry = window.activeAircraft[icao24];
            entry.billboard.position = position;
            entry.billboard.rotation = -rotationRadians;
            entry.data = { callsign, baro_alt, velocity, heading };
        } else {
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

    Object.keys(window.activeAircraft).forEach(icao24 => {
        if (!currentSweepIds.has(icao24)) {
            aircraftBillboards.remove(window.activeAircraft[icao24].billboard);
            delete window.activeAircraft[icao24];
        }
    });
}









/*

// Atmospheric Radar System (OpenSky)

// Tactical Bounding Box
//Centered around userlocation -> could add feature for beams or new ground pov to see airplanes.**********

const AIRSPACE = {
    lamin: 46.45,
    lamax: 50.45,
    lomin: -125.50,
    lomax: -121.50
};

// OpenSKY API URL with bounding box parameters
const OPENSKY_URL = `https://opensky-network.org/api/states/all?lamin=${AIRSPACE.lamin}&lomin=${AIRSPACE.lomin}&lamax=${AIRSPACE.lamax}&lomax=${AIRSPACE.lomax}`;

let aircraftBillboards;
window.activeAircraft = {}; // Globally exposed so app.js can read the telemetry && Store aircraft by ICAO24 ID

function initRadarSystem() {
    // Create a dedicated rendering layer for aircraft
    aircraftBillboards = cesiumViewer.scene.primitive.add(
        new Cesium.BillboardCollection()
    );

    console.log("Atmospheric radar initialized. Commencing Local airspace sweep...");

    // Initial sweep
    sweepAirspace();

    // OpenSky public API rate limits are strict.
    // Can ping every 15 seconds and stay under the limit.
    setInterval(sweepAirspace, 15000);
}

async function sweepAirspace() {
    try {
        const response = await fetch(OPENSKY_URL);
        
        // If OpenSky rate-limits us, throw to the catch block to spawn ghost planes
        if (!response.ok) throw new Error(`Radar interference: HTTP ${response.status}`);
        
        const data = await response.json();
        const states = data.states;
        
        if (!states) {
            console.log("Airspace empty. No transponders detected.");
            return;
        }

        processRadarData(states);

    } catch (error) {
        console.warn("Live radar feed severed. Injecting simulated tactical ghosts for UI testing.");
        
        // SIMULATED GHOST PLANES (For when OpenSky blocks your IP)
        const ghostStates = [
            ['GHOST1', 'MIL-C17', -123.6, 48.5, 4500, null, null, null, null, 220, 45],
            ['GHOST2', 'AWACS', -123.4, 48.4, 8000, null, null, null, null, 180, 120],
            ['GHOST3', 'UAV-X', -123.5, 48.6, 12000, null, null, null, null, 300, 270]
        ];
        processRadarData(ghostStates);
    }
}

// Separated the processing logic to handle both live and ghost data
function processRadarData(states) {
    const currentSweepIds = new Set();

    states.forEach(state => {
        const icao24 = state[0];
        const callsign = state[1] ? state[1].trim() : "UNKNOWN";
        const lon = state[5];
        const lat = state[6];
        const baro_alt = state[7] || 5000; // Default to 5km if altitude is missing
        const velocity = state[9] || 0; 
        const heading = state[10] || 0; 

        if (lon === null || lat === null) return;

        currentSweepIds.add(icao24);

        const position = Cesium.Cartesian3.fromDegrees(lon, lat, baro_alt);
        const rotationRadians = Cesium.Math.toRadians(heading - 90);

        if (window.activeAircraft[icao24]) {
            const entry = window.activeAircraft[icao24];
            entry.billboard.position = position;
            entry.billboard.rotation = -rotationRadians;
            entry.data = { callsign, baro_alt, velocity, heading };
        } else {
            const billboard = aircraftBillboards.add({
                position: position,
                image: aircraftTexture,
                width: 24,
                height: 24,
                rotation: -rotationRadians,
                alignedAxis: Cesium.Cartesian3.UNIT_Z,
                id: { type: 'aircraft', icao24: icao24 }
            });

            window.activeAircraft[icao24] = {
                billboard: billboard,
                data: { callsign, baro_alt, velocity, heading }
            };
        }
    });

    Object.keys(window.activeAircraft).forEach(icao24 => {
        if (!currentSweepIds.has(icao24)) {
            aircraftBillboards.remove(window.activeAircraft[icao24].billboard);
            delete window.activeAircraft[icao24];
        }
    });
}
*/