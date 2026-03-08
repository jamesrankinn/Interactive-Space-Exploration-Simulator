from setuptools import setup, Extension
import pybind11
import sys

# Detect the operating system to pass the correct compiler flags
if sys.platform == 'win32':
    compile_args = ['/O2']  # Microsoft Visual C++ flag
else:
    compile_args = ['-O3']  # Linux/Mac GCC/Clang flag

ext_modules = [
    Extension(
        'tactical_math',                 
        ['tactical_math.cpp'],           
        include_dirs=[pybind11.get_include()],
        language='c++',
        extra_compile_args=compile_args   # <--- Dynamically injects the correct flag
    ),
]

setup(
    name='tactical_math',
    version='1.0.0',
    description='C++ Spatial Engine for Orbital Explorer',
    ext_modules=ext_modules,
)