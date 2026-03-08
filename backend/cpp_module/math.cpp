#include <pybind11/pybind11.h>
#include <pybind11/stl.h> // Converts python lists to C++ std::vectors
#include <cmath>
#include <vector>

namespace py = pybind11;

double haversine(double lat1, double lon1, double lat2, double lon2) {
    const double
}