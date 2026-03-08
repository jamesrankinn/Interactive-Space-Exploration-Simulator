import subprocess
import sys

def boot_terminal():
    print("Initializing workflow automation")
    print("Building Linux containers and compiling C++ Engine")
    
    try:
        # Run the Docker Compose command
        subprocess.run(["docker-compose", "up", "--build"], check=True)
        
    except KeyboardInterrupt:
        # On press of Ctrl+C 
        print("Shutting down the terminal")
        subprocess.run(["docker-compose", "down"])
        print("System completely offline. Containers removed.")
        sys.exit(0)
        
    except FileNotFoundError:
        print("Error: Docker is not running or not installed on this MacBook.")
        print("Please open the 'Docker Desktop' app first.")

if __name__ == "__main__":
    boot_terminal()