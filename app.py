from flask import Flask, render_template, request, jsonify, send_file
import os
import json
import tkinter as tk
from tkinter import filedialog
import diptych_creator # Our core logic module
import zipfile
from datetime import datetime

app = Flask(__name__, template_folder='review_app/templates', static_folder='review_app/static')

# --- Helper Functions ---
def get_image_files(paths):
    """Extracts image file paths from a list of paths (can be files or dirs)."""
    image_paths = []
    for path in paths:
        if os.path.isfile(path):
            if path.lower().endswith(('.png', '.jpg', '.jpeg', '.webp')):
                image_paths.append(path)
        elif os.path.isdir(path):
            for root, _, files in os.walk(path):
                for file in files:
                    if file.lower().endswith(('.png', '.jpg', '.jpeg', '.webp')):
                        image_paths.append(os.path.join(root, file))
    return sorted(list(set(image_paths))) # Remove duplicates and sort

# --- Flask Routes ---
@app.route('/')
def index():
    """Renders the main application page."""
    return render_template('index.html')

@app.route('/get_images', methods=['POST'])
def get_images():
    """Handles the user selecting files or a folder."""
    data = request.get_json()
    paths = data.get('paths', [])
    image_paths = get_image_files(paths)
    return jsonify(image_paths)

@app.route('/generate_diptychs', methods=['POST'])
def generate_diptychs():
    """Receives pairing data from the UI and creates diptychs."""
    data = request.get_json()
    pairs = data.get('pairs', [])
    config = data.get('config', {})
    
    output_dir = os.path.join(os.path.expanduser("~"), "Downloads", f"Diptychs_{datetime.now().strftime('%Y%m%d_%H%M%S')}")
    os.makedirs(output_dir, exist_ok=True)
    
    output_paths = []
    
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
    app.run(host='127.0.0.1', port=5000, debug=True)