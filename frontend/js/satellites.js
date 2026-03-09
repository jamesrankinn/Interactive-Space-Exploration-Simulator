// =============================================================================
// satellites.js — Orbital Constants & Classification Utilities
//
//     - ORBIT_TYPES constant: used by app.js search results for color-coding
//     - getOrbitType(): For any frontend code that may call it locally
//     - isRocketLab():  For filtering without a server round-trip
//
// =============================================================================

// Orbit type definitions 
const ORBIT_TYPES = {
    LEO: { label: 'Low Earth Orbit',    minAlt: 0,     maxAlt: 2000,   color: '#ff6b6b' },
    MEO: { label: 'Medium Earth Orbit', minAlt: 2000,  maxAlt: 35000,  color: '#ffd93d' },
    GEO: { label: 'Geostationary',      minAlt: 35000, maxAlt: 36500,  color: '#6bcbff' },
    HEO: { label: 'High Earth Orbit',   minAlt: 36500, maxAlt: 999999, color: '#c084fc' }
};

// Local orbit classification 
function getOrbitType(altitudeKm) {
    if (altitudeKm < 2000)  return 'LEO';
    if (altitudeKm < 35000) return 'MEO';
    if (altitudeKm < 36500) return 'GEO';
    return 'HEO';
}

// String ops on locally-available data
const ROCKET_LAB_TERMS = [
    'electron', 'photon', 'capella', 'sequoia', 'kineis',
    'hawk', 'strix', 'globalstar', 'owl', 'bro',
];
function isRocketLab(satName) {
    const lower = satName.toLowerCase();
    return ROCKET_LAB_TERMS.some(term => lower.includes(term));
}