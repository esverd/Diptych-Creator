# app.py

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
from PIL import Image, ExifTags

app = Flask(__name__, template_folder='review_app/templates', static_folder='review_app/static')

# --- App Configuration & Caching ---
BASE_CACHE_DIR = os.path.join(os.path.dirname(__file__), '.cache')
UPLOAD_DIR = os.path.join(BASE_CACHE_DIR, 'uploads')
THUMB_CACHE_DIR = os.path.join(BASE_CACHE_DIR, 'thumbnails')
OUTPUT_DIR_BASE = os.path.join(os.path.expanduser("~"), "Downloads")


# Use a thread pool for background tasks
executor = ThreadPoolExecutor(max_workers=4)

# EXIF tag for original capture time
DATE_TAGS = [
    next((k for k, v in ExifTags.TAGS.items() if v == 'DateTimeOriginal'), None),
    next((k for k, v in ExifTags.TAGS.items() if v == 'DateTime'), None)
]

# Clean cache on start for a fresh session
if os.path.exists(BASE_CACHE_DIR):
    shutil.rmtree(BASE_CACHE_DIR)
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(THUMB_CACHE_DIR, exist_ok=True)


# --- Progress Tracking ---
progress_data = {"processed": 0, "total": 0}
progress_lock = threading.Lock()
# Track upload time for each file so auto grouping can fall back to the
# actual upload moment rather than relying on the filesystem timestamp.
UPLOAD_TIMES = {}

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

def get_capture_time(full_path):
    """Return capture datetime from EXIF or file modified time."""
    try:
        with Image.open(full_path) as img:
            exif = img._getexif()
            if exif:
                for tag in DATE_TAGS:
                    if tag and tag in exif:
                        dt_str = exif[tag]
                        try:
                            return datetime.strptime(dt_str, '%Y:%m:%d %H:%M:%S')
                        except Exception:
                            pass
    except Exception:
        pass
    base = os.path.basename(full_path)
    if base in UPLOAD_TIMES:
        return UPLOAD_TIMES[base]
    return datetime.fromtimestamp(os.path.getmtime(full_path))

# --- Flask Routes ---
@app.route('/')
def index():
    """Renders the main web page."""
    with progress_lock:
        global progress_data
        progress_data = {"processed": 0, "total": 0}
    # This now points to the single, updated HTML file
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
            original_name = secure_filename(file.filename)
            filename = original_name
            save_path = os.path.join(UPLOAD_DIR, filename)
            name, ext = os.path.splitext(original_name)
            counter = 1
            # Ensure unique filenames to avoid overwriting existing uploads
            while os.path.exists(save_path):
                filename = f"{name}_{counter}{ext}"
                save_path = os.path.join(UPLOAD_DIR, filename)
                counter += 1

            file.save(save_path)
            UPLOAD_TIMES[filename] = datetime.now()
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

@app.route('/auto_group', methods=['POST'])
def auto_group():
    """Automatically group images into diptychs based on capture time."""
    data = request.get_json() or {}
    threshold = float(data.get('threshold', 2))
    files = [f for f in os.listdir(UPLOAD_DIR) if os.path.isfile(os.path.join(UPLOAD_DIR, f))]
    info = []
    for f in files:
        path = os.path.join(UPLOAD_DIR, f)
        info.append({'name': f, 'time': get_capture_time(path)})
    info.sort(key=lambda x: x['time'])

    pairs = []
    i = 0
    while i < len(info) - 1:
        if (info[i+1]['time'] - info[i]['time']).total_seconds() <= threshold:
            pairs.append([info[i]['name'], info[i+1]['name']])
            i += 2
        else:
            i += 1
    return jsonify({'pairs': pairs})

# --- WYSIWYG PREVIEW ENDPOINT ---
@app.route('/get_wysiwyg_preview', methods=['POST'])
def get_wysiwyg_preview():
    """
    Generates a high-fidelity, WYSIWYG preview using the exact same
    logic as the final diptych creation.
    """
    try:
        data = request.get_json()
        if not data or 'diptych' not in data:
            return "Invalid preview request", 400

        diptych_data = data['diptych']
        config = diptych_data.get('config', {})
        image1_data = diptych_data.get('image1')
        image2_data = diptych_data.get('image2')

        if not image1_data and not image2_data:
            return "No images to preview", 400
        
        # Use the requested DPI but cap it to keep previews fast
        preview_dpi = min(int(config.get('dpi', 72)), 150)

        final_dims, processing_dims, outer_border_px, effective_gap = diptych_creator.calculate_diptych_dimensions(config, preview_dpi)
        border_color = config.get('border_color', 'white')

        inner_w = final_dims[0] - 2 * outer_border_px
        inner_h = final_dims[1] - 2 * outer_border_px
        effective_gap = config.get('gap', 0)

        if config.get('orientation') == 'portrait':
            processing_dims = (inner_w, inner_h - effective_gap)
        else:
            processing_dims = (inner_w - effective_gap, inner_h)

        img1, img2 = None, None
        if image1_data:
            path1 = os.path.join(UPLOAD_DIR, secure_filename(os.path.basename(image1_data['path'])))
            if not os.path.exists(path1):
                return jsonify({"error": f"Image not found: {image1_data['path']}"}), 404
            img1 = diptych_creator.process_source_image(
                path1,
                processing_dims,
                image1_data.get('rotation', 0),
                config.get('fit_mode', 'fill')
            )

        if image2_data:
            path2 = os.path.join(UPLOAD_DIR, secure_filename(os.path.basename(image2_data['path'])))
            if not os.path.exists(path2):
                return jsonify({"error": f"Image not found: {image2_data['path']}"}), 404
            img2 = diptych_creator.process_source_image(
                path2,
                processing_dims,
                image2_data.get('rotation', 0),
                config.get('fit_mode', 'fill')
            )

        if not img1 and not img2:
            return "Error processing images", 500

        canvas = diptych_creator.create_diptych_canvas(img1, img2, final_dims, effective_gap, outer_border_px, border_color)
        if not canvas:
            return "Error creating preview canvas", 500

        buf = io.BytesIO()
        canvas.save(buf, format='JPEG', quality=90)
        buf.seek(0)
        return send_file(buf, mimetype='image/jpeg')

    except Exception as e:
        print(f"Preview generation error: {str(e)}")
        return f"Error generating preview: {str(e)}", 500


@app.route('/generate_diptychs', methods=['POST'])
def generate_diptychs():
    """Handles the final generation of one or more diptychs."""
    global progress_data
    data = request.get_json()
    diptych_jobs = data.get('pairs', [])
    should_zip = data.get('zip', True)
    
    output_dir = os.path.join(OUTPUT_DIR_BASE, f"DiptychMaster_{datetime.now().strftime('%Y%m%d_%H%M%S')}")
    os.makedirs(output_dir, exist_ok=True)
    
    with progress_lock:
        progress_data = {"processed": 0, "total": len(diptych_jobs), "output_dir": output_dir, "should_zip": should_zip, "final_paths": []}

    def run_generation_task():
        for i, job in enumerate(diptych_jobs):
            pair_data = job['pair']
            config = job['config']
            
            # Handle orientation for final output dimensions
            final_dims, _, outer_border_px, gap_px = diptych_creator.calculate_diptych_dimensions(config, config['dpi'])
            path1 = os.path.join(UPLOAD_DIR, secure_filename(os.path.basename(pair_data[0]['path'])))
            path2 = os.path.join(UPLOAD_DIR, secure_filename(os.path.basename(pair_data[1]['path'])))
            final_path = os.path.join(output_dir, f"diptych_{i+1}.jpg")

            border_color = config.get('border_color', 'white')
            diptych_creator.create_diptych(
                {'path': path1, 'rotation': pair_data[0].get('rotation', 0)},
                {'path': path2, 'rotation': pair_data[1].get('rotation', 0)},
                final_path, final_dims, gap_px, config['fit_mode'], config['dpi'], outer_border_px, border_color
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
    if path and os.path.abspath(path).startswith(os.path.abspath(OUTPUT_DIR_BASE)):
        if os.path.exists(path):
            return send_file(path, as_attachment=True)
    return "File not found or access denied", 404

if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5000, debug=False)
