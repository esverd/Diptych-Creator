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
    
    # This block hides the terminal window on Windows for a more app-like feel
    startup_info = None
    if os.name == 'nt':
        startup_info = subprocess.STARTUPINFO()
        startup_info.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    
    # Start the Flask server as a background process
    server_process = subprocess.Popen(command, startupinfo=startup_info)
    
    print("✅ Server is running. Opening application in your browser...")
    
    # Give the server a moment to start up before opening the browser
    time.sleep(2)
    webbrowser.open("http://127.0.0.1:5000")
    
    try:
        # Keep this script alive until the server process is terminated
        # (e.g., by closing the console window that this script is running in)
        server_process.wait()
    except KeyboardInterrupt:
        # This allows you to stop the server by pressing Ctrl+C in the terminal
        print("\nShutting down server...")
        server_process.terminate()
        print("Goodbye!")

if __name__ == '__main__':
    start_app()