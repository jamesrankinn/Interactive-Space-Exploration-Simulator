# What this Does
#   1. Flask: TLEs (cached 30min)
#   2. Python: SGP4 * 5,000 satellites (cached 2s, runs ONCE server-side)
#   3. C++ via Pybind11: spatial filter (zero network cost)
#   4. NETWORK: one small JSON of filtered satellites only
#   5. JS: Only UI rendering, no math
#
#
# DATA LOCALITY
# The C++ spatial engine lives in the same OS process as Flask (via Pybind11)
# When Python calls tactical_math.filter_satellites() the lat/lon arrats are passed as a direct function call across shared memory
# This saved us tons of ms from JS to Python and Python to C++ down to nanoseconds of a full HTTP round trip

from flask import Flask, jsonify, request
from flask_cors import CORS
import requests
import numpy as np
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler
from sklearn.cluster import KMeans 
import time
import math


from sgp4.api import Satrec, jday
import tactical_math

app = Flask(__name__)
# CORS
# Browsers block cross-origin requests in this case. So we can use CORS to avoid that.
CORS(app)

TLE_MIRROR_URL   = 'https://raw.githubusercontent.com/mrmykey/tlecdn/main/active.txt'
OPENSKY_USERNAME = 'jjrankin17@gmail.com-api-client'
OPENSKY_PASSWORD = 'Em8jjooQYsnGXPB4IV9vQFBjyCtDA4Io'

# CACHE LAYER

# Three caches at different TTLS, each matched to the volatiltiy of its data:
#
#   tle_cache: 30 minutes - TLE parameters are orbital mean elements that only get updated around 1.5 weeks.
#                           30 minutes is a more than safe margin
#
#   positions_cache: 2 seconds - If 100 users were connected, all 100 would receive same pre-computed result 
#
#   anomaly_cache:  10 minutes - ML interference on 5,000 sats takes roughly 500ms.
#                                Anomalies don't change that frequently.

tle_cache = {
    'data': None,    # raw TLE text
    'timestamp': 0,  # when we last fetched
    'max_age': 1800  # 30 minutes in seconds
}

positions_cache = {
    'data': None,
    'timestamp': 0, 'max_age': 2
}
anomaly_cache = {
    'data': None,
    'timestamp': 0, 'max_age': 600
}
aircraft_cache = {
    'data': None,
    'timestamp': 0, 'max_age': 10
}

ROCKET_LAB_TERMS = [
    'electron', 'photon', 'capella', 'sequoia', 'kineis',
    'hawk', 'strix', 'globalstar', 'owl', 'bro',
]

def is_rocket_lab(sat_name):
    lower = sat_name.lower()
    return any(term in lower for term in ROCKET_LAB_TERMS)

def get_orbit_type(altitude_km):
    if altitude_km < 2000:  return 'LEO'
    if altitude_km < 35000: return 'MEO'
    if altitude_km < 36500: return 'GEO'
    return 'HEO'



# ORBITAL MATH UTILITIES (instead of using java functions)

def compute_gmst(jd_full):
    """
    Why we need these functions:
      SGP4 returns positions in the (Earth-Centered Inertial / TEME) frame,
      where axes are fixed to distant stars and do NOT rotate with the Earth.
      GMST is Earth's rotation angle relative to the stars at a given moment.
      We rotate by GMST to convert ECI -> ECEF (Earth-fixed) coordinates,
      where we can finally extract meaningful lat/lon values.

    "Julian Day Numbers" eliminate calendar ambiguities (leap years, DST) that
    would otherwise introduce drift errors into position calculations.
    Formula: Vallado, "Fundamentals of Astrodynamics", 4th ed., Eq. 3-45.
    """
    T = (jd_full - 2451545.0) / 36525.0  # Julian centuries since J2000.0 
    gmst_deg = (280.46061837
                + 360.98564736629 * (jd_full - 2451545.0)
                + 0.000387933 * T**2
                - T**3 / 38710000.0)
    return math.radians(gmst_deg % 360.0)


def eci_to_geodetic(x_km, y_km, z_km, gmst_rad):
    """
    Convert ECI position vector (km) to geodetic lat/lon/altitude.

    THREE STAGES:
      1. ECI -> ECEF: Rotate the position vector around Z-axis by -GMST.
         This "un-rotates" Earth's spin so coordinates become Earth-fixed.
         Rotation matrix: [cos g   sin g  0]   [x]
                          [-sin g  cos g  0] * [y]
                          [0       0      1]   [z]

      2. ECEF -> Geodetic: The Earth is an oblate spheroid (WGS-84 ellipsoid),
         not a sphere. Bowring's iterative method finds the geodetic latitude
         accounting for polar flattening. A spherical approximation would
         introduce up to ~21km of latitude error near the poles.

      3. Altitude: Perpendicular distance above the WGS-84 ellipsoid surface.

    """

    # Stage 1: ECI -> ECEF rotation

    cos_g = math.cos(gmst_rad)
    sin_g = math.sin(gmst_rad)
    xe =  x_km * cos_g + y_km * sin_g
    ye = -x_km * sin_g + y_km * cos_g
    ze =  z_km  # Z-axis is the rotation axis — unchanged

    # Stage 2: ECEF -> Geodetic (WGS-84)
    a  = 6378.137             # Semi-major axis (equatorial radius) km
    f  = 1.0 / 298.257223563  # Flattening factor
    e2 = 2.0 * f - f**2       # First eccentricity squared ~= 0.00669438

    p       = math.sqrt(xe**2 + ye**2)   # Distance from Z-axis
    lon_rad = math.atan2(ye, xe)         # Longitude is unambiguous

    # Bowring iterative method for geodetic latitude
    # 3 iterations gives millimeter accuracy — sufficient for visualization
    lat_rad = math.atan2(ze, p * (1.0 - e2))  # Initial spherical guess
    for _ in range(3):
        sin_lat = math.sin(lat_rad)
        N = a / math.sqrt(1.0 - e2 * sin_lat**2)  # Radius of curvature
        lat_rad = math.atan2(ze + e2 * N * sin_lat, p)

    # Stage 3: Altitude above ellipsoid
    sin_lat = math.sin(lat_rad)
    cos_lat = math.cos(lat_rad)
    N_final = a / math.sqrt(1.0 - e2 * sin_lat**2)

    # Choose numerically stable formula based on latitude
    # (near poles cos(lat)->0, so we use the Z-component formula)
    if abs(cos_lat) > 1e-10:
        alt_km = p / cos_lat - N_final
    else:
        alt_km = abs(ze) / abs(sin_lat) - N_final * (1.0 - e2)

    return math.degrees(lat_rad), math.degrees(lon_rad), alt_km

# TLE FETCHING & PARSING

def fetch_tles():
    # Fetch raw TLE text with 30-minute cache
    now = time.time()
    if tle_cache['data'] and (now - tle_cache['timestamp'] < tle_cache['max_age']):
        return tle_cache['data']
    try:
        print("Fetching TLEs from GitHub CDN mirror...")
        response = requests.get(TLE_MIRROR_URL, timeout=30)
        response.raise_for_status()
        tle_cache['data']      = response.text
        tle_cache['parsed']    = None  # Invalidate parsed Satrec objects
        tle_cache['timestamp'] = now
        print(f"SUCCESS: Downloaded {len(response.text)} bytes.")
        return response.text
    except Exception as e:
        print(f"TLE fetch failed: {e}")
        return tle_cache['data']
    

def parse_bstar(raw):
    # Parse BSTAR drag term from TLE's packed exponential notation
    raw = raw.strip()
    if not raw or raw in ('00000-0', '00000+0'):
        return 0.0
    try:
        sign = -1.0 if raw[0] == '-' else 1.0
        raw  = raw.lstrip('+-').strip()
        if '-' in raw:
            parts = raw.split('-')
            return sign * float('0.' + parts[0].strip()) * (10 ** -int(parts[1].strip()))
        elif '+' in raw:
            parts = raw.split('+')
            return sign * float('0.' + parts[0].strip()) * (10 **  int(parts[1].strip()))
        return float(raw)
    except (ValueError, IndexError):
        return 0.0


def parse_tles_full(raw_text):
    """
    Parse raw TLE text into satellite records with Satrec propagator objects.

    Also constructs a Satrec object for EACH satellite —
      the SGP4 propagator that replaces satellite.twoline2satrec() in JS.

    WHY WE CACHE Satrec OBJECTS:
      Satrec.twoline2rv() parses the TLE string and pre-computes mean motion
      derivatives — ~20 floating-point operations per satellite. For 5,000
      satellites, re-parsing on every call wastes ~10ms/cycle.

      We parse once when TLEs are fetched, cache the Satrec objects, and
      reuse them for every SGP4 call until the TLE cache expires.
    """
    if tle_cache['parsed']:
        return tle_cache['parsed']

    lines = [l.strip() for l in raw_text.strip().split('\n')]
    satellites = []

    for i in range(0, len(lines) - 2, 3):
        name  = lines[i]
        line1 = lines[i + 1]
        line2 = lines[i + 2]
        if not line1.startswith('1 ') or not line2.startswith('2 '):
            continue
        try:
            norad_id = int(line1[2:7].strip())

            # Build the SGP4 propagator 
            satrec = Satrec.twoline2rv(line1, line2)

            # Extract orbital parameters (for ML and info panel display)
            bstar        = parse_bstar(line1[53:61].strip())
            inclination  = float(line2[8:16].strip())
            eccentricity = float('0.' + line2[26:33].strip())
            mean_motion  = float(line2[52:63].strip())

            satellites.append({
                'name':         name,
                'norad_id':     norad_id,
                'satrec':       satrec,      # SGP4 propagator object
                'is_rocket_lab': is_rocket_lab(name),
                'inclination':  inclination,
                'eccentricity': eccentricity,
                'mean_motion':  mean_motion,
                'bstar':        bstar,
                'features': {
                    'eccentricity': eccentricity,
                    'bstar':        bstar,
                    'mean_motion':  mean_motion,
                    'inclination':  inclination,
                },
            })
        except (ValueError, IndexError):
            continue

    tle_cache['parsed'] = satellites
    print(f"[PARSE] {len(satellites)} satellites parsed into Satrec objects.")
    return satellites

# Core Engine: Server-Side SGP4 Propagation

def propagate_all_satellites(satellites, anomaly_map=None):
    """
    Run SGP4 for every satellite and return geodetic position records.

      1. COMPUTE LOCATION: Runs in CPython on the server. (Faster and won't compete with Cesium).

      2. SHARED COMPUTATION: Result cached for 2s. 100 connected clients
         all receive the same pre-computed positions. 

      3. DIRECT C++ HANDOFF: The lat/lon lists built here go straight into
         tactical_math.filter_satellites() as a Python function call.
         Pybind11 converts Python list -> C++ std::vector via a memory buffer
         copy. This takes microseconds.

    """
    now_dt = time.gmtime()  # UTC time

    # Convert to Julian Day — a monotonically increasing float with no
    # calendar discontinuities. SGP4 uses JDN internally for this reason.
    jd, jd_frac = jday(
        now_dt.tm_year, now_dt.tm_mon, now_dt.tm_mday,
        now_dt.tm_hour, now_dt.tm_min, now_dt.tm_sec
    )

    # Compute GMST ONCE before the loop.
    # GMST depends only on time, which is the same for all satellites at this instant. 
    gmst = compute_gmst(jd + jd_frac)

    positions = []

    for sat in satellites:
        # SGP4 propagation: satrec + Julian Date -> ECI position + velocity
        # Returns: e (error code), r (position km ECI), v (velocity km/s ECI)
        # Error codes 1-6 indicate orbital decay or bad TLE data; 
        e, r, v = sat['satrec'].sgp4(jd, jd_frac) # skip those
        if e != 0:
            continue

        # Convert ECI -> geodetic lat/lon/alt
        lat, lon, alt = eci_to_geodetic(r[0], r[1], r[2], gmst)
        if alt < 0:  # Satellite below ground = decayed or bad TLE
            continue

        # Velocity magnitude: 3D Pythagorean theorem on the velocity vector
        velocity = math.sqrt(v[0]**2 + v[1]**2 + v[2]**2)

        # Merge anomaly data if available for this satellite
        anomaly_data = (anomaly_map or {}).get(sat['norad_id'])

        positions.append({
            'norad_id':    sat['norad_id'],
            'name':        sat['name'],
            'lat':         round(lat, 5),      
            'lon':         round(lon, 5),
            'alt':         round(alt, 2),
            'velocity':    round(velocity, 3),
            'orbit_type':  get_orbit_type(alt),
            'inclination': round(sat['inclination'], 4),
            'eccentricity': round(sat['eccentricity'], 6),
            'mean_motion': round(sat['mean_motion'], 4),
            'bstar':       sat['bstar'],
            'is_rocket_lab': sat['is_rocket_lab'],
            'is_anomaly':  anomaly_data is not None,
            'anomaly_data': anomaly_data,
        })

    return positions


def detect_anomalies(satellites):
    """
    1. K-Means clusters the satellites into 3 orbital regimes (LEO, MEO, GEO) 
       based on their physical characteristics.
    2. We run an independent Isolation Forest INSIDE each cluster. 
    3. Now, a spy satellite in LEO is flagged because its orbit is suspicious 
       compared to OTHER LEO satellites, completely eliminating regime bias.
    """
    if len(satellites) < 50:
        return {}

    feature_names = ['eccentricity', 'bstar', 'mean_motion', 'inclination']
    # Build the feature matrix
    X = np.array([[sat['features'][f] for f in feature_names] for sat in satellites]) 

    # Global Normalization
    scaler    = StandardScaler()
    X_scaled  = scaler.fit_transform(X)

    # Regime Clustering
    # We force the data into 3 clusters representing the primary orbital regimes
    kmeans   = KMeans(n_clusters=3, random_state=42, n_init=10)
    clusters = kmeans.fit_predict(X_scaled)

    anomalies = {}

    # Anomaly Detection
    for cluster_id in range(3):
        # Extract the specific subset of satellites in this cluster
        idx = np.where(clusters == cluster_id)[0]
        
        # If a cluster is too small, ML stats don't work. Skip it.
        if len(idx) < 20:
            continue 

        X_cluster_scaled = X_scaled[idx]
        X_cluster_raw    = X[idx]

        # Train Isolation Forest 
        iso_model = IsolationForest(contamination=0.03, n_estimators=200, random_state=42)
        preds     = iso_model.fit_predict(X_cluster_scaled)
        scores    = iso_model.decision_function(X_cluster_scaled)

        # Calculate means and stds to find z-scores
        c_means = np.mean(X_cluster_raw, axis=0)
        c_stds  = np.std(X_cluster_raw, axis=0)

        for i, pred in enumerate(preds):
            if pred == -1: # -1 means anomaly detected
                global_i = idx[i]
                sat      = satellites[global_i]
                
                reasons = []
                for j, fname in enumerate(feature_names):
                    # Z-score relative to its own orbital regime, not the whole catalog
                    z = (X_cluster_raw[i, j] - c_means[j]) / c_stds[j] if c_stds[j] > 0 else 0
                    
                    if abs(z) > 2.0: # Flag features that are 2+ standard deviations out
                        reasons.append({
                            'feature':   fname,
                            'value':     round(float(X_cluster_raw[i, j]), 6),
                            'z_score':   round(float(z), 2),
                            'direction': 'high' if z > 0 else 'low',
                            'context':   f'Compared to Regime {cluster_id}'
                        })
                
                # Only save it if we actually found a specific structural reason
                if reasons:
                    anomalies[sat['norad_id']] = {
                        'norad_id': sat['norad_id'],
                        'name':     sat['name'],
                        'score':    round(float(scores[i]), 4),
                        'features': sat['features'],
                        'reasons':  reasons,
                    }
                    
    return anomalies



def get_or_compute_anomalies(satellites):
    now = time.time()
    if anomaly_cache['data'] and (now - anomaly_cache['timestamp'] < anomaly_cache['max_age']):
        return anomaly_cache['data']
    print(f"[ML] Running IsolationForest on {len(satellites)} satellites...")
    result = detect_anomalies(satellites)
    anomaly_cache['data'] = result
    anomaly_cache['timestamp'] = now
    print(f"[ML] Detected {len(result)} anomalies.")
    return result

# API ROUTES

@app.route('/api/positions', methods=['GET'])
def get_positions():
    """
    PRIMARY ENDPOINT 

    QUERY PARAMETERS:
      lat (float, optional): Grid center latitude  -> triggers C++ spatial filter
      lon (float, optional): Grid center longitude -> triggers C++ spatial filter

    RESPONSE: { "count": int, "timestamp": float, "positions": [...] }

    CACHING STRATEGY:
      Grid filtering is applied ON TOP of the cached result, so C++ filters
      a pre-computed in-memory array.
      Multiple simultaneous grid requests all share the same propagated base set.

    """
    grid_lat = request.args.get('lat', type=float)
    grid_lon = request.args.get('lon', type=float)

    raw_tle = fetch_tles()
    if not raw_tle:
        return jsonify({'error': 'Failed to fetch TLE data'}), 503

    satellites = parse_tles_full(raw_tle)
    if not satellites:
        return jsonify({'error': 'Failed to parse TLE data'}), 500

    # Anomaly map is merged into position records so frontend gets everything
    anomaly_map = get_or_compute_anomalies(satellites)

    # SGP4 propagation result: cached 2 seconds, shared across all clients
    now = time.time()
    if positions_cache['data'] and (now - positions_cache['timestamp'] < positions_cache['max_age']):
        all_positions = positions_cache['data']
    else:
        all_positions = propagate_all_satellites(satellites, anomaly_map)
        positions_cache['data']      = all_positions
        positions_cache['timestamp'] = now
        print(f"[SGP4] Propagated {len(all_positions)} satellites.")

    # C++ spatial filter 
    if grid_lat is not None and grid_lon is not None:
        # Build parallel arrays for the C++ engine.
        # These list comprehensions are O(N) in Python but stay entirely
        # in-process. Pybind11 converts them to std::vector via memory copy
        # microseconds, not milliseconds.
        ids  = [p['norad_id'] for p in all_positions]
        lats = [p['lat']      for p in all_positions]
        lons = [p['lon']      for p in all_positions]

        # The Pybind11 bridge call 
        filtered_set = set(tactical_math.filter_satellites(grid_lat, grid_lon, ids, lats, lons))

        # O(N) scan with O(1) Set lookup = O(N) total
        result = [p for p in all_positions if p['norad_id'] in filtered_set]
    else:
        result = all_positions

    return jsonify({'count': len(result), 'timestamp': now, 'positions': result})


@app.route('/api/anomalies', methods=['GET'])
def get_anomalies():
    """Anomaly endpoint — uses shared cache. Returns list for backwards compat."""
    raw_tle = fetch_tles()
    if not raw_tle:
        return jsonify({'error': 'Failed to fetch TLE data'}), 503
    satellites = parse_tles_full(raw_tle)
    if not satellites:
        return jsonify({'error': 'Failed to parse TLE data'}), 500
    anomaly_map  = get_or_compute_anomalies(satellites)
    anomaly_list = sorted(anomaly_map.values(), key=lambda x: x['score'])
    return jsonify({
        'total_satellites': len(satellites),
        'total_anomalies':  len(anomaly_list),
        'anomalies':        anomaly_list
    })


@app.route('/api/tles', methods=['GET'])
def get_tles():
    """Remove after app.js migration."""
    raw_tle = fetch_tles()
    if not raw_tle:
        return jsonify({'error': 'Failed to fetch TLE data'}), 503
    return raw_tle, 200, {'Content-Type': 'text/plain'}


@app.route('/api/grid_filter', methods=['POST'])
def grid_filter():
    """
    C++ is called directly inside /api/positions.
    Kept alive during transition period only.
    """
    data = request.json
    filtered_ids = tactical_math.filter_satellites(
        data.get('lat'), data.get('lon'),
        data.get('ids'), data.get('lats'), data.get('lons')
    )
    return jsonify({'targets': filtered_ids})


@app.route('/api/aircraft', methods=['GET'])
def get_aircraft():
    # ADS-B Radar Proxy
    lamin = request.args.get('lamin', type=float)
    lomin = request.args.get('lomin', type=float)
    lamax = request.args.get('lamax', type=float)
    lomax = request.args.get('lomax', type=float)
    if not all([lamin, lomin, lamax, lomax]):
        return jsonify({'error': 'Missing bounding box params'}), 400
    now = time.time()
    if aircraft_cache['data'] and (now - aircraft_cache['timestamp'] < aircraft_cache['max_age']):
        return jsonify(aircraft_cache['data'])
    url = (f'https://opensky-network.org/api/states/all'
           f'?lamin={lamin}&lomin={lomin}&lamax={lamax}&lomax={lomax}')
    try:
        auth = (OPENSKY_USERNAME, OPENSKY_PASSWORD) if OPENSKY_USERNAME else None
        resp = requests.get(url, timeout=10, auth=auth)
        resp.raise_for_status()
        data = resp.json()
        aircraft_cache['data'] = data
        aircraft_cache['timestamp'] = now
        return jsonify(data)
    except Exception as e:
        print(f"[RADAR] OpenSky failed: {e}")
        if aircraft_cache['data']:
            return jsonify(aircraft_cache['data'])
        return jsonify({'states': None, 'error': str(e)}), 503


@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({
        'status':        'ok',
        'tle_cache_age':  round(time.time() - tle_cache['timestamp'])         if tle_cache['timestamp']       else None,
        'pos_cache_age':  round(time.time() - positions_cache['timestamp'], 2) if positions_cache['timestamp'] else None,
        'ml_cache_age':   round(time.time() - anomaly_cache['timestamp'])      if anomaly_cache['timestamp']   else None,
    })


if __name__ == '__main__':
    print("  Orbital Explorer — Backend")
    print("  http://localhost:5000")
    print("  PRIMARY: GET /api/positions  -> SGP4 + C++ in one pipeline")
    print("  LEGACY:  GET /api/tles       -> raw TLEs")
    
    app.run(debug=True, host='0.0.0.0', port=5000)