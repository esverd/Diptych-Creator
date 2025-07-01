from flask import Flask, render_template, request, jsonify, send_file
import os
import diptych_creator
import zipfile
from datetime import datetime
import io
from PIL import Image
import threading
from concurrent.futures import ThreadPoolExecutor
import tkinter as tk
from tkinter import filedialog
import hashlib
import json
import shutil

app = Flask(__name__, template_folder='review_app/templates', static_folder='review_app/static')

# --- App Configuration & Caching ---
app.config['IMAGE_FILES'] = []
BASE_CACHE_DIR = os.path.join(os.path.dirname(__file__), '.cache')
THUMB_CACHE_DIR = os.path.join(BASE_CACHE_DIR, 'thumbnails')
PREGEN_CACHE_DIR = os.path.join(BASE_CACHE_DIR, 'pregenerated')
# Clean cache on start for a fresh session
if os.path.exists(BASE_CACHE_DIR):
    shutil.rmtree(BASE_CACHE_DIR)
os.makedirs(THUMB_CACHE_DIR, exist_ok=True)
os.makedirs(PREGEN_CACHE_DIR, exist_ok=True)


# --- Progress Tracking ---
progress_data = {"processed": 0, "total": 0}
progress_lock = threading.Lock()

# --- Helper Functions ---
def open_dialog_and_get_images(is_folder):
    """Opens a native OS dialog for file/folder selection."""
    root = tk.Tk()
    root.withdraw()
    
    if is_folder:
        path = filedialog.askdirectory(title="Select Image Folder")
        if not path: return []
        image_paths = [os.path.join(path, f) for f in os.listdir(path) if f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp'))]
    else:
        paths = filedialog.askopenfilenames(title="Select Image Files", filetypes=[("Image Files", "*.jpg *.jpeg *.png *.webp")])
        if not paths: return []
        image_paths = list(paths)
    
    # Store globally for thumbnail creation
    app.config['IMAGE_FILES'] = sorted(list(set(app.config.get('IMAGE_FILES', []) + image_paths)))
    return image_paths

def create_thumbnails(image_paths):
    """Creates 300x300 thumbnails for newly added images."""
    print(f"Generating thumbnails for {len(image_paths)} new images...")
    for full_path in image_paths:
        try:
            filename = os.path.basename(full_path)
            thumb_path = os.path.join(THUMB_CACHE_DIR, filename)
            if not os.path.exists(thumb_path):
                with Image.open(full_path) as img:
                    img = diptych_creator.apply_exif_orientation(img) # Orient before thumbnailing
                    img.thumbnail((300, 300))
                    img.save(thumb_path, "JPEG", quality=85)
        except Exception as e:
            print(f"Could not create thumbnail for {filename}: {e}")
    print("Thumbnail generation complete.")

def get_config_hash(pair_data, config):
    """Creates a unique and deterministic filename for a cached diptych."""
    # Ensure consistent ordering for hashing
    sorted_paths = sorted([d['path'] for d in pair_data])
    data_string = json.dumps({
        "paths": sorted_paths,
        "rotations": [d.get('rotation', 0) for d in pair_data],
        "config": {key: config[key] for key in sorted(config)}
    }, sort_keys=True)
    return hashlib.md5(data_string.encode()).hexdigest() + ".jpg"

# --- Flask Routes ---
@app.route('/')
def index():
    """Renders the main web page and resets progress."""
    with progress_lock:
        global progress_data
        progress_data = {"processed": 0, "total": 0}
    return render_template('index.html')

@app.route('/select_images', methods=['POST'])
def select_images():
    """Triggers the OS file/folder selection dialog and creates thumbnails."""
    is_folder = request.get_json().get('is_folder', False)
    
    # Since tkinter must run in the main thread, we can't easily thread this.
    # The user experience is that the app will hang until they select files.
    # This is a limitation of using a desktop GUI toolkit in a web server.
    new_image_paths = open_dialog_and_get_images(is_folder)
    if new_image_paths:
        create_thumbnails(new_image_paths)
        
    return jsonify(new_image_paths)

@app.route('/thumbnail/<path:filename>')
def get_thumbnail(filename):
    """Serves a pre-generated thumbnail image."""
    thumb_path = os.path.join(THUMB_CACHE_DIR, filename)
    if not os.path.exists(thumb_path):
        # Fallback for safety, though should not be hit in normal flow
        original_path = next((p for p in app.config['IMAGE_FILES'] if os.path.basename(p) == filename), None)
        if original_path:
            create_thumbnails([original_path])
        else:
            return "Thumbnail not found", 404
    return send_file(thumb_path)

@app.route('/get_preview', methods=['POST'])
def get_preview():
    """Generates a low-resolution preview image in memory."""
    data = request.get_json()
    pair = data.get('pair'); config = data.get('config')
    if not all([pair, config, len(pair) == 2]):
        return "Invalid preview request", 400

    # Use a low DPI for previews
    dims = diptych_creator.calculate_pixel_dimensions(config['width'], config['height'], 72)
    
    img1 = diptych_creator.process_source_image(pair[0]['path'], dims, pair[0].get('rotation', 0), config.get('fit_mode', 'fill'))
    img2 = diptych_creator.process_source_image(pair[1]['path'], dims, pair[1].get('rotation', 0), config.get('fit_mode', 'fill'))
    if not img1 or not img2: return "Error creating preview", 500
    
    canvas = diptych_creator.create_diptych_canvas(img1, img2, dims, config.get('gap', 0))
        
    buf = io.BytesIO()
    canvas.save(buf, format='JPEG', quality=85)
    buf.seek(0)
    return send_file(buf, mimetype='image/jpeg')

@app.route('/pregenerate_diptych', methods=['POST'])
def pregenerate_diptych():
    """Generates and caches a high-res diptych in a background thread."""
    data = request.get_json()
    pair_data = data.get('pair'); config = data.get('config')
    cache_filename = get_config_hash(pair_data, config)
    cached_path = os.path.join(PREGEN_CACHE_DIR, cache_filename)

    if not os.path.exists(cached_path):
        final_dims = diptych_creator.calculate_pixel_dimensions(config['width'], config['height'], config['dpi'])
        # Run in background
        thread = threading.Thread(target=diptych_creator.create_diptych, args=(
            pair_data[0], pair_data[1], cached_path, final_dims, config['gap'], config['fit_mode']
        ))
        thread.start()
    return jsonify({"status": "pre-generation acknowledged"}), 202

@app.route('/generate_diptychs', methods=['POST'])
def generate_diptychs():
    """Starts the final generation process for multiple diptychs."""
    global progress_data
    data = request.get_json()
    diptych_jobs = data.get('pairs', [])
    should_zip = data.get('zip', True)
    
    output_dir = os.path.join(os.path.expanduser("~"), "Downloads", f"DiptychMaster_{datetime.now().strftime('%Y%m%d_%H%M%S')}")
    os.makedirs(output_dir, exist_ok=True)
    
    with progress_lock:
        progress_data = {
            "processed": 0, 
            "total": len(diptych_jobs), 
            "output_dir": output_dir, 
            "should_zip": should_zip, 
            "final_paths": []
        }

    def run_generation_task():
        for i, job in enumerate(diptych_jobs):
            pair_data = job['pair']
            config = job['config']
            
            cache_hash = get_config_hash(pair_data, config)
            cached_path = os.path.join(PREGEN_CACHE_DIR, cache_hash)
            final_path = os.path.join(output_dir, f"diptych_{i+1}.jpg")
            
            if os.path.exists(cached_path):
                print(f"Using cached file for diptych_{i+1}.jpg")
                shutil.copy(cached_path, final_path)
            else:
                print(f"Cache miss. Generating diptych_{i+1}.jpg on the fly.")
                final_dims = diptych_creator.calculate_pixel_dimensions(config['width'], config['height'], config['dpi'])
                diptych_creator.create_diptych(pair_data[0], pair_data[1], final_path, final_dims, config['gap'], config['fit_mode'])
            
            with progress_lock:
                progress_data["processed"] += 1
                progress_data["final_paths"].append(final_path)
    
    threading.Thread(target=run_generation_task).start()
    return jsonify({"status": "started", "total": len(diptych_jobs)})

@app.route('/get_generation_progress')
def get_generation_progress():
    """Endpoint for the frontend to poll for progress updates."""
    with progress_lock:
        return jsonify(progress_data)

@app.route('/finalize_download')
def finalize_download():
    """Creates the ZIP file or returns individual paths once generation is complete."""
    with progress_lock:
        if not progress_data.get("final_paths"):
            return jsonify({"error": "No files to download"}), 400
            
        if progress_data["should_zip"]:
            zip_path = os.path.join(progress_data["output_dir"], "diptych_results.zip")
            with zipfile.ZipFile(zip_path, 'w') as zipf:
                for file_path in progress_data["final_paths"]:
                    if os.path.exists(file_path):
                        zipf.write(file_path, os.path.basename(file_path))
            return jsonify({"download_path": zip_path, "is_zip": True})
        else:
            return jsonify({"download_paths": progress_data["final_paths"], "is_zip": False})
            
@app.route('/download_file')
def download_file():
    """Serves a single file for download."""
    path = request.args.get('path')
    if path and os.path.exists(path):
        return send_file(path, as_attachment=True)
    return "File not found", 404

if __name__ == '__main__':
    # Using 'open' is more reliable across platforms than webbrowser.open
    # especially when the server is starting up.
    import webbrowser
    webbrowser.open('http://127.0.0.1:5000')
    app.run(host='127.0.0.1', port=5000, debug=False)
