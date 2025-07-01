from PIL import Image, ExifTags
import os

# Find the orientation tag from EXIF data
try:
    for orientation in ExifTags.TAGS.keys():
        if ExifTags.TAGS[orientation] == 'Orientation':
            ORIENTATION_TAG = orientation
            break
except:
    ORIENTATION_TAG = None

def calculate_pixel_dimensions(width_in, height_in, dpi):
    """Calculates pixel dimensions from inches and DPI."""
    return (int(width_in * dpi), int(height_in * dpi))

def apply_exif_orientation(img):
    """Applies EXIF orientation to an image if the tag exists."""
    if not ORIENTATION_TAG:
        return img
        
    try:
        exif = img._getexif()
        if exif and ORIENTATION_TAG in exif:
            orientation = exif[ORIENTATION_TAG]
            if orientation == 3:
                img = img.rotate(180, expand=True)
            elif orientation == 6:
                img = img.rotate(270, expand=True)
            elif orientation == 8:
                img = img.rotate(90, expand=True)
    except (AttributeError, KeyError, IndexError):
        # This handles cases where there's no EXIF data or it's malformed
        pass
    return img

def process_source_image(image_path, target_diptych_dims, rotation_override=0, fit_mode='fill'):
    """
    Opens, orients, crops/fits, and resizes a single source image 
    to fit its half of the diptych.
    """
    try:
        with Image.open(image_path) as img:
            # 1. Apply EXIF orientation first for a correct starting point
            img = apply_exif_orientation(img)
            
            # 2. Apply any manual rotation override from the user
            if rotation_override != 0:
                img = img.rotate(rotation_override, expand=True)

            # 3. Determine target dimensions for one half of the diptych
            diptych_w, diptych_h = target_diptych_dims
            is_landscape_diptych = diptych_w > diptych_h
            
            half_w = diptych_w // 2 if is_landscape_diptych else diptych_w
            half_h = diptych_h if is_landscape_diptych else diptych_h // 2
            target_aspect = half_w / half_h
            
            # 4. Apply either 'fill' (cropping) or 'fit' (letterboxing)
            if fit_mode == 'fill':
                img_aspect = img.width / img.height
                if img_aspect > target_aspect: # Image is wider than target
                    new_width = int(target_aspect * img.height)
                    offset = (img.width - new_width) // 2
                    img = img.crop((offset, 0, img.width - offset, img.height))
                else: # Image is taller than target
                    new_height = int(img.width / target_aspect)
                    offset = (img.height - new_height) // 2
                    img = img.crop((0, offset, img.width, img.height - offset))
            else:  # 'fit' mode
                img.thumbnail((half_w, half_h), Image.Resampling.LANCZOS)
                background = Image.new('RGB', (half_w, half_h), 'white')
                paste_x = (half_w - img.width) // 2
                paste_y = (half_h - img.height) // 2
                background.paste(img, (paste_x, paste_y))
                img = background

            # 5. Resize to final dimensions to ensure consistency
            return img.resize((half_w, half_h), Image.Resampling.LANCZOS)

    except Exception as e:
        print(f"Error processing {image_path}: {e}")
        return None

def create_diptych(image_data1, image_data2, output_path, final_dims, gap_px, fit_mode):
    """Creates a single diptych image from two image data objects."""
    final_width, final_height = final_dims
    is_landscape_diptych = final_width > final_height

    img1 = process_source_image(image_data1['path'], final_dims, image_data1['rotation'], fit_mode)
    img2 = process_source_image(image_data2['path'], final_dims, image_data2['rotation'], fit_mode)

    if not img1 or not img2: 
        print(f"Skipping diptych due to image processing error: {output_path}")
        return

    # Create a canvas that includes the gap
    if is_landscape_diptych:
        canvas = Image.new('RGB', (final_width + gap_px, final_height), 'white')
        canvas.paste(img1, (0, 0))
        canvas.paste(img2, (img1.width + gap_px, 0))
    else: # Portrait Diptych
        canvas = Image.new('RGB', (final_width, final_height + gap_px), 'white')
        canvas.paste(img1, (0, 0))
        canvas.paste(img2, (0, img1.height + gap_px))
    
    # Save the final image with high quality and correct DPI
    canvas.save(output_path, 'jpeg', quality=95, dpi=(300, 300))
    print(f"Successfully created diptych: {os.path.basename(output_path)}")