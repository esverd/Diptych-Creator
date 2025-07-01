import subprocess
import webbrowser
import sys
import time

def start_app():
    """Starts the Flask server and opens the web browser."""
    print("🚀 Starting Diptych Creator App...")
    
    # Use sys.executable to ensure the correct Python interpreter is used
    command = [sys.executable, "app.py"]
    
    # Start the Flask server as a background process
    # Use DEVNULL to hide server logs from the user's console for a cleaner experience
    server_process = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    
    print("✅ Server is running. Opening application in your browser...")
    
    # Give the server a moment to start
    time.sleep(2)
    webbrowser.open("http://127.0.0.1:5000")
    
    try:
        # Keep the script alive until the server process is terminated (e.g., by closing the console)
        server_process.wait()
    except KeyboardInterrupt:
        # Terminate the server gracefully if the user presses Ctrl+C in the console
        print("\nShutting down server...")
        server_process.terminate()
        print("Goodbye!")

if __name__ == '__main__':
    start_app()