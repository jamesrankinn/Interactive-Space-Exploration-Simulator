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

const BEAM_OUTLINE = Cesium.Color.fromCssColorString('#ffffff').withAlpha(0.4);

// Need coverage Radius r = sqrt(h(2R + h))
function getCoverageRadius(altitudeKm) {
    const h = altitudeKm * 1000; // convert to meters
    const R = EARTH_RADIUS;
    
    // Geometric horizon scaled to 40% for realistic sensor FOV
    let radius = Math.sqrt(h * (2 * R + h)) * 0.4;
    
    // Cap at 3000km so GEO satellites don't cover the entire screen
    return Math.min(radius, 3000000); 
}

function addBeam(sat) {
  const pos = sat.position;
  if (!pos) return;

  const altMeters = pos.altitude * 1000;
  const radius = getCoverageRadius(pos.altitude);
  const orbitType = sat.orbitType;

  // The holographic cone and pulsing/glowing rim
  const cone = viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(pos.longitude, pos.latitude, altMeters / 2),
    cylinder: {
      topRadius: 8000,
      bottomRadius: radius,
      length: altMeters,
      material: new Cesium.ColorMaterialProperty(
        new Cesium.CallbackProperty(() => {
          const alpha = 0.09 + Math.sin(Date.now() / 280) * 0.04; // pulsing shimmer
          return BEAM_COLORS[orbitType].withAlpha(alpha);
        }, false)
      ),
      outline: true,
      outlineColor: BEAM_OUTLINE,
      outlineWidth: 2,
      numberOfVerticalLines: 16,
      slices: 32
    },
    allowPicking: false   // This is needed to allow clicks to hit satellites
  });

  // Holographic Ground Footprint (Elipse)
  // CALC for Coverage Radius (need to know how much ground this satellite can see and it's moving)

  /*
  Geometric Horizon Formula:
    radius = sqrt(h * (2R + h))
    where h = altitude, R = Earths Radius

    and apply cap for GEO beam Depending on how messy it appears***********
  */
  const footprint = viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(pos.longitude, pos.latitude),
    ellipse: {
      semiMajorAxis: radius,
      semiMinorAxis: radius,
      material: new Cesium.ColorMaterialProperty(
        new Cesium.CallbackProperty(() => {
          const alpha = 0.12 + Math.sin(Date.now() / 400) * 0.03;
          return BEAM_COLORS[orbitType].withAlpha(alpha);
        }, false)
      ),
      outline: true,
      outlineColor: BEAM_OUTLINE,
      outlineWidth: 1.5,
      height: 1000,
      allowPicking: false
    }
  });

  activeBeams.push(cone, footprint);
}

function showBeamsForGroup() {
  clearBeams();
  let count = 0;
  satBillboards.forEach(entry => {
    if (entry.billboard.show && count < 80) {   // safety cap
      addBeam(entry.sat);
      count++;
    }
  });
  console.log(`Holographic beams active: ${count}`);
}

function clearBeams() {
  activeBeams.forEach(entity => viewer.entities.remove(entity));
  activeBeams = [];
}

// Expose for app.js
window.showBeamsForGroup = showBeamsForGroup;
window.clearBeams = clearBeams;
window.activeBeams = activeBeams; 


