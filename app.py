from flask import Flask, render_template, request, jsonify, send_file
import os
import tkinter as tk
from tkinter import filedialog
import threading
import diptych_creator
import zipfile
from datetime import datetime
import io
from PIL import Image

app = Flask(__name__, template_folder='review_app/templates', static_folder='review_app/static')

# --- App Configuration & In-Memory Storage ---
# This will hold the paths for the current user session
app.config['IMAGE_FILES'] = []
# This will be the base folder for the session, used to find images
app.config['SOURCE_FOLDER'] = None
THUMBNAIL_CACHE_DIR = os.path.join(os.path.dirname(__file__), '.cache', 'thumbnails')
os.makedirs(THUMBNAIL_CACHE_DIR, exist_ok=True)


def open_dialog_and_process_images(is_folder):
    """
    This function runs in a separate thread to open a dialog
    without blocking the server, then processes the selected images.
    """
    root = tk.Tk()
    root.withdraw()  # Hide the main tkinter window

    if is_folder:
        path = filedialog.askdirectory(title="Select Image Folder")
        if not path: return
        app.config['SOURCE_FOLDER'] = path
        image_paths = [os.path.join(path, f) for f in os.listdir(path) if f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp'))]
    else:
        paths = filedialog.askopenfilenames(title="Select Image Files", filetypes=[("Image Files", "*.jpg *.jpeg *.png *.webp")])
        if not paths: return
        # Use the common parent directory of selected files as the source folder
        app.config['SOURCE_FOLDER'] = os.path.dirname(paths[0])
        image_paths = list(paths)
    
    app.config['IMAGE_FILES'] = sorted(image_paths)
    create_thumbnails(image_paths)


def create_thumbnails(image_paths):
    """Create and cache thumbnails for the given image paths."""
    print(f"Generating {len(image_paths)} thumbnails...")
    for full_path in image_paths:
        thumb_path = os.path.join(THUMBNAIL_CACHE_DIR, os.path.basename(full_path))
        if not os.path.exists(thumb_path):
            try:
                with Image.open(full_path) as img:
                    img.thumbnail((300, 300))
                    img.save(thumb_path, "JPEG")
            except Exception as e:
                print(f"Could not create thumbnail for {os.path.basename(full_path)}: {e}")
    print("Thumbnail generation complete.")


# --- Flask Routes ---
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/select_images', methods=['POST'])
def select_images():
    """Triggers the Python-based file/folder selection dialog."""
    is_folder = request.get_json().get('is_folder', False)
    
    # Run the dialog in a thread to avoid blocking the server
    dialog_thread = threading.Thread(target=open_dialog_and_process_images, args=(is_folder,))
    dialog_thread.start()
    dialog_thread.join()  # Wait for the user to finish selecting

    return jsonify(app.config.get('IMAGE_FILES', []))

@app.route('/thumbnail/<path:filename>')
def get_thumbnail(filename):
    thumb_path = os.path.join(THUMBNAIL_CACHE_DIR, filename)
    if os.path.exists(thumb_path):
        return send_file(thumb_path)
    return "Thumbnail not found", 404

# All other routes (`get_preview`, `generate_diptychs`, `download_file`) remain the same as the previous version.
# Make sure they are included in your app.py file.
# I am including them here for completeness.

@app.route('/get_preview', methods=['POST'])
def get_preview():
    data = request.get_json()
    pair = data.get('pair')
    config = data.get('config')
    
    if not all([pair, config, len(pair) == 2]):
        return "Invalid preview request", 400

    dims = diptych_creator.calculate_pixel_dimensions(config['width'], config['height'], 72)
    
    img1_data = {'path': pair[0]['path'], 'rotation': pair[0]['rotation']}
    img2_data = {'path': pair[1]['path'], 'rotation': pair[1]['rotation']}
    
    is_landscape = dims[0] > dims[1]
    img1 = diptych_creator.process_source_image(img1_data['path'], dims, img1_data['rotation'])
    img2 = diptych_creator.process_source_image(img2_data['path'], dims, img2_data['rotation'])

    if not img1 or not img2: return "Error creating preview", 500

    canvas = Image.new('RGB', (dims[0] + config['gap'], dims[1]) if is_landscape else (dims[0], dims[1] + config['gap']), 'white')
    
    if is_landscape:
        canvas.paste(img1, (0, 0))
        canvas.paste(img2, (img1.width + config['gap'], 0))
    else:
        canvas.paste(img1, (0, 0))
        canvas.paste(img2, (0, img1.height + config['gap']))

    buf = io.BytesIO()
    canvas.save(buf, format='JPEG')
    buf.seek(0)
    
    return send_file(buf, mimetype='image/jpeg')

@app.route('/generate_diptychs', methods=['POST'])
def generate_diptychs():
    data = request.get_json()
    pairs = data.get('pairs', [])
    config = data.get('config', {})
    should_zip = data.get('zip', True)
    
    output_dir = os.path.join(os.path.expanduser("~"), "Downloads", f"Diptychs_{datetime.now().strftime('%Y%m%d_%H%M%S')}")
    os.makedirs(output_dir, exist_ok=True)
    
    final_dims = diptych_creator.calculate_pixel_dimensions(config['width'], config['height'], config['dpi'])

    output_paths = []
    for i, pair_data in enumerate(pairs):
        output_path = os.path.join(output_dir, f"diptych_{i+1}.jpg")
        diptych_creator.create_diptych(pair_data[0], pair_data[1], output_path, final_dims, config['gap'])
        output_paths.append(output_path)

    if should_zip:
        zip_path = os.path.join(output_dir, "diptych_results.zip")
        with zipfile.ZipFile(zip_path, 'w') as zipf:
            for file in output_paths:
                zipf.write(file, os.path.basename(file))
        return jsonify({"download_path": zip_path, "is_zip": True})
    else:
        return jsonify({"download_paths": output_paths, "is_zip": False})

@app.route('/download_file')
def download_file():
    path = request.args.get('path')
    if path and os.path.exists(path):
        return send_file(path, as_attachment=True)
    return "File not found", 404

# --- Main Execution ---
if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5000)