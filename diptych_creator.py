from PIL import Image, ExifTags
import os

# Find the orientation tag from EXIF data
try:
    ORIENTATION_TAG = next(k for k, v in ExifTags.TAGS.items() if v == 'Orientation')
except (AttributeError, StopIteration):
    ORIENTATION_TAG = None

def calculate_pixel_dimensions(width_in, height_in, dpi):
    """Calculates pixel dimensions from inches and DPI."""
    return (int(width_in * dpi), int(height_in * dpi))

def apply_exif_orientation(img):
    """Applies EXIF orientation to an image if the tag exists."""
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

def process_source_image(image_path, target_diptych_dims, rotation_override=0, fit_mode='fill'):
    """
    Opens, orients, crops/fits, and resizes a single source image 
    to fit its half of the diptych.
    """
    try:
        with Image.open(image_path) as img:
            img = apply_exif_orientation(img)
            
            if rotation_override != 0:
                img = img.rotate(rotation_override, expand=True)

            diptych_w, diptych_h = target_diptych_dims
            is_landscape_diptych = diptych_w > diptych_h
            
            half_w = diptych_w // 2 if is_landscape_diptych else diptych_w
            half_h = diptych_h if is_landscape_diptych else diptych_h // 2
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

            else:  # 'fit' mode
                # *** CENTERING FIX: Ensure perfect centering in the cell ***
                img.thumbnail((half_w, half_h), Image.Resampling.LANCZOS)
                
                # Create a new background for this specific half
                background = Image.new('RGB', (half_w, half_h), 'white')
                
                # Calculate paste position to center it
                paste_x = (half_w - img.width) // 2
                paste_y = (half_h - img.height) // 2
                
                background.paste(img, (paste_x, paste_y))
                return background

    except Exception as e:
        print(f"Error processing {image_path}: {e}")
        return None

def create_diptych_canvas(img1, img2, final_dims, gap_px):
    """Creates the diptych canvas from two pre-processed images."""
    final_width, final_height = final_dims
    is_landscape_diptych = final_width > final_height

    canvas_w = final_width + gap_px if is_landscape_diptych else final_width
    canvas_h = final_height if is_landscape_diptych else final_height + gap_px
    canvas = Image.new('RGB', (canvas_w, canvas_h), 'white')

    if is_landscape_diptych:
        canvas.paste(img1, (0, 0))
        canvas.paste(img2, (img1.width + gap_px, 0))
    else:
        canvas.paste(img1, (0, 0))
        canvas.paste(img2, (0, img1.height + gap_px))
    
    return canvas

def create_diptych(image_data1, image_data2, output_path, final_dims, gap_px, fit_mode):
    """Processes two source images and saves the resulting diptych."""
    img1 = process_source_image(image_data1['path'], final_dims, image_data1.get('rotation', 0), fit_mode)
    img2 = process_source_image(image_data2['path'], final_dims, image_data2.get('rotation', 0), fit_mode)

    if not img1 or not img2: 
        print(f"Skipping diptych due to image processing error on: {os.path.basename(image_data1['path'])} or {os.path.basename(image_data2['path'])}")
        return

    canvas = create_diptych_canvas(img1, img2, final_dims, gap_px)
    
    canvas.save(output_path, 'jpeg', quality=95, dpi=(300, 300))
    print(f"Successfully created diptych: {os.path.basename(output_path)}")
