from flask import Flask, render_template, request, jsonify, send_file
import os
import diptych_creator
import zipfile
from datetime import datetime
import io
from PIL import Image
import threading
import shutil
import hashlib
import json
from werkzeug.utils import secure_filename
from concurrent.futures import ThreadPoolExecutor

app = Flask(__name__, template_folder='review_app/templates', static_folder='review_app/static')

# --- App Configuration & Caching ---
BASE_CACHE_DIR = os.path.join(os.path.dirname(__file__), '.cache')
UPLOAD_DIR = os.path.join(BASE_CACHE_DIR, 'uploads')
THUMB_CACHE_DIR = os.path.join(BASE_CACHE_DIR, 'thumbnails')
PREGEN_CACHE_DIR = os.path.join(BASE_CACHE_DIR, 'pregenerated')

# Use a thread pool for background tasks like thumbnailing
executor = ThreadPoolExecutor(max_workers=4)

# Clean cache on start for a fresh session
if os.path.exists(BASE_CACHE_DIR):
    shutil.rmtree(BASE_CACHE_DIR)
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(THUMB_CACHE_DIR, exist_ok=True)
os.makedirs(PREGEN_CACHE_DIR, exist_ok=True)

# --- Progress Tracking ---
progress_data = {"processed": 0, "total": 0}
progress_lock = threading.Lock()

# --- Helper Functions ---
def create_single_thumbnail(full_path):
    """Creates a thumbnail for a single image."""
    try:
        filename = os.path.basename(full_path)
        thumb_path = os.path.join(THUMB_CACHE_DIR, filename)
        if not os.path.exists(thumb_path):
            with Image.open(full_path) as img:
                img = diptych_creator.apply_exif_orientation(img)
                img.thumbnail((300, 300))
                img.save(thumb_path, "JPEG", quality=85)
                print(f"Thumbnail created for {filename}")
    except Exception as e:
        print(f"Could not create thumbnail for {os.path.basename(full_path)}: {e}")

# --- Flask Routes ---
@app.route('/')
def index():
    """Renders the main web page."""
    with progress_lock:
        global progress_data
        progress_data = {"processed": 0, "total": 0}
    return render_template('index.html')

@app.route('/upload_images', methods=['POST'])
def upload_images():
    """Handles file uploads and kicks off background thumbnail generation."""
    if 'files[]' not in request.files:
        return jsonify({"error": "No files part in the request"}), 400
    
    files = request.files.getlist('files[]')
    uploaded_filenames = []
    
    for file in files:
        if file.filename and file:
            filename = secure_filename(file.filename)
            save_path = os.path.join(UPLOAD_DIR, filename)
            file.save(save_path)
            # Submit thumbnail creation to the background thread pool
            executor.submit(create_single_thumbnail, save_path)
            uploaded_filenames.append(filename)
            
    # Immediately return the list of filenames so the UI can update
    return jsonify(uploaded_filenames)

@app.route('/thumbnail/<path:filename>')
def get_thumbnail(filename):
    """Serves a pre-generated thumbnail image if it exists."""
    thumb_path = os.path.join(THUMB_CACHE_DIR, secure_filename(filename))
    if os.path.exists(thumb_path):
        return send_file(thumb_path)
    else:
        # If the thumbnail isn't ready yet, return a 404
        return "Thumbnail not ready", 404

@app.route('/get_preview', methods=['POST'])
def get_preview():
    data = request.get_json()
    pair = data.get('pair'); config = data.get('config')
    if not all([pair, config, len(pair) == 2, pair[0], pair[1]]):
        return "Invalid preview request", 400

    path1 = os.path.join(UPLOAD_DIR, secure_filename(os.path.basename(pair[0]['path'])))
    path2 = os.path.join(UPLOAD_DIR, secure_filename(os.path.basename(pair[1]['path'])))

    dims = diptych_creator.calculate_pixel_dimensions(config['width'], config['height'], 72)
    img1 = diptych_creator.process_source_image(path1, dims, pair[0].get('rotation', 0), config.get('fit_mode', 'fill'))
    img2 = diptych_creator.process_source_image(path2, dims, pair[1].get('rotation', 0), config.get('fit_mode', 'fill'))
    if not img1 or not img2: return "Error creating preview", 500
    
    canvas = diptych_creator.create_diptych_canvas(img1, img2, dims, config.get('gap', 0))
    buf = io.BytesIO(); canvas.save(buf, format='JPEG', quality=85); buf.seek(0)
    return send_file(buf, mimetype='image/jpeg')

@app.route('/pregenerate_diptych', methods=['POST'])
def pregenerate_diptych():
    data = request.get_json(); pair_data = data.get('pair'); config = data.get('config')
    filenames_pair = [{'path': secure_filename(os.path.basename(d['path'])), 'rotation': d.get('rotation', 0)} for d in pair_data]
    cache_filename = get_config_hash(filenames_pair, config)
    cached_path = os.path.join(PREGEN_CACHE_DIR, cache_filename)

    if not os.path.exists(cached_path):
        final_dims = diptych_creator.calculate_pixel_dimensions(config['width'], config['height'], config['dpi'])
        path1 = os.path.join(UPLOAD_DIR, secure_filename(os.path.basename(pair_data[0]['path'])))
        path2 = os.path.join(UPLOAD_DIR, secure_filename(os.path.basename(pair_data[1]['path'])))
        executor.submit(diptych_creator.create_diptych,
            {'path': path1, 'rotation': pair_data[0].get('rotation', 0)}, 
            {'path': path2, 'rotation': pair_data[1].get('rotation', 0)}, 
            cached_path, final_dims, config['gap'], config['fit_mode']
        )
    return jsonify({"status": "pre-generation acknowledged"}), 202

@app.route('/generate_diptychs', methods=['POST'])
def generate_diptychs():
    global progress_data; data = request.get_json()
    diptych_jobs = data.get('pairs', []); should_zip = data.get('zip', True)
    output_dir = os.path.join(os.path.expanduser("~"), "Downloads", f"DiptychMaster_{datetime.now().strftime('%Y%m%d_%H%M%S')}")
    os.makedirs(output_dir, exist_ok=True)
    
    with progress_lock:
        progress_data = {"processed": 0, "total": len(diptych_jobs), "output_dir": output_dir, "should_zip": should_zip, "final_paths": []}

    def run_generation_task():
        for i, job in enumerate(diptych_jobs):
            pair_data = job['pair']; config = job['config']
            filenames_pair = [{'path': secure_filename(os.path.basename(d['path'])), 'rotation': d.get('rotation', 0)} for d in pair_data]
            cache_hash = get_config_hash(filenames_pair, config)
            cached_path = os.path.join(PREGEN_CACHE_DIR, cache_hash)
            final_path = os.path.join(output_dir, f"diptych_{i+1}.jpg")
            
            if os.path.exists(cached_path):
                shutil.copy(cached_path, final_path)
            else:
                final_dims = diptych_creator.calculate_pixel_dimensions(config['width'], config['height'], config['dpi'])
                path1 = os.path.join(UPLOAD_DIR, secure_filename(os.path.basename(pair_data[0]['path'])))
                path2 = os.path.join(UPLOAD_DIR, secure_filename(os.path.basename(pair_data[1]['path'])))
                diptych_creator.create_diptych(
                    {'path': path1, 'rotation': pair_data[0].get('rotation', 0)},
                    {'path': path2, 'rotation': pair_data[1].get('rotation', 0)},
                    final_path, final_dims, config['gap'], config['fit_mode']
                )
            with progress_lock:
                progress_data["processed"] += 1; progress_data["final_paths"].append(final_path)
    
    threading.Thread(target=run_generation_task).start()
    return jsonify({"status": "started", "total": len(diptych_jobs)})

@app.route('/get_generation_progress')
def get_generation_progress():
    with progress_lock: return jsonify(progress_data)

@app.route('/finalize_download')
def finalize_download():
    with progress_lock:
        if not progress_data.get("final_paths"): return jsonify({"error": "No files to download"}), 400
        if progress_data["should_zip"]:
            zip_path = os.path.join(progress_data["output_dir"], "diptych_results.zip")
            with zipfile.ZipFile(zip_path, 'w') as zipf:
                for file_path in progress_data["final_paths"]:
                    if os.path.exists(file_path): zipf.write(file_path, os.path.basename(file_path))
            return jsonify({"download_path": zip_path, "is_zip": True})
        else:
            return jsonify({"download_paths": progress_data["final_paths"], "is_zip": False})
            
@app.route('/download_file')
def download_file():
    path = request.args.get('path')
    if path and os.path.exists(path):
        safe_dir = os.path.join(os.path.expanduser("~"), "Downloads")
        # A more robust check to ensure the file is within the intended directory
        if os.path.commonpath([os.path.abspath(path), safe_dir]) == safe_dir:
             return send_file(path, as_attachment=True)
    return "File not found or access denied", 404

if __name__ == '__main__':
    import webbrowser
    threading.Timer(1.25, lambda: webbrowser.open('http://127.0.0.1:5000')).start()
    app.run(host='127.0.0.1', port=5000, debug=False)
