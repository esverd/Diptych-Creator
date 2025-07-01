from PIL import Image, ExifTags
import os

# Helper to find the EXIF orientation tag
for orientation in ExifTags.TAGS.keys():
    if ExifTags.TAGS[orientation] == 'Orientation':
        ORIENTATION_TAG = orientation
        break

def calculate_pixel_dimensions(width_in, height_in, dpi):
    """Calculates pixel dimensions from inches and DPI."""
    return (int(width_in * dpi), int(height_in * dpi))

def ensure_correct_orientation(img):
    """Rotates an image to the correct, upright orientation based on EXIF or dimensions."""
    # 1. Check for EXIF orientation tag first
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
            return img
    except (AttributeError, KeyError, IndexError):
        # This handles cases where there's no EXIF data
        pass

    # 2. Fallback to dimension-based guess if no EXIF tag
    if img.width > img.height:
        img = img.rotate(270, expand=True)
        
    return img

def process_source_image(image_path, target_height):
    """
    Opens, orients, and resizes a single source image to fit a diptych half.
    """
    try:
        with Image.open(image_path) as img:
            img = ensure_correct_orientation(img)
            
            # Resize to fit the diptych's height
            ratio = target_height / img.height
            new_width = int(img.width * ratio)
            
            return img.resize((new_width, target_height), Image.Resampling.LANCZOS)
    except Exception as e:
        print(f"Error processing {image_path}: {e}")
        return None

def create_diptych(image_path1, image_path2, output_path, final_dims, gap_px):
    """
    Creates a single diptych image from two source image paths.
    """
    final_width, final_height = final_dims
    
    # Each image will take up half the width, minus half the gap
    target_img_width = (final_width - gap_px) // 2
    
    img1 = process_source_image(image_path1, final_height)
    img2 = process_source_image(image_path2, final_height)

    if not img1 or not img2:
        print("Could not create diptych due to image processing error.")
        return

    # Create the final canvas
    diptych = Image.new('RGB', (final_width, final_height), 'white')

    # Paste the first image on the left
    diptych.paste(img1, (0, 0))
    # Paste the second image on the right
    diptych.paste(img2, (target_img_width + gap_px, 0))

    # Save the final image
    diptych.save(output_path, 'jpeg', quality=100, dpi=(300, 300))
    print(f"Successfully created diptych: {output_path}")