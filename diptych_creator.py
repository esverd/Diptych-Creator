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
    return (int(width_in * dpi), int(height_in * dpi))

def apply_exif_orientation(img):
    """Applies EXIF orientation to an image."""
    if not ORIENTATION_TAG:
        return img
        
    try:
        exif = img._getexif()
        if exif and ORIENTATION_TAG in exif:
            orientation = exif[ORIENTATION_TAG]
            if orientation == 3: img = img.rotate(180, expand=True)
            elif orientation == 6: img = img.rotate(270, expand=True)
            elif orientation == 8: img = img.rotate(90, expand=True)
    except (AttributeError, KeyError, IndexError):
        pass # No EXIF data
    return img

def process_source_image(image_path, target_diptych_dims, rotation_override=0):
    """
    Opens, orients, and resizes a single image to fit its half of the diptych.
    Rotation override is in degrees (e.g., 90, 180, 270).
    """
    try:
        with Image.open(image_path) as img:
            # 1. Apply EXIF orientation first
            img = apply_exif_orientation(img)
            
            # 2. Apply manual rotation if specified
            if rotation_override != 0:
                img = img.rotate(rotation_override, expand=True)

            # 3. Determine target aspect ratio for a diptych half
            diptych_w, diptych_h = target_diptych_dims
            # If diptych is landscape (e.g. 6x4), each half is portrait
            is_landscape_diptych = diptych_w > diptych_h
            
            target_aspect = (diptych_w / 2) / diptych_h if is_landscape_diptych else diptych_w / (diptych_h / 2)
            
            # 4. Crop to fit the target aspect ratio
            img_aspect = img.width / img.height
            if img_aspect > target_aspect: # Image is wider than target
                new_width = int(target_aspect * img.height)
                offset = (img.width - new_width) // 2
                img = img.crop((offset, 0, img.width - offset, img.height))
            else: # Image is taller than target
                new_height = int(img.width / target_aspect)
                offset = (img.height - new_height) // 2
                img = img.crop((0, offset, img.width, img.height - offset))

            # 5. Resize to final half-diptych size
            final_half_width = int(diptych_w / 2) if is_landscape_diptych else diptych_w
            final_half_height = diptych_h if is_landscape_diptych else int(diptych_h / 2)

            return img.resize((final_half_width, final_half_height), Image.Resampling.LANCZOS)

    except Exception as e:
        print(f"Error processing {image_path}: {e}")
        return None

def create_diptych(image_data1, image_data2, output_path, final_dims, gap_px):
    """
    Creates a single diptych from two image data objects.
    image_data = {'path': '...', 'rotation': 0}
    """
    final_width, final_height = final_dims
    is_landscape_diptych = final_width > final_height

    img1 = process_source_image(image_data1['path'], final_dims, image_data1['rotation'])
    img2 = process_source_image(image_data2['path'], final_dims, image_data2['rotation'])

    if not img1 or not img2:
        return

    # Create canvas with gap
    if is_landscape_diptych:
        canvas = Image.new('RGB', (final_width + gap_px, final_height), 'white')
        canvas.paste(img1, (0, 0))
        canvas.paste(img2, (img1.width + gap_px, 0))
    else: # Portrait Diptych
        canvas = Image.new('RGB', (final_width, final_height + gap_px), 'white')
        canvas.paste(img1, (0, 0))
        canvas.paste(img2, (0, img1.height + gap_px))
    
    canvas.save(output_path, 'jpeg', quality=95, dpi=(300, 300))
    print(f"Successfully created diptych: {output_path}")