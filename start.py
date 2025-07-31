"""Utility script to launch the Diptych Creator application.

This script simply spawns the Flask server defined in `app.py` using the
current Python interpreter and opens the default web browser to the local
address. Keeping this logic separate makes it easy for users to double‑click
or run a single command to start the app without cluttering `app.py`.
"""

import subprocess
import webbrowser
import sys
import time
import os

def start_app():
    """Starts the Flask server and opens the web browser."""
    print(" Starting Diptych Creator App...")
    # Use sys.executable to ensure the correct Python interpreter is used
    command = [sys.executable, os.path.join(os.path.dirname(__file__), "app.py")]
    # Hide the terminal window on Windows for a more app-like feel
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
        server_process.wait()
    except KeyboardInterrupt:
        # This allows you to stop the server by pressing Ctrl+C in the terminal
        print("\nShutting down server...")
        server_process.terminate()
        print("Goodbye!")

if __name__ == '__main__':
    start_app()