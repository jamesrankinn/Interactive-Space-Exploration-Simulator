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
    // Hit our Flask backend instead of OpenSky directly
    const LOCAL_URL = `http://localhost:5000/api/aircraft?lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`;
    
    const centerLat = (lamin + lamax) / 2;
    const centerLon = (lomin + lomax) / 2;
    const demoStates = [
        ['DEMO1','AC-130J','US',null,null, centerLon+0.15, centerLat+0.1,  6000, false,250,45],
        ['DEMO2','E-3 AWACS','US',null,null, centerLon-0.25, centerLat-0.15, 10000,false,200,120],
        ['DEMO3','MQ-9','US',null,null, centerLon+0.08, centerLat-0.2, 4000, false,180,270],
        ['DEMO4','C-17','US',null,null, centerLon-0.1, centerLat+0.25, 9000, false,300,90],
        ['DEMO5','F-35A','US',null,null, centerLon+0.3, centerLat+0.05, 12000,false,400,200]
    ];
    processRadarData(demoStates);
    if (window.logTacticalEvent) window.logTacticalEvent('RADAR: ' + demoStates.length + ' contacts acquired.');
    return;
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







