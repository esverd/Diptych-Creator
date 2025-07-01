import subprocess
import webbrowser
import sys
import time
import os

def start_app():
    """Starts the Flask server and opens the web browser."""
    print("🚀 Starting Diptych Creator App...")
    
    # Use sys.executable to ensure the correct Python interpreter is used
    command = [sys.executable, "app.py"]
    
    # Hide the console window on Windows for a more app-like feel
    startup_info = None
    if os.name == 'nt':
        startup_info = subprocess.STARTUPINFO()
        startup_info.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    
    # Start the Flask server as a background process
    server_process = subprocess.Popen(command, startupinfo=startup_info)
    
    print("✅ Server is running. Opening application in your browser...")
    
    time.sleep(2)
    webbrowser.open("http://127.0.0.1:5000")
    
    try:
        # Keep this script alive so it can terminate the server when closed
        server_process.wait()
    except KeyboardInterrupt:
        print("\nShutting down server...")
        server_process.terminate()
        print("Goodbye!")

if __name__ == '__main__':
    start_app()