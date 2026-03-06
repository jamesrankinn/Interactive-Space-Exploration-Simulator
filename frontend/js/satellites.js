// All satellite data logic

// No cesium or UI code
// Hadnles parsing TLEs, calculating positions, classifying orbits.
// In case I want to swap Cesium for a cooler display 3D library then just got to modify app.js

// ORBIT TYPES
// industry category standards
const ORBIT_TYPES = {
LEO: { label: 'Low Earth Orbit',    minAlt: 0,     maxAlt: 2000,  color: '#ff6b6b' },
MEO: { label: 'Medium Earth Orbit', minAlt: 2000,  maxAlt: 35000, color: '#ffd93d' },
GEO: { label: 'Geostationary',      minAlt: 35000, maxAlt: 36500, color: '#6bcbff' },
HEO: { label: 'High Earth Orbit',   minAlt: 36500, maxAlt: 999999,color: '#c084fc' }
};


// Same thing but returns a label string (we use this in stats) classifying orbits
function getOrbitType(altitudeKm) {
    if (altitudeKm < 2000) return 'LEO';
    if (altitudeKm < 35000) return 'MEO';
    if (altitudeKm < 36500) return 'GEO';
    return 'HEO';
}

// Parse text -> turn raw text into satellite objects (array return)
// extract key orbiral parameters as plain numbers to display and for feed in anomaly detection.
function parseTLEs(rawText) {
    const lines = rawText.trim().split('\n').map(line => line.trim());
    const sats = [];

    for (let i = 0; i < lines.length - 2; i += 3) {
        const name = lines[i];
        const line1 = lines[i + 1];
        const line2 = lines[i + 2];

        // basic validation check
        if (!line1.startsWith('1 ') || !line2.startsWith('2 ')) {
            continue; // skip improper data
        }

        try {
            // Parse all TLE lines into a satrec object for SGP4 to use.
            const satrec = satellite.twoline2satrec(line1, line2);
            
            sats.push({
                name: name,
                satrec: satrec,
                // values we are pulling out
                eccentricity: satrec.ecco, // how circular 0 = circle
                bstar: satrec.bstar, // drag coefficent -- higher is more drag
                inclination: satrec.inclo * 180 / Math.PI, // radians to degrees 
                meanMotion: satrec.no * 1440 / (2 * Math.PI) // convert revolutions to days (times orbits earth per day)
            });
        } catch (e){
            // ignore TLEs that are malformed
        }
    }
    return sats;
}

// We need to know where the satellite is at any given moment POSITION
/*
SGP4 does the bulk of the work here
satreec and time -> calculates 3D position -> convert to long, lat, and alt -> place dots and add alt layers.
*/
function getPosition(satrec, time){
    // run SGP4
    const result = satellite.propagate(satrec, time);

    // if unsuccessfull
    if (!result.position) return null;

    // GMST is the angle of earth's rotation at our time t 
    const gmst = satellite.gstime(time);

    // space coordiantes are not the same as planet coordinates (convert "TEME" to long/lat)
    const geo = satellite.eciToGeodetic(result.position, gmst);

    return{
        latitude: satellite.degreesLat(geo.latitude),
        longitude: satellite.degreesLong(geo.longitude),
        altitude: geo.height,
        velocity: Math.sqrt(
            result.velocity.x **2 +
            result.velocity.y ** 2 +
            result.velocity.z ** 2
            )
        };
}

// Rocket Lab Identification
// Electron Rocket tracked by NORAD list contains everything by NORAD

// CelesTrak names do not come out perfect **********************************************
// *****************************************************
const ROCKET_LAB_TERMS = [
  'electron',        // Rocket body / debris
  'photon',          // Rocket Lab's satellite bus
  'capella',         // Capella Space (RL customer)
  'sequoia',         // Capella constellation
  'kineis',          // Kineis IoT satellites (launched on Electron)
  'hawk',            // HawkEye 360 (frequent RL customer)
  'strix',           // Synspective SAR satellites
  'globalstar',      // Globalstar (some on Electron)
  'owl',             // Some cubesats launched by RL
  'bro',             // Unseenlabs BRO satellites
];

function isRocketLab(satName) {
  const lower = satName.toLowerCase();
  return ROCKET_LAB_TERMS.some(term => lower.includes(term));
}