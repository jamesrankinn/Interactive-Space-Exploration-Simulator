from setuptools import setup, Extension
import pybind11

# Replaces the need for a CMake file
ext_modules = [
    Extension(
    'tactical_math',
        ['tactical_math.cpp'],
        include_dirs=[pybind11.get_include()], # Where headers are involved
        language='c++',
        extra_compile_args=['-03'] # Maximum execution speed for compiler
    ),
]

setup(
    name='tactical_math',
    version='1.0.0',
    description='C++ haversine calculator',
    ext_modules=ext_modules,
)