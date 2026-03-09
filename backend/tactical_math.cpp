#define _USE_MATH_DEFINES

// Can add a json file to remove the "error"
#include <pybind11/pybind11.h>
#include <pybind11/stl.h> // Converts python lists to C++ std:vector (Containers, list, dict, sets)
#include <cmath>
#include <vector>

namespace py = pybind11; // name alias

// Relates angles and sides for spherical shapes
double haversine(double lat1, double lon1, double lat2, double lon2) {
    const double R = 6371000.0;
    const double TO_RAD = M_PI / 180.0;

    double dLat = (lat2 - lat1) * TO_RAD;
    double dLon = (lon2 - lon1) * TO_RAD;

    // Formula core
    double a = std::sin(dLat / 2.0) * std::sin(dLat / 2.0) +
               std::cos(lat1 * TO_RAD) * std::cos(lat2 * TO_RAD) *
               std::sin(dLon / 2.0) * std::sin(dLon / 2.0);

    return R * 2.0 * std::atan2(std::sqrt(a), std::sqrt(1.0 - a));
}
// Earths radius is not perfectly sphered so haversine is slightly inaccurate

// High performance filter function
// Taking vector by reference (&) so we don't copy massive lists in memory
std::vector<int> filter_satellites(double grid_lat, double grid_lon,
                                   const std::vector<int>& norad_ids, // Use the original variable instead of making a copy
                                   const std::vector<double>& lats,
                                   const std::vector<double>& lons) {

    std::vector<int> targets_in_grid;

    // Reserve memory ahead of time to make loop fast O(n)
    targets_in_grid.reserve(norad_ids.size());

    for(size_t i = 0; i < norad_ids.size(); i++){
        double dist = haversine(grid_lat, grid_lon, lats[i], lons[i]);
        // What satellites are within 500km of this location?
        if(dist <= 500000.0) {
            targets_in_grid.push_back(norad_ids[i]);
        }
    }

    return targets_in_grid;
}

// Pybind11 wrapper that exposes this to python
PYBIND11_MODULE(tactical_math, m) {
    m.doc() = "O(n) run time";
    m.def("filter_satellites", &filter_satellites, "Returns norad_ids within 500km of target grid");
}