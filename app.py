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
import uuid

# Configure Flask to look in the `review_app` folder for templates and static assets.
app = Flask(__name__, template_folder='review_app/templates', static_folder='review_app/static')

# --- App Configuration & Caching ---
BASE_CACHE_DIR = os.path.join(os.path.dirname(__file__), '.cache')
UPLOAD_DIR = os.path.join(BASE_CACHE_DIR, 'uploads')
THUMB_CACHE_DIR = os.path.join(BASE_CACHE_DIR, 'thumbnails')
# Save generated diptychs into the user's Downloads folder so they are easy to find.
OUTPUT_DIR_BASE = os.path.join(os.path.expanduser("~"), "Downloads")

# Use a thread pool for background tasks
executor = ThreadPoolExecutor(max_workers=4)

# EXIF tag for original capture time
DATE_TAGS = [
    next((k for k, v in ExifTags.TAGS.items() if v == 'DateTimeOriginal'), None),
    next((k for k, v in ExifTags.TAGS.items() if v == 'DateTime'), None)
]

# Allowed file extensions for upload validation.  Unsupported files will be
# rejected with an error response.  Extensions are case-insensitive.
ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png", "tif", "tiff", "heic", "heif"}

# Clean cache on start for a fresh session
if os.path.exists(BASE_CACHE_DIR):
    shutil.rmtree(BASE_CACHE_DIR)
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(THUMB_CACHE_DIR, exist_ok=True)


# --- Progress Tracking ---
progress_data = {"processed": 0, "total": 0}
progress_lock = threading.Lock()
# Track current diptych order on the server so that client-side
# reordering can be preserved across operations.
diptych_order = []
order_lock = threading.Lock()
# Store outstanding preview jobs keyed by an ID
preview_jobs: dict[str, dict] = {}
preview_lock = threading.Lock()
# Track upload time for each file so auto grouping can fall back to the
# actual upload moment rather than relying on the filesystem timestamp.
UPLOAD_TIMES = {}
# Lock to protect access to UPLOAD_TIMES in multi-threaded contexts
upload_times_lock = threading.Lock()

# Files older than this many seconds will be removed from the upload and thumbnail
# caches automatically.  This prevents long-running sessions from consuming
# unlimited disk space.  Default: 8 hours.
MAX_FILE_AGE_SECONDS = 8 * 3600

def cleanup_task():
    """Background cleanup thread that deletes old uploads and thumbnails."""
    import time
    while True:
        try:
            now = time.time()
            for directory in [UPLOAD_DIR, THUMB_CACHE_DIR]:
                for fname in os.listdir(directory):
                    fpath = os.path.join(directory, fname)
                    try:
                        if os.path.isfile(fpath):
                            age = now - os.path.getmtime(fpath)
                            if age > MAX_FILE_AGE_SECONDS:
                                os.remove(fpath)
                                # Remove from upload times if present
                                with upload_times_lock:
                                    UPLOAD_TIMES.pop(fname, None)
                    except Exception:
                        pass
        except Exception:
            pass
        # Sleep for 10 minutes between cleanups
        time.sleep(600)

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
    with upload_times_lock:
        if base in UPLOAD_TIMES:
            return UPLOAD_TIMES[base]
    return datetime.fromtimestamp(os.path.getmtime(full_path))

# Background task to generate a preview image
def _generate_preview_job(job_id: str, diptych_data: dict) -> None:
    """Worker function executed on the thread pool to create a preview."""
    try:
        config = diptych_data.get('config', {})
        image1_data = diptych_data.get('image1')
        image2_data = diptych_data.get('image2')
        if not image1_data and not image2_data:
            raise ValueError('No images to preview')

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

        img1 = img2 = None
        if image1_data:
            path1 = os.path.join(UPLOAD_DIR, secure_filename(os.path.basename(image1_data['path'])))
            if not os.path.exists(path1):
                raise FileNotFoundError(image1_data['path'])
            crop_focus1 = image1_data.get('crop_focus')
            img1 = diptych_creator.process_source_image(
                path1,
                processing_dims,
                image1_data.get('rotation', 0),
                config.get('fit_mode', 'fill'),
                True,
                border_color,
                crop_focus1,
            )
        if image2_data:
            path2 = os.path.join(UPLOAD_DIR, secure_filename(os.path.basename(image2_data['path'])))
            if not os.path.exists(path2):
                raise FileNotFoundError(image2_data['path'])
            crop_focus2 = image2_data.get('crop_focus')
            img2 = diptych_creator.process_source_image(
                path2,
                processing_dims,
                image2_data.get('rotation', 0),
                config.get('fit_mode', 'fill'),
                True,
                border_color,
                crop_focus2,
            )
        if not img1 and not img2:
            raise RuntimeError('Error processing images')
        canvas = diptych_creator.create_diptych_canvas(img1, img2, final_dims, effective_gap, outer_border_px, border_color)
        buf = io.BytesIO()
        canvas.save(buf, format='JPEG', quality=90)
        buf.seek(0)
        with preview_lock:
            preview_jobs[job_id]['status'] = 'done'
            preview_jobs[job_id]['data'] = buf.read()
    except Exception as e:  # pragma: no cover - hard to trigger in tests
        with preview_lock:
            preview_jobs[job_id]['status'] = 'error'
            preview_jobs[job_id]['error'] = str(e)

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
    uploaded_filenames: list[str] = []
    invalid_files: list[str] = []
    for uploaded in files:
        if uploaded.filename and uploaded:
            original_name = secure_filename(uploaded.filename)
            _, ext = os.path.splitext(original_name)
            if not ext:
                invalid_files.append(original_name)
                continue
            ext = ext.lstrip('.').lower()
            if ext not in ALLOWED_EXTENSIONS:
                invalid_files.append(original_name)
                continue
            # Resolve name collisions by appending a counter
            filename = original_name
            save_path = os.path.join(UPLOAD_DIR, filename)
            name, extension = os.path.splitext(original_name)
            counter = 1
            while os.path.exists(save_path):
                filename = f"{name}_{counter}{extension}"
                save_path = os.path.join(UPLOAD_DIR, filename)
                counter += 1
            uploaded.save(save_path)
            # Record upload time with thread safety
            with upload_times_lock:
                UPLOAD_TIMES[filename] = datetime.now()
            executor.submit(create_single_thumbnail, save_path)
            uploaded_filenames.append(filename)
    response = {"uploaded": uploaded_filenames}
    if invalid_files:
        response["invalid"] = invalid_files
    return jsonify(response), (400 if invalid_files and not uploaded_filenames else 200)

@app.route('/thumbnail/<filename>')
def get_thumbnail(filename):
    """Serves a pre-generated thumbnail image for the image pool."""
    thumb_path = os.path.join(THUMB_CACHE_DIR, secure_filename(filename))
    if os.path.exists(thumb_path):
        return send_file(thumb_path)
    else:
        return "Thumbnail not ready", 404

@app.route('/auto_group', methods=['POST'])
def auto_group():
    """
    Automatically group uploaded images into diptychs.

    Clients may specify a grouping method in the request body using JSON.
    Supported methods are:

    - ``chronological`` (default): sort images by capture time and pair sequentially.
    - ``orientation``: group images by whether they are landscape or portrait.
      Landscape images will be paired with other landscape images first, then
      portrait images will be paired together.  If there is an odd number in
      either group, the leftover image will form a single-image diptych.
    """
    data = request.get_json(silent=True) or {}
    method = (data.get('method') or 'chronological').lower()
    # Gather file metadata
    files = [f for f in os.listdir(UPLOAD_DIR) if os.path.isfile(os.path.join(UPLOAD_DIR, f))]
    info: list[dict] = []
    for f in files:
        path = os.path.join(UPLOAD_DIR, f)
        # Determine orientation: landscape (True) or portrait (False)
        try:
            with Image.open(path) as img:
                landscape = img.width >= img.height
        except Exception:
            landscape = True
        info.append({'name': f, 'time': get_capture_time(path), 'landscape': landscape})
    pairs: list[list[str]] = []
    if method == 'orientation':
        # Split into landscape and portrait lists
        landscapes = [item for item in info if item['landscape']]
        portraits = [item for item in info if not item['landscape']]
        # Sort each group by capture time
        landscapes.sort(key=lambda x: x['time'])
        portraits.sort(key=lambda x: x['time'])
        # Helper to pair items within a list
        def pair_items(items):
            res: list[list[str]] = []
            for i in range(0, len(items), 2):
                pair = [items[i]['name']]
                if i + 1 < len(items):
                    pair.append(items[i + 1]['name'])
                res.append(pair)
            return res
        pairs.extend(pair_items(landscapes))
        pairs.extend(pair_items(portraits))
    else:
        # Chronological by default
        info.sort(key=lambda x: x['time'])
        for i in range(0, len(info), 2):
            pair = [info[i]['name']]
            if i + 1 < len(info):
                pair.append(info[i + 1]['name'])
            pairs.append(pair)
    return jsonify({'pairs': pairs, 'method': method})

# --- Diptych Order Persistence ---
@app.route('/update_diptych_order', methods=['POST'])
def update_diptych_order():
    """Persist the client-provided diptych order on the server."""
    global diptych_order
    data = request.get_json() or {}
    order = data.get('order')
    if not isinstance(order, list):
        return jsonify({"status": "error", "message": "Invalid order"}), 400
    with order_lock:
        diptych_order = order
    return jsonify({"status": "ok"})

# --- Asynchronous Preview API ---
@app.route('/request_preview', methods=['POST'])
def request_preview():
    """Start preview generation in the background and return a job id."""
    data = request.get_json() or {}
    diptych = data.get('diptych')
    if not diptych:
        return "Invalid preview request", 400
    job_id = uuid.uuid4().hex
    with preview_lock:
        preview_jobs[job_id] = {'status': 'pending', 'data': None, 'error': None}
    executor.submit(_generate_preview_job, job_id, diptych)
    return jsonify({'job_id': job_id})

@app.route('/preview_status/<job_id>')
def preview_status(job_id):
    """Return the status of an asynchronous preview job."""
    with preview_lock:
        job = preview_jobs.get(job_id)
    if not job:
        return "Invalid job id", 404
    return jsonify({'status': job['status'], 'error': job['error']})

@app.route('/preview_result/<job_id>')
def preview_result(job_id):
    """Return the final preview JPEG when ready."""
    with preview_lock:
        job = preview_jobs.get(job_id)
    if not job:
        return "Invalid job id", 404
    if job['status'] != 'done':
        return "Preview not ready", 202
    return send_file(io.BytesIO(job['data']), mimetype='image/jpeg')

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
        # Process each image with optional crop focus.  Crop focus may be
        # provided by the client to control which part of the image is kept
        # during cropping.  If absent, center cropping is used.
        img1, img2 = None, None
        if image1_data:
            path1 = os.path.join(UPLOAD_DIR, secure_filename(os.path.basename(image1_data['path'])))
            if not os.path.exists(path1):
                return jsonify({"error": f"Image not found: {image1_data['path']}"}), 404
            crop_focus1 = image1_data.get('crop_focus')
            img1 = diptych_creator.process_source_image(
                path1,
                processing_dims,
                image1_data.get('rotation', 0),
                config.get('fit_mode', 'fill'),
                True,
                config.get('border_color', 'white'),
                crop_focus1,
            )
        if image2_data:
            path2 = os.path.join(UPLOAD_DIR, secure_filename(os.path.basename(image2_data['path'])))
            if not os.path.exists(path2):
                return jsonify({"error": f"Image not found: {image2_data['path']}"}), 404
            crop_focus2 = image2_data.get('crop_focus')
            img2 = diptych_creator.process_source_image(
                path2,
                processing_dims,
                image2_data.get('rotation', 0),
                config.get('fit_mode', 'fill'),
                True,
                config.get('border_color', 'white'),
                crop_focus2,
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
    """Handle the final generation of one or more diptychs.

    This endpoint accepts a list of jobs, each containing a pair of images
    and a configuration dictionary.  A background task is scheduled on the
    thread pool to process all jobs sequentially.  Progress is tracked in
    `progress_data` and can be polled via `/get_generation_progress`.  If an
    error occurs during processing, the progress data will contain an
    `error` field describing the failure.
    """
    global progress_data, diptych_order
    data = request.get_json() or {}
    diptych_jobs = data.get('pairs', [])
    should_zip = bool(data.get('zip', True))
    order = data.get('order')
    if isinstance(order, list):
        with order_lock:
            diptych_order = order
    else:
        with order_lock:
            order = list(diptych_order)
    if order:
        order_map = {
            (item.get('image1'), item.get('image2')): idx
            for idx, item in enumerate(order)
        }
        diptych_jobs.sort(
            key=lambda job: order_map.get(
                (
                    job.get('pair', [{} , {}])[0].get('path'),
                    job.get('pair', [{} , {}])[1].get('path'),
                ),
                len(order_map),
            )
        )
    # Prepare output directory with timestamp
    output_dir = os.path.join(OUTPUT_DIR_BASE, f"DiptychMaster_{datetime.now().strftime('%Y%m%d_%H%M%S')}")
    os.makedirs(output_dir, exist_ok=True)
    with progress_lock:
        progress_data = {
            "processed": 0,
            "total": len(diptych_jobs),
            "output_dir": output_dir,
            "should_zip": should_zip,
            "final_paths": [],
            "error": None,
        }
    def run_generation_task():
        try:
            for idx, job in enumerate(diptych_jobs):
                pair = job.get('pair', [])
                config = job.get('config', {})
                # Compute final canvas dimensions and offsets
                final_dims, _, outer_border_px, gap_px = diptych_creator.calculate_diptych_dimensions(config, config.get('dpi', 72))
                # Resolve file paths safely
                path1 = os.path.join(UPLOAD_DIR, secure_filename(os.path.basename(pair[0]['path'])))
                path2 = os.path.join(UPLOAD_DIR, secure_filename(os.path.basename(pair[1]['path'])))
                final_path = os.path.join(output_dir, f"diptych_{idx + 1}.jpg")
                border_color = config.get('border_color', 'white')
                fit_mode = config.get('fit_mode', 'fill')
                dpi_value = int(config.get('dpi', 72))
                # Extract optional crop focuses for each image if provided
                crop_focus1 = None
                crop_focus2 = None
                if 'crop_focus' in pair[0]:
                    crop_focus1 = pair[0]['crop_focus']
                if 'crop_focus' in pair[1]:
                    crop_focus2 = pair[1]['crop_focus']
                # Create the diptych
                diptych_creator.create_diptych(
                    {'path': path1, 'rotation': pair[0].get('rotation', 0)},
                    {'path': path2, 'rotation': pair[1].get('rotation', 0)},
                    final_path,
                    final_dims,
                    gap_px,
                    fit_mode,
                    dpi_value,
                    outer_border_px,
                    border_color,
                    crop_focus1,
                    crop_focus2,
                    bool(config.get('preserve_exif')),
                )
                with progress_lock:
                    progress_data["processed"] += 1
                    progress_data["final_paths"].append(final_path)
        except Exception as e:
            # Record the error so the client can be notified
            with progress_lock:
                progress_data["error"] = str(e)
    # Schedule the generation on the thread pool
    executor.submit(run_generation_task)
    return jsonify({"status": "started", "total": len(diptych_jobs)})

@app.route('/get_generation_progress')
def get_generation_progress():
    """Return the current generation progress.  If an error occurred during
    background processing, include the error message in the response."""
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

# Start the background cleanup thread after all helper functions and
# globals have been defined.  This ensures that `cleanup_task`,
# `UPLOAD_TIMES` and related locks exist when the thread begins running.
cleanup_thread = threading.Thread(target=cleanup_task, daemon=True)
cleanup_thread.start()

if __name__ == '__main__':
    # Running directly will start the Flask server
    app.run(host='127.0.0.1', port=5000, debug=False)