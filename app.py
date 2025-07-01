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

app = Flask(__name__, template_folder='review_app/templates', static_folder='review_app/static')

# --- App Configuration & Caching ---
app.config['IMAGE_FILES'] = []
THUMB_CACHE_DIR = os.path.join(os.path.dirname(__file__), '.cache', 'thumbnails')
PREGEN_CACHE_DIR = os.path.join(os.path.dirname(__file__), '.cache', 'pregenerated')
os.makedirs(THUMB_CACHE_DIR, exist_ok=True)
os.makedirs(PREGEN_CACHE_DIR, exist_ok=True)

# --- Progress Tracking ---
progress_data = {"processed": 0, "total": 0}
progress_lock = threading.Lock()

# --- Helper Functions ---
def open_dialog_and_process_images(is_folder):
    """Opens a native OS dialog and then creates thumbnails for selected images."""
    root = tk.Tk()
    root.withdraw() # Hide the empty tkinter window
    
    if is_folder:
        path = filedialog.askdirectory(title="Select Image Folder")
        if not path: return
        image_paths = [os.path.join(path, f) for f in os.listdir(path) if f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp'))]
    else:
        paths = filedialog.askopenfilenames(title="Select Image Files", filetypes=[("Image Files", "*.jpg *.jpeg *.png *.webp")])
        if not paths: return
        image_paths = list(paths)
    
    app.config['IMAGE_FILES'] = sorted(image_paths)
    create_thumbnails(image_paths)

def create_thumbnails(image_paths):
    """Creates 300x300 thumbnails for the image pool to ensure fast UI performance."""
    print(f"Generating {len(image_paths)} thumbnails...")
    for full_path in image_paths:
        try:
            filename = os.path.basename(full_path)
            thumb_path = os.path.join(THUMB_CACHE_DIR, filename)
            if not os.path.exists(thumb_path):
                    with Image.open(full_path) as img:
                        img.thumbnail((300, 300))
                        img.save(thumb_path, "JPEG")
        except Exception as e:
            print(f"Could not create thumbnail for {filename}: {e}")
    print("Thumbnail generation complete.")

def get_config_hash(pair_data, config):
    """Creates a unique and deterministic filename for a cached diptych."""
    data_string = json.dumps({
        "paths": sorted([d['path'] for d in pair_data]),
        "rotations": [d['rotation'] for d in pair_data],
        "config": {key: config[key] for key in sorted(config)}
    }, sort_keys=True)
    return hashlib.md5(data_string.encode()).hexdigest() + ".jpg"

# --- Flask Routes ---
@app.route('/')
def index():
    """Renders the main web page and resets progress."""
    global progress_data
    progress_data = {"processed": 0, "total": 0}
    return render_template('index.html')

@app.route('/select_images', methods=['POST'])
def select_images():
    """Triggers the OS file/folder selection dialog."""
    is_folder = request.get_json().get('is_folder', False)
    dialog_thread = threading.Thread(target=open_dialog_and_process_images, args=(is_folder,))
    dialog_thread.start()
    dialog_thread.join()
    return jsonify(app.config.get('IMAGE_FILES', []))

@app.route('/thumbnail/<path:filename>')
def get_thumbnail(filename):
    """Serves a pre-generated thumbnail image."""
    return send_file(os.path.join(THUMB_CACHE_DIR, filename))

@app.route('/get_preview', methods=['POST'])
def get_preview():
    """Generates a low-resolution, but dimensionally accurate, preview image in memory."""
    data = request.get_json()
    pair = data.get('pair'); config = data.get('config')
    if not all([pair, config, len(pair) == 2]):
        return "Invalid preview request", 400

    dims = diptych_creator.calculate_pixel_dimensions(config['width'], config['height'], 72)
    img1 = diptych_creator.process_source_image(pair[0]['path'], dims, pair[0]['rotation'], config.get('fit_mode', 'fill'))
    img2 = diptych_creator.process_source_image(pair[1]['path'], dims, pair[1]['rotation'], config.get('fit_mode', 'fill'))
    if not img1 or not img2: return "Error creating preview", 500
    
    is_landscape = dims[0] > dims[1]
    canvas_dims = (dims[0] + config['gap'], dims[1]) if is_landscape else (dims[0], dims[1] + config['gap'])
    canvas = Image.new('RGB', canvas_dims, 'white')
    if is_landscape:
        canvas.paste(img1, (0, 0)); canvas.paste(img2, (img1.width + config['gap'], 0))
    else:
        canvas.paste(img1, (0, 0)); canvas.paste(img2, (0, img1.height + config['gap']))
        
    buf = io.BytesIO(); canvas.save(buf, format='JPEG'); buf.seek(0)
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
        thread = threading.Thread(target=diptych_creator.create_diptych, args=(
            pair_data[0], pair_data[1], cached_path, final_dims, config['gap'], config['fit_mode']
        ))
        thread.start()
    return jsonify({"status": "pre-generation acknowledged"}), 202

@app.route('/generate_diptychs', methods=['POST'])
def generate_diptychs():
    """Starts the final generation process, using cached files where possible."""
    global progress_data
    data = request.get_json(); pairs = data.get('pairs', []); config = data.get('config', {})
    output_dir = os.path.join(os.path.expanduser("~"), "Downloads", f"Diptychs_{datetime.now().strftime('%Y%m%d_%H%M%S')}")
    os.makedirs(output_dir, exist_ok=True)
    
    with progress_lock:
        progress_data = {"processed": 0, "total": len(pairs), "output_dir": output_dir, "config": config, "should_zip": data.get('zip', True), "final_paths": []}

    def run_generation_task():
        for i, pair_data in enumerate(pairs):
            cache_hash = get_config_hash(pair_data, config)
            cached_path = os.path.join(PREGEN_CACHE_DIR, cache_hash)
            final_path = os.path.join(output_dir, f"diptych_{i+1}.jpg")
            
            if os.path.exists(cached_path):
                print(f"Using cached file for diptych_{i+1}.jpg")
                os.link(cached_path, final_path)
            else:
                print(f"Cache miss. Generating diptych_{i+1}.jpg on the fly.")
                final_dims = diptych_creator.calculate_pixel_dimensions(config['width'], config['height'], config['dpi'])
                diptych_creator.create_diptych(pair_data[0], pair_data[1], final_path, final_dims, config['gap'], config['fit_mode'])
            
            with progress_lock:
                progress_data["processed"] += 1
                progress_data["final_paths"].append(final_path)
    
    threading.Thread(target=run_generation_task).start()
    return jsonify({"status": "started", "total": len(pairs)})

@app.route('/get_generation_progress')
def get_generation_progress():
    """Endpoint for the frontend to poll for progress updates."""
    with progress_lock:
        return jsonify(progress_data)

@app.route('/finalize_download')
def finalize_download():
    """Creates the ZIP file or returns individual paths once generation is complete."""
    with progress_lock:
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
    app.run(host='127.0.0.1', port=5000)