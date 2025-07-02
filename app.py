
from flask import Flask, render_template, request, jsonify, send_file
import os
import diptych_creator
import zipfile
from datetime import datetime
import io
from PIL import Image
import threading
import shutil
from werkzeug.utils import secure_filename
from concurrent.futures import ThreadPoolExecutor

app = Flask(__name__, template_folder='review_app/templates', static_folder='review_app/static')

# --- App Configuration & Caching ---
BASE_CACHE_DIR = os.path.join(os.path.dirname(__file__), '.cache')
UPLOAD_DIR = os.path.join(BASE_CACHE_DIR, 'uploads')
THUMB_CACHE_DIR = os.path.join(BASE_CACHE_DIR, 'thumbnails')
OUTPUT_DIR_BASE = os.path.join(os.path.expanduser("~"), "Downloads")


# Use a thread pool for background tasks
executor = ThreadPoolExecutor(max_workers=4)

# Clean cache on start for a fresh session
if os.path.exists(BASE_CACHE_DIR):
    shutil.rmtree(BASE_CACHE_DIR)
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(THUMB_CACHE_DIR, exist_ok=True)


# --- Progress Tracking ---
progress_data = {"processed": 0, "total": 0}
progress_lock = threading.Lock()

# --- Helper Functions ---
def create_single_thumbnail(full_path):
    """Creates a thumbnail for a single image for the image pool."""
    try:
        filename = os.path.basename(full_path)
        thumb_path = os.path.join(THUMB_CACHE_DIR, filename)
        if not os.path.exists(thumb_path):
            with Image.open(full_path) as img:
                img = diptych_creator.apply_exif_orientation(img)
                img.thumbnail((300, 300))
                img.save(thumb_path, "JPEG", quality=85)
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
            executor.submit(create_single_thumbnail, save_path)
            uploaded_filenames.append(filename)
            
    return jsonify(uploaded_filenames)

@app.route('/thumbnail/<path:filename>')
def get_thumbnail(filename):
    """Serves a pre-generated thumbnail image for the image pool."""
    thumb_path = os.path.join(THUMB_CACHE_DIR, secure_filename(filename))
    if os.path.exists(thumb_path):
        return send_file(thumb_path)
    else:
        return "Thumbnail not ready", 404

# --- WYSIWYG PREVIEW ENDPOINT ---
@app.route('/get_wysiwyg_preview', methods=['POST'])
def get_wysiwyg_preview():
    """
    Generates a high-fidelity, WYSIWYG preview using the exact same
    logic as the final diptych creation. This is the core of the new
    accurate preview system.
    """
    data = request.get_json()
    diptych_data = data.get('diptych')
    if not diptych_data:
        return "Invalid preview request", 400

    config = diptych_data.get('config')
    image1_data = diptych_data.get('image1')
    image2_data = diptych_data.get('image2')

    # Use a lower DPI for previews to make them generate faster.
    # The aspect ratio is maintained, so it's visually identical.
    preview_dpi = 150 
    final_dims = diptych_creator.calculate_pixel_dimensions(config['width'], config['height'], preview_dpi)

    img1 = None
    img2 = None

    if image1_data:
        path1 = os.path.join(UPLOAD_DIR, secure_filename(os.path.basename(image1_data['path'])))
        img1 = diptych_creator.process_source_image(path1, final_dims, image1_data.get('rotation', 0), config.get('fit_mode', 'fill'))

    if image2_data:
        path2 = os.path.join(UPLOAD_DIR, secure_filename(os.path.basename(image2_data['path'])))
        img2 = diptych_creator.process_source_image(path2, final_dims, image2_data.get('rotation', 0), config.get('fit_mode', 'fill'))

    # If no images, nothing to preview
    if not img1 and not img2:
        return "No images to preview", 404

    # Create the canvas using the processed images (some might be None)
    canvas = diptych_creator.create_diptych_canvas(img1, img2, final_dims, config.get('gap', 0))
    if not canvas:
        return "Error creating preview canvas", 500

    # Send the generated preview image back to the browser
    buf = io.BytesIO()
    canvas.save(buf, format='JPEG', quality=90)
    buf.seek(0)
    return send_file(buf, mimetype='image/jpeg')


@app.route('/generate_diptychs', methods=['POST'])
def generate_diptychs():
    """Handles the final generation of one or more diptychs."""
    global progress_data
    data = request.get_json()
    diptych_jobs = data.get('pairs', [])
    should_zip = data.get('zip', True)
    
    # Create a unique output directory for this batch
    output_dir = os.path.join(OUTPUT_DIR_BASE, f"DiptychMaster_{datetime.now().strftime('%Y%m%d_%H%M%S')}")
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
            
            final_dims = diptych_creator.calculate_pixel_dimensions(config['width'], config['height'], config['dpi'])
            path1 = os.path.join(UPLOAD_DIR, secure_filename(os.path.basename(pair_data[0]['path'])))
            path2 = os.path.join(UPLOAD_DIR, secure_filename(os.path.basename(pair_data[1]['path'])))
            final_path = os.path.join(output_dir, f"diptych_{i+1}.jpg")

            diptych_creator.create_diptych(
                {'path': path1, 'rotation': pair_data[0].get('rotation', 0)},
                {'path': path2, 'rotation': pair_data[1].get('rotation', 0)},
                final_path, final_dims, config['gap'], config['fit_mode']
            )
            with progress_lock:
                progress_data["processed"] += 1
                progress_data["final_paths"].append(final_path)
    
    threading.Thread(target=run_generation_task).start()
    return jsonify({"status": "started", "total": len(diptych_jobs)})

@app.route('/get_generation_progress')
def get_generation_progress():
    with progress_lock:
        return jsonify(progress_data)

@app.route('/finalize_download')
def finalize_download():
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
    path = request.args.get('path')
    # Security check: ensure the path is within the allowed base directory
    if path and os.path.abspath(path).startswith(os.path.abspath(OUTPUT_DIR_BASE)):
        if os.path.exists(path):
            return send_file(path, as_attachment=True)
    return "File not found or access denied", 404

if __name__ == '__main__':
    # The start.py script is the recommended way to run the app
    app.run(host='127.0.0.1', port=5000, debug=False)
