# SYSTEM ARCHITECTURE

The system is seperated into a high speed backend and a WebGL frontend. 

'''mermaid
graph TD;
    %% External Data Sources
    A[CelesTrak CDN] -->|Raw Orbital TLEs| B(Python Flask Backend);
    C[Opensky API] -->|Live ADS-B Radar| B;

    %% Backend Processing
    B -->|Feature Extraction| D{Isolation Forest ML};
    D -->|Z-Score Anomalies| B;

    %% The C++ Bridge
    B -->|Pybind11 Integration| E[[C++ Spatial Engine]];
    E -->|O N Haversine Filtering| B;

    %% Frontend
    B -->|JSON Telemetry| F[Cesium.js WebGL UI];


