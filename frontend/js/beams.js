// Coverage Beam Visualization

// Translucent Cone down to earth showing the "coverage" area from it's live position.

// Coverage MATH *****************************************
/*
A satellite will be able to see within its horizon circle
radius of that circle depends on altitude: radius = sqrt(altitude * (2 * earthRadius + altitude))
Higher satellites will see more ground (LEO as refernce sees 2500km)

Need to integrate this idea into CESIUM
- Each beam = 2 Cesium Entities:
1. A cylinder: cone shape from satellite down ("alien beam style")
2. An ellipse: circle on the ground ("cloud")

USAGE (call from app.js)
    addBeam(sat) - draw one beam for a clicked satellite
    showBeamsForGroup() - draw beams for all visible satellites
    clearBeams() - remove all present beams.
*/

const EARTH_RADIUS = 6371000; //meters (if numbers are off reminder much is in kms)

// store all beam entities so we can remove them later
let activeBeams = [];

// Beam color per orbit type (match satellite colours but more holographic and pulsing)
const BEAM_COLORS = {
  LEO: Cesium.Color.fromCssColorString('#00f0ff').withAlpha(0.09),
  MEO: Cesium.Color.fromCssColorString('#ffd93d').withAlpha(0.09),
  GEO: Cesium.Color.fromCssColorString('#6bcbff').withAlpha(0.09),
  HEO: Cesium.Color.fromCssColorString('#c084fc').withAlpha(0.09)
};

// Need coverage Radius r = sqrt(h(2R + h))
function getCoverageRadius(altitudeKm) {
    const h = altitudeKm * 1000; // convert to meters
    const R = EARTH_RADIUS;
    
    // Geometric horizon scaled to 40% for realistic sensor FOV
    let radius = Math.sqrt(h * (2 * R + h)) * 0.4;
    
    // Cap at 3000km so GEO satellites don't cover the entire screen
    return Math.min(radius, 3000000); 
}

// Haversine formula allows us to calculate sperical distance so we can 
// only show beams for relevant satellites 
function getGroundDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // in meters
    const dLat = Cesium.Math.toRadians(lat2 - lat1); // distance between will always be +
    const dLon = Cesium.Math.toRadians(lon2 - lon1);

    // square of half the chord length between the points
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(Cesium.Math.toRadians(lat1)) * Math.cos(Cesium.Math.toRadians(lat2)) *
        Math.sin(dLon/2) * Math.sin(dLon/2);

    // The angular distance in radians
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c; // Distance in meters
}

function addBeam(sat) {
    const pos = sat.position;
    if (!pos) return;

    const altMeters = pos.altitude * 1000;
    const radius = getCoverageRadius(pos.altitude);
    const orbitType = sat.orbitType;

    // Create a high-tech grid material
    const wireframeMaterial = new Cesium.GridMaterialProperty({
        color: BEAM_COLORS[orbitType].withAlpha(0.6),
        cellAlpha: 0.05, // Almost transparent between the grid lines
        lineCount: new Cesium.Cartesian2(16, 16),
        lineThickness: new Cesium.Cartesian2(1.5, 1.5),
        lineOffset: new Cesium.Cartesian2(0, 0)
    });

    // The tactical scanning cone
    const cone = viewer.entities.add({
        // We can use Cesiums CallBackProperty here to update beam
        position: new Cesium.CallbackProperty(() => {
            const p = sat.position;
            if (!p) return Cesium.Cartesian3.ZERO;
            return Cesium.Cartesian3.fromDegrees(p.longitude, p.latitude, (p.altitude * 1000) / 2);
        }, false),
        cylinder: {
            topRadius: 8000, // Small opening at the satellite
            bottomRadius: radius,
            length: altMeters,
            material: wireframeMaterial,
            outline: true,
            outlineColor: BEAM_COLORS[orbitType].withAlpha(0.8),
            outlineWidth: 2,
            numberOfVerticalLines: 12, // Gives it geometric structure
            slices: 24
        },
        allowPicking: false
    });

    // Ground target lock footprint
    const footprint = viewer.entities.add({
        position: new Cesium.CallbackProperty(() => {
            const p = sat.position;
            if (!p) return Cesium.Cartesian3.ZERO;
            return Cesium.Cartesian3.fromDegrees(p.longitude, p.latitude);
        }, false),
        ellipse: {
            semiMajorAxis: radius,
            semiMinorAxis: radius,
            material: wireframeMaterial,
            outline: true,
            outlineColor: Cesium.Color.WHITE.withAlpha(0.5),
            outlineWidth: 2,
            height: 100,
        },
        allowPicking: false
    });

    activeBeams.push(cone, footprint);
}


function showBeamsForGroup() {
  clearBeams();
  let count = 0;

  // Grab user location from the window object we setup in app.js
  const userLat = window.userLocation.lat;
  const userLon = window.userLocation.lon;

  satBillboards.forEach(entry => {
    if (!entry.billboard.show) return;

    const pos = entry.sat.position;
            if (!pos) return;

            // How wide is this specific satellite's footprint?
            const coverageRadius = getCoverageRadius(pos.altitude);
            
            // How far away is the satellite's center from our location?
            const distanceToUser = getGroundDistance(userLat, userLon, pos.latitude, pos.longitude);

            // If the distance is less than the radius, it is scanning us!
            if (distanceToUser < coverageRadius) {
                addBeam(entry.sat);
                count++;
            }
        });
        console.log(`Tactical filtering complete. ${count} satellites currently overhead.`);
    }

// Remove all beams
function clearBeams() {
  activeBeams.forEach(entity => viewer.entities.remove(entity));
  activeBeams = [];
}



