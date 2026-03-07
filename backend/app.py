# Flask Backend 
#
# What this Does
#   1. Fetches TLE data from CelesTrak (same source as frontend) we need the call in both
#   2. Extracts orbital FEATURES from each satellite
#   3. Runs IsolationForest to find anomalous satellites
#   4. Serves results via a REST API that the frontend calls
#
# Endpoints:
#  GET  /api/anomalies   - returns list of anomalous satellite NORAD IDs
#  GET  /api/health      - simple health check
#
# RUN:
#   cd backend
#   pip install -r requirements.txt
#   python app.py
#   runs on http://localhost:5000

from flask import Flask, jsonify, request
from flask_cors import CORS
import requests
import numpy as np
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler
import time
import re

app = Flask(__name__)


# CORS
# Browsers block cross-origin requests in this case. So we can use CORS to avoid that.
CORS(app)


# TLE source
TLE_URL = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle'

# OpenSky config
OPENSKY_URL = 'https://opensky-network.org/api/states/all'

# Cache on CelesTrak
# TLEs are valid for days so caching 30 minutes works.
# For other defence measures should decrease time.
tle_cache = {
    'data': None,    # raw TLE text
    'timestamp': 0,  # when we last fetched
    'max_age': 1800  # 30 minutes in seconds
}

aircraft_cache = {
    'data': None,
    'timestamp': 0,
    'max_age': 10
}

OPENSKY_USERNAME = 'jjrankin17@gmail.com-api-client' 
OPENSKY_PASSWORD = 'Em8jjooQYsnGXPB4IV9vQFBjyCtDA4Io'



def fetch_tles():
    """
    Fetch TLE data from CelesTrak with an ironclad browser disguise.
    Return raw text, or None if fetch fails.
    """
    now = time.time()

    # Return cached data if it's fresh enough
    if tle_cache['data'] and (now - tle_cache['timestamp'] < tle_cache['max_age']):
        print("Using cached TLE data.")
        return tle_cache['data']
    
    try:
        print("Initiating stealth download from CelesTrak...")
        url = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle'
        
        # IRONCLAD DISGUISE: Full Firefox 123 fingerprint
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:149.0) Gecko/20100101 Firefox/149.0',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Connection': 'keep-alive'
        }
        
        # A Session object automatically handles cookies and redirects like a real browser
        session = requests.Session()
        response = session.get(url, headers=headers, timeout=30)
        
        # Force Python to throw an error if CelesTrak returns a 403 or 404
        response.raise_for_status()

        tle_cache['data'] = response.text
        tle_cache['timestamp'] = now
        print(f"SUCCESS: Infiltrated CelesTrak. Downloaded {len(response.text)} bytes.")
        return response.text

    except Exception as e:
        print(f"\n--- CRITICAL BACKEND ERROR ---")
        print(f"Failed to fetch TLEs: {e}")
        
        # If CelesTrak sends a rejection letter, print it to the terminal!
        if hasattr(e, 'response') and e.response is not None:
            print(f"Status Code: {e.response.status_code}")
            print(f"Rejection Details: {e.response.text[:250]}")
        print("------------------------------\n")
        
        # Return stale cache if we have it 
        if tle_cache['data']:
            print("Falling back to stale cached data.")
            return tle_cache['data']
        return None

def parse_tles(raw_text):
    """
    Parse raw TLE text into a list of satellite dictionaries.

    Each satellite gets:
        - name: human-readable name
        - norad_id: unique catalog number (used to match with frontend)
        - features: dict of orbital parameters for ML

    Only 4 feature choices for the time being:
      - eccentricity: how circular the orbit is 0 = circle
      - bstar: atmospheric drag coefficient 
      - mean_motion: revolutions per day 
      - inclination: tilt vs equator in degrees 

    These 4 features capture the shape of an orbit. IsolationForest will
    learn what normal combinations look like and flag outliers.

    An anomaly might have normal individual values but an unusual combination 
    that's why IsolationForest catches that simple thresholds miss."
    
    """
    lines = raw_text.strip().split('\n')
    lines = [line.strip() for line in lines]
    satellites = []

    for i in range(0, len(lines) - 2, 3):
        name = lines[i]
        line1 = lines[i + 1]
        line2 = lines[i + 2]

        if not line1.startswith('1 ') or not line2.startswith('2 '):
            continue

        try:
            # extract NORAD catalog number from line 1 (columns 3-7)
            # unique id that will match with front  end
            norad_id = int(line1[2:7].strip())

            # extract orbital parameters from TLE
            # lines and columns noted from diagram that will be included in README.md
            bstar_raw = line1[53:61].strip()
            bstar = parse_bstar(bstar_raw)

            # Inclination
            inclination = float(line2[8:16].strip())

            # Eccentricity
            eccentricity = float('0.' + line2[26:33].strip())

            # Mean motion - revolutions per day
            mean_motion = float(line2[52:63].strip())

            # append satellites info
            satellites.append({
                'name': name,
                'norad_id': norad_id,
                'features': {
                    'eccentricity': eccentricity,
                    'bstar': bstar,
                    'mean_motion': mean_motion,
                    'inclination': inclination
                }
            })
        except (ValueError, IndexError) as e:
            # malformed TLEs skip
            continue

    return satellites

def parse_bstar(raw):
    """
    Parse BSTAR from TLEs weird format

    TLE format: " 12345-3" means 0.12345 * 10^-3
    The leading space or sign, then 5 digits, then sign+exponent.

    Examples:
      " 10270-3" -> 0.10270e-3 -> 0.00010270
      "-11606-4" -> -0.11606e-4
    """
    raw = raw.strip()
    if not raw or raw == '00000-0' or raw == '00000+0':
        return 0.0
    
    try:
        # manage sign
        sign = -1.0 if raw[0] == '-' else 1.0
        raw = raw.lstrip('+-').strip()

        # split at exponent sign
        if '-' in raw:
            parts = raw.split('-')
            mantissa = float('0.' + parts[0].strip())
            exponent = -int(parts[1].strip())
        elif '+' in raw:
            parts = raw.split('+')
            mantissa = float('0.' + parts[0].strip())
            exponent = int(parts[1].strip())
        else:
            return float(raw)
        
        return sign * mantissa * (10 ** exponent)
    
    except (ValueError, IndexError):
        return 0.0
    
def detect_anomalies(satellites):
    """
    Run isolation forest on orbital feature vectors
      1. Randomly select a feature 
      2. Randomly select a split value between min and max
      3. Split the data into left/right groups
      4. Repeat until each point is alone in its group
      5. ANOMALIES are isolated quickly because they're far from the crowd 

      Score is based on average path length across many random trees.

    PARAMETERS:
    contamination=0.05 
    - .05 means flag roughly the top 5% weirdest satellites.

    n_estimators=200  build 200 random trees
        More trees = more stable results, but slower. 200 is a good

    random_state=42  reproducible results
        Same input always gives same output. Important for quick debugging and for demos in this case

    RETURNS: list of NORAD IDs flagged as anomalies, plus metadata
    """
    if len(satellites) < 10:
        return []

    # Build the feature matrix
    # Each row = one satellite, each column = one orbital parameter
    feature_names = ['eccentricity', 'bstar', 'mean_motion', 'inclination']
    X = np.array([
        [sat['features'][f] for f in feature_names]
        for sat in satellites
    ])

    # we will get weird numbers if we don't STANDARDIZE
    # StandardScaler converts each feature to mean = 0 and std=1 to avoid bias.
    # Inclination could dominate otherwise
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    # FIT THE MODEL
    model = IsolationForest(
        contamination=0.05,  # flag 5% as anomalies
        n_estimators=200,    # 200 random trees
        random_state=42      # reproducible results
    )

    # fit_predict returns: 1 = normal, -1 = anomaly
    predictions = model.fit_predict(X_scaled)

    # decision_function returns negative values for anomalies
    scores = model.decision_function(X_scaled)

    # BUILD RESULTS
    # For each anomaly, compute WHY it was flagged.
    # We compare each feature to the population mean/std.
    # Features that are >2 standard deviations from the mean
    # are likely the reason the model flagged it.
    means = np.mean(X, axis=0)
    stds = np.std(X, axis=0)

    # return list
    anomalies = []
    for i, pred in enumerate(predictions):
        if pred == -1:  # anomaly
            sat = satellites[i]
            features = sat['features']

            # Figure out which features are unusual
            reasons = []
            for j, fname in enumerate(feature_names):
                value = X[i, j]
                z_score = (value - means[j]) / stds[j] if stds[j] > 0 else 0

                if abs(z_score) > 2:
                    direction = "high" if z_score > 0 else "low"
                    reasons.append({
                        'feature': fname,
                        'value': round(float(value), 6),
                        'z_score': round(float(z_score), 2),
                        'direction': direction
                    })

            anomalies.append({
                'norad_id': sat['norad_id'],
                'name': sat['name'],
                'score': round(float(scores[i]), 4),
                'features': features,
                'reasons': reasons
            })

    # Sort by anomaly score 
    anomalies.sort(key=lambda x: x['score'])

    return anomalies

# API (ignore)
@app.route('/api/health', methods=['GET'])
def health():
    """Simple health check — useful for Docker/monitoring."""
    return jsonify({
        'status': 'ok',
        'cache_age': round(time.time() - tle_cache['timestamp']) if tle_cache['timestamp'] else None
    })
# Need this new route so that we can bypass API request limit
@app.route('/api/tles', methods=['GET'])
def get_tles():
    """
    Acts as a proxy for the frontend to bypass CelesTrak CORS blocks.
    Returns the raw, cached TLE text.
    """
    raw_tle = fetch_tles()
    if not raw_tle:
        return jsonify({'error': 'Failed to fetch TLE data'}), 503
    
    # Return as plain text because satellite.js needs the raw string format
    return raw_tle, 200, {'Content-Type': 'text/plain'}

@app.route('/api/anomalies', methods=['GET'])
def get_anomalies():
    """
    Main endpoint. Fetches TLEs, runs ML, returns anomalies.

    Response format:
    {
      "total_satellites": 5000,
      "total_anomalies": 250,
      "anomalies": [
        {
          "norad_id": 25544,
          "name": "ISS (ZARYA)",
          "score": -0.1234,
          "features": { "eccentricity": 0.0007, ... },
          "reasons": [ { "feature": "bstar", "value": ..., "z_score": 3.2, "direction": "high" } ]
        },
        ...
      ]
    }
    """
    # Step 1: Fetch TLEs (cached)
    raw_tle = fetch_tles()
    if not raw_tle:
        return jsonify({'error': 'Failed to fetch TLE data'}), 503

    # Step 2: Parse into satellite objects with features
    satellites = parse_tles(raw_tle)
    if not satellites:
        return jsonify({'error': 'Failed to parse TLE data'}), 500

    print(f"[ML] Running IsolationForest on {len(satellites)} satellites...")

    # Step 3: Run anomaly detection
    anomalies = detect_anomalies(satellites)

    print(f"[ML] Detected {len(anomalies)} anomalies")

    # Step 4: Return results
    return jsonify({
        'total_satellites': len(satellites),
        'total_anomalies': len(anomalies),
        'anomalies': anomalies
    })

@app.route('/api/aircraft', methods=['GET'])
def get_aircraft():
    lamin = request.args.get('lamin', type=float)
    lomin = request.args.get('lomin', type=float)
    lamax = request.args.get('lamax', type=float)
    lomax = request.args.get('lomax', type=float)

    if not all([lamin, lomin, lamax, lomax]):
        return jsonify({'error': 'Missing bounding box params'}), 400

    now = time.time()

    # Return cache if fresh
    if aircraft_cache['data'] and (now - aircraft_cache['timestamp'] < aircraft_cache['max_age']):
        return jsonify(aircraft_cache['data'])

    url = f'https://opensky-network.org/api/states/all?lamin={lamin}&lomin={lomin}&lamax={lamax}&lomax={lomax}'

    try:
        auth = None
        if OPENSKY_USERNAME and OPENSKY_PASSWORD:
            auth = (OPENSKY_USERNAME, OPENSKY_PASSWORD)

        resp = requests.get(url, timeout=10, auth=auth)
        resp.raise_for_status()
        data = resp.json()

        aircraft_cache['data'] = data
        aircraft_cache['timestamp'] = now

        state_count = len(data.get('states', []) or [])
        print(f"[RADAR] {state_count} aircraft in region")
        return jsonify(data)

    except Exception as e:
        print(f"[RADAR] OpenSky failed: {e}")
        # Return stale cache if available
        if aircraft_cache['data']:
            return jsonify(aircraft_cache['data'])
        return jsonify({'states': None, 'error': str(e)}), 503
    
# Run
if __name__ == '__main__':
    print("=" * 60)
    print("  Orbital Explorer — Backend Server")
    print("  http://localhost:5000")
    print("  Endpoints:")
    print("    GET /api/health     → health check")
    print("    GET /api/anomalies  → ML anomaly detection")
    print("=" * 60)

    # debug=True gives auto-reload on code changes (dev only)
    # host='0.0.0.0' makes it accessible from Docker containers
    app.run(debug=True, host='0.0.0.0', port=5000)