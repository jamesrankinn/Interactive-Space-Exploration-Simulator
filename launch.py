import subprocess
import sys
import time

def boot_native():
    """Fallback method: Runs the servers natively if Docker is missing."""
    print("\n⚠️  DOCKER NOT DETECTED OR FAILED: Initiating Native Fallback Mode...")
    
    try:
        # Install Python Libraries 
        print("Synchronizing Python environment")
        subprocess.run([sys.executable, "-m", "pip", "install", "-r", "requirements.txt"], cwd="backend", check=True)
        print("Python dependencies synced.\n")
        
        print("Compiling C++ ")
        subprocess.run([sys.executable, "-m", "pip", "install", "-e", "."], cwd="backend", check=True)
        print("C++ Engine compiled successfully.\n")
        
        print("Booting Python API and local web server\n")
        # Start the Flask Backend in the background
        backend = subprocess.Popen([sys.executable, "app.py"], cwd="backend")
        
        # 2Start the Frontend Web Server 
        frontend = subprocess.Popen([sys.executable, "-m", "http.server", "3000"], cwd="frontend")
        
        print("\nORBITAL EXPLORER ONLINE")
        print("Access the C2 Terminal at: http://localhost:3000")
        print("Press Ctrl+C to shut down the entire system.\n")
        
        # Keep the script alive while the servers run
        while True:
            time.sleep(1)
            
    except KeyboardInterrupt:
        print("\nShutting down")
        backend.terminate()
        frontend.terminate()
        print("System completely offline.")
        sys.exit(0)
    except subprocess.CalledProcessError:
        print("\nFATAL ERROR: Could not compile the C++ engine.")
        print("Make sure you have Microsoft C++ Build Tools installed if running natively on Windows without Docker Desktop")
        sys.exit(1)

def boot_terminal():
    """Primary method: Attempts to build and run the Docker containers."""
    print("Initializing Project")
    
    try:
        # Attempt to run Docker Compose
        print("Attempting to build Docker containers...")
        subprocess.run(["docker-compose", "up", "--build"], check=True)
    # on cntrl-c
    except KeyboardInterrupt:
        print("\nShutting down Docker containers...")
        subprocess.run(["docker-compose", "down"])
        print("System completely offline.")
        sys.exit(0)
        
    except Exception:
        # If Docker crashes, isn't installed, or fails, automatically trigger the native fallback
        boot_native()

if __name__ == "__main__":
    boot_terminal()