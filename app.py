from flask import Flask, render_template, request, jsonify, send_file
import os
import json
import tkinter as tk
from tkinter import filedialog
import diptych_creator # Our core logic module
import zipfile
from datetime import datetime
import threading

app = Flask(__name__, template_folder='review_app/templates', static_folder='review_app/static')

# A simple in-memory cache to hold the image paths for the session
app.config['IMAGE_PATHS'] = []

# --- Helper Functions ---
def open_file_dialog(is_folder):
    """Opens a native file/folder dialog using a separate thread."""
    root = tk.Tk()
    root.withdraw() # Hide the main tkinter window
    if is_folder:
        # Ask for a directory
        path = filedialog.askdirectory(title="Select Image Folder")
        paths = [path] if path else []
    else:
        # Ask for multiple files
        paths = filedialog.askopenfilenames(title="Select Image Files", filetypes=[("Image Files", "*.jpg *.jpeg *.png *.webp")])
    
    app.config['IMAGE_PATHS'] = sorted(list(set(paths)))

# --- Flask Routes ---
@app.route('/')
def index():
    """Renders the main application page."""
    return render_template('index.html')

@app.route('/select_paths', methods=['POST'])
def select_paths():
    """Triggers the Python-based file/folder selection dialog."""
    data = request.get_json()
    is_folder = data.get('is_folder', False)
    
    # Running the dialog in a separate thread prevents the server from hanging
    dialog_thread = threading.Thread(target=open_file_dialog, args=(is_folder,))
    dialog_thread.start()
    dialog_thread.join() # Wait for the dialog to close

    return jsonify({"status": "success", "count": len(app.config['IMAGE_PATHS'])})
    
@app.route('/get_images')
def get_images():
    """Returns the list of full image paths stored in the session."""
    image_paths = app.config.get('IMAGE_PATHS', [])
    return jsonify(image_paths)

@app.route('/image_preview')
def image_preview():
    """Serves an image preview given its full path."""
    path = request.args.get('path')
    if path and os.path.exists(path):
        return send_file(path)
    return "Image not found", 404

@app.route('/generate_diptychs', methods=['POST'])
def generate_diptychs():
    """Receives pairing data from the UI and creates diptychs."""
    data = request.get_json()
    pairs = data.get('pairs', [])
    config = data.get('config', {})
    
    # Create a unique output directory in the user's Downloads folder
    output_dir = os.path.join(os.path.expanduser("~"), "Downloads", f"Diptychs_{datetime.now().strftime('%Y%m%d_%H%M%S')}")
    os.makedirs(output_dir, exist_ok=True)
    
    output_paths = []
    
    # Calculate dimensions and gap from config
    final_dims = diptych_creator.calculate_pixel_dimensions(
        float(config.get('width', 6)), 
        float(config.get('height', 4)), 
        int(config.get('dpi', 300))
    )
    gap_px = int(config.get('gap', 10))

    for i, pair in enumerate(pairs):
        if len(pair) == 2:
            img1_path, img2_path = pair[0], pair[1]
            output_filename = f"diptych_{i+1}.jpg"
            output_path = os.path.join(output_dir, output_filename)
            
            diptych_creator.create_diptych(img1_path, img2_path, output_path, final_dims, gap_px)
            output_paths.append(output_path)

    # Create a ZIP file of the results
    zip_path = os.path.join(output_dir, "diptych_results.zip")
    with zipfile.ZipFile(zip_path, 'w') as zipf:
        for file in output_paths:
            zipf.write(file, os.path.basename(file))
            
    return jsonify({"zip_path": zip_path, "download_name": os.path.basename(zip_path)})

@app.route('/download_zip')
def download_zip():
    """Serves the generated ZIP file for download."""
    path = request.args.get('path')
    download_name = request.args.get('name')
    return send_file(path, as_attachment=True, download_name=download_name)

if __name__ == '__main__':
    # Add the allow_unsafe_werkzeug=True for newer versions of Flask when running with debug mode
    app.run(host='127.0.0.1', port=5000, debug=True)