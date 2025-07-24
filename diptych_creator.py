# diptych_creator.py

from PIL import Image, ExifTags
import os

try:
    ORIENTATION_TAG = next(k for k, v in ExifTags.TAGS.items() if v == 'Orientation')
except (AttributeError, StopIteration):
    ORIENTATION_TAG = None

def calculate_pixel_dimensions(width_in, height_in, dpi):
    return (int(width_in * dpi), int(height_in * dpi))

def apply_exif_orientation(img):
    if not ORIENTATION_TAG or not hasattr(img, '_getexif'):
        return img
    try:
        exif = img._getexif()
        if exif and ORIENTATION_TAG in exif:
            orientation = exif[ORIENTATION_TAG]
            orient_map = {3: 180, 6: 270, 8: 90}
            if orientation in orient_map:
                img = img.rotate(orient_map[orientation], expand=True)
    except (AttributeError, KeyError, IndexError, TypeError):
        pass
    return img

def process_source_image(image_path, target_diptych_dims, rotation_override=0, fit_mode='fill', auto_rotate=True):
    try:
        with Image.open(image_path) as img:
            img = apply_exif_orientation(img)
            if rotation_override != 0:
                img = img.rotate(rotation_override, expand=True)

            diptych_w, diptych_h = target_diptych_dims
            is_landscape_diptych = diptych_w > diptych_h

            half_w = diptych_w // 2 if is_landscape_diptych else diptych_w
            half_h = diptych_h if is_landscape_diptych else diptych_h // 2

            if auto_rotate and rotation_override == 0 and half_w != half_h:
                cell_landscape = half_w > half_h
                img_landscape = img.width > img.height
                if cell_landscape != img_landscape:
                    img = img.rotate(90, expand=True)

            target_aspect = half_w / half_h
            
            if fit_mode == 'fill':
                img_aspect = img.width / img.height
                if img_aspect > target_aspect:
                    new_width = int(target_aspect * img.height)
                    offset = (img.width - new_width) // 2
                    img = img.crop((offset, 0, img.width - offset, img.height))
                else:
                    new_height = int(img.width / target_aspect)
                    offset = (img.height - new_height) // 2
                    img = img.crop((0, offset, img.width, img.height - offset))
                return img.resize((half_w, half_h), Image.Resampling.LANCZOS)
            else:
                img.thumbnail((half_w, half_h), Image.Resampling.LANCZOS)
                background = Image.new('RGB', (half_w, half_h), 'white')
                paste_x = (half_w - img.width) // 2
                paste_y = (half_h - img.height) // 2
                background.paste(img, (paste_x, paste_y))
                return background
    except Exception as e:
        print(f"Error processing {image_path}: {e}")
        return None

def create_diptych_canvas(img1, img2, final_dims, gap_px, outer_border_px=0, border_color='white'):
    final_width, final_height = final_dims
    is_landscape_diptych = final_width > final_height
    half_w = final_width // 2 if is_landscape_diptych else final_width
    half_h = final_height if is_landscape_diptych else final_height // 2

    # Use gap only when both images are present
    effective_gap = gap_px if img1 and img2 else 0

    # Calculate canvas size including outer border
    canvas_w = final_width + effective_gap + 2 * outer_border_px if is_landscape_diptych else final_width + 2 * outer_border_px
    canvas_h = final_height + 2 * outer_border_px if is_landscape_diptych else final_height + effective_gap + 2 * outer_border_px
    canvas = Image.new('RGB', (canvas_w, canvas_h), border_color)

    # Center images in their cells
    if is_landscape_diptych:
        # Left image
        if img1:
            x1 = outer_border_px + (half_w - img1.width) // 2
            y1 = outer_border_px + (half_h - img1.height) // 2
            canvas.paste(img1, (x1, y1))
        # Right image
        if img2:
            x2 = outer_border_px + half_w + effective_gap + (half_w - img2.width) // 2
            y2 = outer_border_px + (half_h - img2.height) // 2
            canvas.paste(img2, (x2, y2))
    else:
        # Top image
        if img1:
            x1 = outer_border_px + (half_w - img1.width) // 2
            y1 = outer_border_px + (half_h - img1.height) // 2
            canvas.paste(img1, (x1, y1))
        # Bottom image
        if img2:
            x2 = outer_border_px + (half_w - img2.width) // 2
            y2 = outer_border_px + half_h + effective_gap + (half_h - img2.height) // 2
            canvas.paste(img2, (x2, y2))
    return canvas

def create_diptych(image_data1, image_data2, output_path, final_dims, gap_px, fit_mode, dpi, outer_border_px=0, border_color='white'):
    """Processes two source images and saves the resulting diptych with correct DPI and outer border."""
    img1 = process_source_image(image_data1['path'], final_dims, image_data1.get('rotation', 0), fit_mode)
    img2 = process_source_image(image_data2['path'], final_dims, image_data2.get('rotation', 0), fit_mode)
    if not img1 or not img2:
        print(f"Skipping diptych due to image processing error.")
        return
    canvas = create_diptych_canvas(img1, img2, final_dims, gap_px, outer_border_px, border_color)
    # Correctly save with the specified DPI from the config
    canvas.save(output_path, 'jpeg', quality=95, dpi=(dpi, dpi))
    print(f"Successfully created diptych: {os.path.basename(output_path)}")