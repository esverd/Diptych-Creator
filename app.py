# app.py

from flask import Flask, render_template, request, jsonify, send_file
import os
import diptych_creator
import zipfile
from datetime import datetime
import io
import logging
import time
from PIL import Image, ExifTags, ImageColor
import threading
import shutil
from werkzeug.utils import secure_filename
from concurrent.futures import ThreadPoolExecutor
import uuid
import random
import colorsys

# Configure Flask to look in the `review_app` folder for templates and static assets.
app = Flask(__name__, template_folder='review_app/templates', static_folder='review_app/static')
logger = logging.getLogger(__name__)

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

# Allowed file extensions for upload validation. Unsupported files are rejected
# with an error response. Extensions are case-insensitive and must be formats
# Pillow can decode with the dependencies in requirements.txt.
ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png", "webp", "tif", "tiff"}
VALID_FIT_MODES = {"fill", "fit"}
VALID_ORIENTATIONS = {"landscape", "portrait"}


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
generation_jobs: dict[str, dict] = {}
generation_lock = threading.Lock()
current_generation_job_id: str | None = None
download_registry: dict[str, str] = {}
download_lock = threading.Lock()
# Track upload time for each file so auto grouping can fall back to the
# actual upload moment rather than relying on the filesystem timestamp.
UPLOAD_TIMES = {}
# Lock to protect access to UPLOAD_TIMES in multi-threaded contexts
upload_times_lock = threading.Lock()

# Files older than this many seconds will be removed from the upload and thumbnail
# caches automatically.  This prevents long-running sessions from consuming
# unlimited disk space.  Default: 8 hours.
MAX_FILE_AGE_SECONDS = 8 * 3600
cleanup_thread: threading.Thread | None = None

def ensure_cache_dirs() -> None:
    """Create runtime cache directories without deleting user session data."""
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    os.makedirs(THUMB_CACHE_DIR, exist_ok=True)

def reset_cache() -> None:
    """Clear transient runtime caches for an explicit local app startup."""
    if os.path.exists(BASE_CACHE_DIR):
        shutil.rmtree(BASE_CACHE_DIR)
    ensure_cache_dirs()

ensure_cache_dirs()

def cleanup_task():
    """Background cleanup thread that deletes old uploads and thumbnails."""
    while True:
        try:
            now = time.time()
            ensure_cache_dirs()
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
                        logger.exception("Failed cleaning cache file %s", fpath)
            with preview_lock:
                expired = [
                    job_id for job_id, job in preview_jobs.items()
                    if now - job.get('created_at', now) > MAX_FILE_AGE_SECONDS
                ]
                for job_id in expired:
                    preview_jobs.pop(job_id, None)
        except Exception:
            logger.exception("Background cleanup task failed")
        # Sleep for 10 minutes between cleanups
        time.sleep(600)

# --- Helper Functions ---
def start_background_services(clean_cache=False):
    """Start runtime background services once."""
    global cleanup_thread
    if clean_cache:
        reset_cache()
    else:
        ensure_cache_dirs()
    if cleanup_thread and cleanup_thread.is_alive():
        return
    cleanup_thread = threading.Thread(target=cleanup_task, daemon=True)
    cleanup_thread.start()

def thumbnail_cache_name(filename):
    """Return the thumbnail cache filename for an uploaded image filename."""
    return f"{secure_filename(filename)}.jpg"

def flatten_thumbnail_image(img):
    """Flatten thumbnails to RGB against white so transparent pixels stay neutral."""
    if img.mode in ('RGBA', 'LA') or ('transparency' in img.info):
        rgba = img.convert('RGBA')
        background = Image.new('RGBA', rgba.size, 'white')
        background.alpha_composite(rgba)
        return background.convert('RGB')
    return img.convert('RGB')

def create_single_thumbnail(full_path):
    """Creates a thumbnail for a single image for the image pool."""
    try:
        ensure_cache_dirs()
        filename = os.path.basename(full_path)
        thumb_path = os.path.join(THUMB_CACHE_DIR, thumbnail_cache_name(filename))
        if not os.path.exists(thumb_path):
            with Image.open(full_path) as img:
                img = diptych_creator.apply_exif_orientation(img)
                img.thumbnail((300, 300))
                img = flatten_thumbnail_image(img)
                img.save(thumb_path, "JPEG", quality=85)
    except Exception as e:
        logger.exception("Could not create thumbnail for %s", os.path.basename(full_path))

def normalize_config(config, dpi_cap=None, both_images=True):
    """Validate and normalize a client config, returning dimensions and values."""
    config = config or {}
    try:
        width = float(config.get('width', 10))
        height = float(config.get('height', 8))
        dpi = int(config.get('dpi', 72))
        gap = int(config.get('gap', 0))
        outer_border = int(config.get('outer_border', 0))
    except (TypeError, ValueError) as exc:
        raise ValueError('Width, height, DPI, spacing, and border must be numeric') from exc

    if width <= 0 or height <= 0:
        raise ValueError('Width and height must be greater than zero')
    if dpi <= 0 or dpi > 1200:
        raise ValueError('DPI must be between 1 and 1200')
    if gap < 0 or outer_border < 0:
        raise ValueError('Spacing and outer border cannot be negative')
    if dpi_cap is not None:
        dpi = min(dpi, dpi_cap)

    orientation = config.get('orientation') or 'landscape'
    if orientation not in VALID_ORIENTATIONS:
        raise ValueError('Orientation must be landscape or portrait')

    fit_mode = config.get('fit_mode', 'fill')
    if fit_mode not in VALID_FIT_MODES:
        raise ValueError('Image fitting must be fill or fit')

    border_color = config.get('border_color', 'white')
    try:
        ImageColor.getrgb(border_color)
    except ValueError as exc:
        raise ValueError('Border color is not valid') from exc

    normalized = {
        'width': width,
        'height': height,
        'dpi': dpi,
        'gap': gap,
        'outer_border': outer_border,
        'orientation': orientation,
        'fit_mode': fit_mode,
        'border_color': border_color,
        'preserve_exif': bool(config.get('preserve_exif')),
    }
    final_dims, processing_dims, outer_border_px, gap_px = diptych_creator.calculate_diptych_dimensions(
        normalized,
        dpi,
        both_images=both_images,
    )
    return normalized, final_dims, processing_dims, outer_border_px, gap_px

def resolve_uploaded_image(image_data):
    """Return normalized image job data for an uploaded file reference."""
    if not image_data:
        return None
    raw_path = image_data.get('path') if isinstance(image_data, dict) else None
    if not raw_path:
        raise ValueError('Image path is required')
    filename = secure_filename(os.path.basename(str(raw_path)))
    if not filename:
        raise ValueError('Image path is invalid')
    path = os.path.join(UPLOAD_DIR, filename)
    if not os.path.exists(path):
        raise FileNotFoundError(f"Image not found: {raw_path}")
    try:
        rotation = int(image_data.get('rotation', 0)) % 360
    except (TypeError, ValueError):
        rotation = 0
    return {
        'path': path,
        'rotation': rotation,
        'crop_focus': image_data.get('crop_focus'),
    }

def render_diptych_preview(diptych_data, dpi_cap=150):
    """Build a JPEG preview canvas from the same sizing logic used for output."""
    config = diptych_data.get('config', {})
    image1_data = diptych_data.get('image1')
    image2_data = diptych_data.get('image2')
    image1 = resolve_uploaded_image(image1_data)
    image2 = resolve_uploaded_image(image2_data)
    if not image1 and not image2:
        raise ValueError('No images to preview')

    normalized, final_dims, processing_dims, outer_border_px, gap_px = normalize_config(
        config,
        dpi_cap=dpi_cap,
        both_images=bool(image1 and image2),
    )
    border_color = normalized['border_color']
    fit_mode = normalized['fit_mode']
    is_landscape = final_dims[0] >= final_dims[1]

    img1 = img2 = None
    if image1:
        img1 = diptych_creator.process_source_image(
            image1['path'],
            processing_dims,
            image1['rotation'],
            fit_mode,
            True,
            border_color,
            image1['crop_focus'],
            is_landscape,
        )
        if img1 is None:
            raise RuntimeError(f"Error processing image: {os.path.basename(image1['path'])}")
    if image2:
        img2 = diptych_creator.process_source_image(
            image2['path'],
            processing_dims,
            image2['rotation'],
            fit_mode,
            True,
            border_color,
            image2['crop_focus'],
            is_landscape,
        )
        if img2 is None:
            raise RuntimeError(f"Error processing image: {os.path.basename(image2['path'])}")
    return diptych_creator.create_diptych_canvas(img1, img2, final_dims, gap_px, outer_border_px, border_color)

def pair_image_at(pair, index):
    if isinstance(pair, list) and len(pair) > index and isinstance(pair[index], dict):
        return pair[index]
    return None

def job_order_key(job):
    pair = job.get('pair', []) if isinstance(job, dict) else []
    image1 = pair_image_at(pair, 0)
    image2 = pair_image_at(pair, 1)
    return (
        image1.get('path') if image1 else None,
        image2.get('path') if image2 else None,
    )

def register_download(path):
    download_id = uuid.uuid4().hex
    with download_lock:
        download_registry[download_id] = path
    return download_id

def is_safe_output_path(path):
    try:
        base = os.path.abspath(OUTPUT_DIR_BASE)
        target = os.path.abspath(path)
        return os.path.commonpath([base, target]) == base
    except (TypeError, ValueError):
        return False

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
        canvas = render_diptych_preview(diptych_data)
        buf = io.BytesIO()
        canvas.save(buf, format='JPEG', quality=90)
        buf.seek(0)
        with preview_lock:
            if job_id in preview_jobs:
                preview_jobs[job_id]['status'] = 'done'
                preview_jobs[job_id]['data'] = buf.read()
    except Exception as e:  # pragma: no cover - hard to trigger in tests
        logger.exception("Preview job %s failed", job_id)
        with preview_lock:
            if job_id in preview_jobs:
                preview_jobs[job_id]['status'] = 'error'
                preview_jobs[job_id]['error'] = str(e)

# --- Flask Routes ---
@app.route('/')
def index():
    """Renders the main web page."""
    ensure_cache_dirs()
    return render_template('index.html')

@app.route('/upload_images', methods=['POST'])
def upload_images():
    """Handles file uploads and kicks off background thumbnail generation."""
    ensure_cache_dirs()
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
            try:
                with Image.open(save_path) as img:
                    img.verify()
            except Exception:
                try:
                    os.remove(save_path)
                except OSError:
                    pass
                invalid_files.append(original_name)
                continue
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
    thumb_path = os.path.join(THUMB_CACHE_DIR, thumbnail_cache_name(filename))
    if os.path.exists(thumb_path):
        return send_file(thumb_path, mimetype='image/jpeg')
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
    - ``aspect_ratio``: sort by each image's width/height ratio and pair similar
      ratios together.
    - ``dominant_color``: approximate the dominant colour of each image and
      pair by similar hues.
    - ``random``: shuffle images randomly before pairing.
    """
    data = request.get_json(silent=True) or {}
    method = (data.get('method') or 'chronological').lower()
    # Gather file metadata
    ensure_cache_dirs()
    files = [
        f for f in os.listdir(UPLOAD_DIR)
        if os.path.isfile(os.path.join(UPLOAD_DIR, f))
        and os.path.splitext(f)[1].lstrip('.').lower() in ALLOWED_EXTENSIONS
    ]
    info: list[dict] = []
    for f in files:
        path = os.path.join(UPLOAD_DIR, f)
        try:
            with Image.open(path) as img:
                img = diptych_creator.apply_exif_orientation(img)
                landscape = img.width >= img.height
                ratio = img.width / img.height if img.height else 1.0
                # Downscale to 1x1 to approximate dominant colour quickly
                r, g, b = img.resize((1, 1)).convert('RGB').getpixel((0, 0))
                hue = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)[0]
        except Exception:
            landscape = True
            ratio = 1.0
            hue = 0.0
        info.append({
            'name': f,
            'time': get_capture_time(path),
            'landscape': landscape,
            'ratio': ratio,
            'hue': hue,
        })
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
    elif method == 'aspect_ratio':
        info.sort(key=lambda x: x['ratio'])
        for i in range(0, len(info), 2):
            pair = [info[i]['name']]
            if i + 1 < len(info):
                pair.append(info[i + 1]['name'])
            pairs.append(pair)
    elif method == 'dominant_color':
        info.sort(key=lambda x: x['hue'])
        for i in range(0, len(info), 2):
            pair = [info[i]['name']]
            if i + 1 < len(info):
                pair.append(info[i + 1]['name'])
            pairs.append(pair)
    elif method == 'random':
        random.shuffle(info)
        for i in range(0, len(info), 2):
            pair = [info[i]['name']]
            if i + 1 < len(info):
                pair.append(info[i + 1]['name'])
            pairs.append(pair)
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
        preview_jobs[job_id] = {'status': 'pending', 'data': None, 'error': None, 'created_at': time.time()}
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
        canvas = render_diptych_preview(data['diptych'])
        buf = io.BytesIO()
        canvas.save(buf, format='JPEG', quality=90)
        buf.seek(0)
        return send_file(buf, mimetype='image/jpeg')
    except FileNotFoundError as e:
        return jsonify({"error": str(e)}), 404
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        logger.exception("Preview generation error")
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
    global progress_data, diptych_order, current_generation_job_id
    data = request.get_json() or {}
    diptych_jobs = data.get('pairs', [])
    if not isinstance(diptych_jobs, list):
        return jsonify({"error": "pairs must be a list"}), 400
    diptych_jobs = [
        job for job in diptych_jobs
        if isinstance(job, dict) and (pair_image_at(job.get('pair', []), 0) or pair_image_at(job.get('pair', []), 1))
    ]
    if not diptych_jobs:
        return jsonify({"error": "At least one image is required for generation"}), 400

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
            if isinstance(item, dict)
        }
        diptych_jobs.sort(
            key=lambda job: order_map.get(job_order_key(job), len(order_map))
        )
    job_id = uuid.uuid4().hex
    # Prepare a unique output directory. The job suffix prevents rapid
    # back-to-back generations from overwriting files created in the same second.
    output_dir = os.path.join(
        OUTPUT_DIR_BASE,
        f"DiptychMaster_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{job_id[:8]}",
    )
    os.makedirs(output_dir, exist_ok=True)
    progress_entry = {
        "job_id": job_id,
        "processed": 0,
        "total": len(diptych_jobs),
        "output_dir": output_dir,
        "should_zip": should_zip,
        "final_paths": [],
        "error": None,
        "created_at": time.time(),
        "done": False,
    }
    with progress_lock:
        progress_data = progress_entry
    with generation_lock:
        generation_jobs[job_id] = progress_entry
        current_generation_job_id = job_id

    def run_generation_task():
        try:
            for idx, job in enumerate(diptych_jobs):
                pair = job.get('pair', [])
                config = job.get('config', {})
                image1 = resolve_uploaded_image(pair_image_at(pair, 0))
                image2 = resolve_uploaded_image(pair_image_at(pair, 1))
                if not image1 and not image2:
                    raise ValueError('At least one image is required for each output')
                normalized, final_dims, _, outer_border_px, gap_px = normalize_config(
                    config,
                    both_images=bool(image1 and image2),
                )
                final_path = os.path.join(output_dir, f"diptych_{idx + 1}.jpg")
                created_path = diptych_creator.create_diptych(
                    image1,
                    image2,
                    final_path,
                    final_dims,
                    gap_px,
                    normalized['fit_mode'],
                    normalized['dpi'],
                    outer_border_px,
                    normalized['border_color'],
                    image1.get('crop_focus') if image1 else None,
                    image2.get('crop_focus') if image2 else None,
                    normalized['preserve_exif'],
                )
                if not created_path or not os.path.exists(created_path):
                    raise RuntimeError(f"Output was not created: {os.path.basename(final_path)}")
                with progress_lock:
                    progress_data["processed"] += 1
                    progress_data["final_paths"].append(created_path)
        except Exception as e:
            # Record the error so the client can be notified
            logger.exception("Generation job %s failed", job_id)
            with progress_lock:
                progress_data["error"] = str(e)
        finally:
            with progress_lock:
                progress_data["done"] = True
    # Schedule the generation on the thread pool
    executor.submit(run_generation_task)
    return jsonify({"status": "started", "total": len(diptych_jobs), "job_id": job_id})

@app.route('/get_generation_progress')
def get_generation_progress():
    """Return the current generation progress.  If an error occurred during
    background processing, include the error message in the response."""
    job_id = request.args.get('job_id') or current_generation_job_id
    if job_id:
        with generation_lock:
            job = generation_jobs.get(job_id)
        if job:
            return jsonify(job)
    with progress_lock:
        return jsonify(progress_data)

@app.route('/finalize_download')
def finalize_download():
    job_id = request.args.get('job_id') or current_generation_job_id
    with generation_lock:
        selected_progress = generation_jobs.get(job_id) if job_id else None
    if selected_progress is None:
        with progress_lock:
            selected_progress = dict(progress_data)
    with progress_lock:
        if not selected_progress.get("final_paths"):
            return jsonify({"error": "No files to download"}), 400
        if selected_progress.get("error"):
            return jsonify({"error": selected_progress["error"]}), 400
        if selected_progress["should_zip"]:
            zip_path = os.path.join(selected_progress["output_dir"], "diptych_results.zip")
            with zipfile.ZipFile(zip_path, 'w') as zipf:
                for file_path in selected_progress["final_paths"]:
                    if os.path.exists(file_path):
                        zipf.write(file_path, os.path.basename(file_path))
            return jsonify({"download_path": zip_path, "download_id": register_download(zip_path), "is_zip": True})
        else:
            return jsonify({
                "download_paths": selected_progress["final_paths"],
                "download_ids": [register_download(path) for path in selected_progress["final_paths"]],
                "is_zip": False,
            })

@app.route('/download_file')
def download_file():
    download_id = request.args.get('id')
    path = None
    if download_id:
        with download_lock:
            path = download_registry.get(download_id)
        if not path:
            return "File not found or access denied", 404
    else:
        path = request.args.get('path')
    if path and is_safe_output_path(path):
        if os.path.exists(path):
            return send_file(path, as_attachment=True)
    return "File not found or access denied", 404

if __name__ == '__main__':
    # Running directly will start the Flask server
    logging.basicConfig(level=os.environ.get('LOG_LEVEL', 'INFO'))
    start_background_services(clean_cache=os.environ.get('DIPTYCH_CLEAN_CACHE', '1') != '0')
    host = os.environ.get('FLASK_HOST', '127.0.0.1')
    port = int(os.environ.get('FLASK_PORT', '5000'))
    app.run(host=host, port=port, debug=False)
