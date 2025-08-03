# diptych_creator.py

"""
This module contains the core logic for processing and combining images into
diptychs. It provides helpers to calculate output dimensions based on the
requested print size and DPI, applies EXIF orientation correction, crops or
fits images into their half of the diptych, and stitches the images onto a
final canvas. The functions are deliberately stateless so they can be reused
for both WYSIWYG previews and final generation.
"""

from PIL import Image, ExifTags
import os

# Attempt to find the EXIF orientation tag. Some images store orientation
# information which needs to be applied so the images appear upright.
try:
    ORIENTATION_TAG = next(k for k, v in ExifTags.TAGS.items() if v == 'Orientation')
except (AttributeError, StopIteration):
    ORIENTATION_TAG = None

def calculate_pixel_dimensions(width_in, height_in, dpi):
    """Convert physical inches and DPI into pixel dimensions."""
    return (int(width_in * dpi), int(height_in * dpi))

def calculate_diptych_dimensions(config, dpi):
    """
    Return the final canvas dimensions in pixels, processing dimensions for each
    image, and the border and gap sizes in pixels based on a configuration.
    The orientation flag flips width/height for portrait layouts.
    """
    width = float(config.get('width', 10))
    height = float(config.get('height', 8))
    orientation = config.get('orientation')
    if orientation == 'portrait':
        width, height = height, width
    final_dims = calculate_pixel_dimensions(width, height, dpi)
    outer_border_px = int(config.get('outer_border', 0))
    gap_px = int(config.get('gap', 0))
    inner_w = final_dims[0] - 2 * outer_border_px
    inner_h = final_dims[1] - 2 * outer_border_px
    if orientation == 'portrait':
        processing_dims = (inner_w, inner_h - gap_px)
    else:
        processing_dims = (inner_w - gap_px, inner_h)
    return final_dims, processing_dims, outer_border_px, gap_px

def apply_exif_orientation(img):
    """
    Rotate and/or mirror an image according to its EXIF orientation, if present.

    The EXIF orientation tag (typically 1–8) indicates how the camera sensor
    was oriented when the photo was taken. Many editing tools rely on this
    value to display the image upright.  If left unhandled, images can
    appear rotated or mirrored.  This function supports all defined EXIF
    orientation values:

    1 - Horizontal (normal)
    2 - Mirror horizontal
    3 - Rotate 180
    4 - Mirror vertical
    5 - Mirror horizontal and rotate 90 CCW
    6 - Rotate 270 CW (90 CCW)
    7 - Mirror horizontal and rotate 90 CW
    8 - Rotate 90 CW

    If the orientation tag is missing or an unexpected value is encountered,
    the image is returned unchanged.
    """
    if not ORIENTATION_TAG or not hasattr(img, "_getexif"):
        return img
    try:
        exif = img._getexif()
        if exif and ORIENTATION_TAG in exif:
            orientation = exif[ORIENTATION_TAG]
            operations = {
                2: [Image.Transpose.FLIP_LEFT_RIGHT],
                3: [Image.Transpose.ROTATE_180],
                4: [Image.Transpose.FLIP_TOP_BOTTOM],
                5: [Image.Transpose.FLIP_LEFT_RIGHT, Image.Transpose.ROTATE_90],
                6: [Image.Transpose.ROTATE_270],
                7: [Image.Transpose.FLIP_LEFT_RIGHT, Image.Transpose.ROTATE_270],
                8: [Image.Transpose.ROTATE_90],
            }
            if orientation in operations:
                for op in operations[orientation]:
                    img = img.transpose(op)
    except Exception:
        # If anything goes wrong while reading EXIF, return original
        return img
    return img

def process_source_image(
    image_path: str,
    target_diptych_dims: tuple[int, int],
    rotation_override: int = 0,
    fit_mode: str = 'fill',
    auto_rotate: bool = True,
    background_color: str = 'white',
    crop_focus: tuple | None = None,
) -> Image.Image | None:
    """
    Load an image from disk, apply EXIF orientation and manual rotation, then
    crop or fit it to the target dimensions.

    Parameters
    ----------
    image_path : str
        Path to the source image on disk.
    target_diptych_dims : tuple of ints
        Pixel width and height of the diptych area (both halves combined).
    rotation_override : int, optional
        Degrees to rotate the image before any auto rotation or cropping.
    fit_mode : {'fill', 'fit'}, optional
        Determines whether the image should be cropped to completely fill
        the half cell ('fill') or scaled down and padded to preserve its
        aspect ratio ('fit').
    auto_rotate : bool, optional
        When True and fit_mode='fill', the image is rotated to match the
        orientation of the target cell if their orientations differ.
    background_color : str, optional
        Used when fit_mode='fit' to pad the image.
    crop_focus : tuple(float, float) or None, optional
        When fit_mode='fill', specifies the relative focal point within the
        image to keep during cropping.  The tuple values represent the
        horizontal and vertical position as fractions between 0.0 and 1.0
        (0.5, 0.5 corresponds to the center).  If None, the center is used.

    Returns
    -------
    PIL.Image or None
        The processed image, or None if an error occurred.
    """
    try:
        with Image.open(image_path) as img:
            img = apply_exif_orientation(img)
            if rotation_override:
                img = img.rotate(rotation_override, expand=True)
            diptych_w, diptych_h = target_diptych_dims
            # Determine the size of one half of the diptych
            is_landscape_diptych = diptych_w > diptych_h
            half_w = diptych_w // 2 if is_landscape_diptych else diptych_w
            half_h = diptych_h if is_landscape_diptych else diptych_h // 2
            # Auto rotate to match cell orientation
            if auto_rotate and half_w != half_h:
                cell_landscape = half_w > half_h
                img_landscape = img.width > img.height
                if cell_landscape != img_landscape:
                    img = img.rotate(90, expand=True)
            target_aspect = half_w / half_h
            if fit_mode == 'fill':
                img_aspect = img.width / img.height
                # Choose crop focus; default center
                focus_x, focus_y = 0.5, 0.5
                if crop_focus:
                    fx, fy = crop_focus
                    focus_x = min(max(float(fx), 0.0), 1.0)
                    focus_y = min(max(float(fy), 0.0), 1.0)
                if img_aspect > target_aspect:
                    # Image is wider than target; crop horizontally
                    new_width = int(target_aspect * img.height)
                    max_offset = img.width - new_width
                    offset = int(max_offset * focus_x)
                    img = img.crop((offset, 0, offset + new_width, img.height))
                else:
                    # Image is taller than target; crop vertically
                    new_height = int(img.width / target_aspect)
                    max_offset = img.height - new_height
                    offset = int(max_offset * focus_y)
                    img = img.crop((0, offset, img.width, offset + new_height))
                return img.resize((half_w, half_h), Image.Resampling.LANCZOS)
            else:
                # Fit mode: scale to fit within the cell and pad with background color
                img.thumbnail((half_w, half_h), Image.Resampling.LANCZOS)
                background = Image.new('RGB', (half_w, half_h), background_color)
                paste_x = (half_w - img.width) // 2
                paste_y = (half_h - img.height) // 2
                background.paste(img, (paste_x, paste_y))
                return background
    except Exception as e:
        print(f"Error processing {image_path}: {e}")
        return None

def create_diptych_canvas(img1, img2, final_dims, gap_px, outer_border_px=0, border_color='white'):
    """
    Create the diptych canvas using the processed images. The gap is only
    applied when both images are present. The images are centered within
    their respective halves, respecting orientation and outer borders.
    """
    final_width, final_height = final_dims
    is_landscape_diptych = final_width > final_height
    # Use gap only when both images are present
    effective_gap = gap_px if img1 and img2 else 0
    # Compute the size of each cell inside the fixed final dimensions
    inner_w = final_width - 2 * outer_border_px
    inner_h = final_height - 2 * outer_border_px
    if is_landscape_diptych:
        cell_w = (inner_w - effective_gap) // 2
        cell_h = inner_h
    else:
        cell_w = inner_w
        cell_h = (inner_h - effective_gap) // 2
    canvas = Image.new('RGB', (final_width, final_height), border_color)
    # Center images in their cells
    if is_landscape_diptych:
        if img1:
            x1 = outer_border_px + (cell_w - img1.width) // 2
            y1 = outer_border_px + (cell_h - img1.height) // 2
            canvas.paste(img1, (x1, y1))
        if img2:
            x2 = outer_border_px + cell_w + effective_gap + (cell_w - img2.width) // 2
            y2 = outer_border_px + (cell_h - img2.height) // 2
            canvas.paste(img2, (x2, y2))
    else:
        if img1:
            x1 = outer_border_px + (cell_w - img1.width) // 2
            y1 = outer_border_px + (cell_h - img1.height) // 2
            canvas.paste(img1, (x1, y1))
        if img2:
            x2 = outer_border_px + (cell_w - img2.width) // 2
            y2 = outer_border_px + cell_h + effective_gap + (cell_h - img2.height) // 2
            canvas.paste(img2, (x2, y2))
    return canvas

def create_diptych(
    image_data1: dict,
    image_data2: dict,
    output_path: str,
    final_dims: tuple[int, int],
    gap_px: int,
    fit_mode: str,
    dpi: int,
    outer_border_px: int = 0,
    border_color: str = 'white',
    crop_focus1: tuple | None = None,
    crop_focus2: tuple | None = None,
) -> None:
    """
    Process two source images and save the resulting diptych with the correct
    DPI and optional outer border.

    Parameters
    ----------
    image_data1, image_data2 : dict
        Each dictionary should contain at least a 'path' key and may contain
        'rotation' indicating clockwise rotation in degrees.
    output_path : str
        Where to write the final JPEG.
    final_dims : tuple(int, int)
        Pixel dimensions of the final diptych canvas.
    gap_px : int
        Gap between the two halves.
    fit_mode : {'fill', 'fit'}
        Strategy for scaling/cropping the images.
    dpi : int
        Output DPI for the saved JPEG.
    outer_border_px : int, optional
        Thickness of the outer border.
    border_color : str, optional
        Colour of the outer border and background for fit mode.
    crop_focus1, crop_focus2 : tuple(float, float) or None, optional
        Relative focal points for cropping the first and second images.
    """
    # Determine processing dimensions for each half based on final canvas size
    _, processing_dims, _, _ = calculate_diptych_dimensions(
        {
            'width': final_dims[0] / dpi,
            'height': final_dims[1] / dpi,
            'gap': gap_px,
            'outer_border': outer_border_px,
            'orientation': 'landscape' if final_dims[0] > final_dims[1] else 'portrait',
        },
        dpi,
    )
    img1 = process_source_image(
        image_data1['path'],
        processing_dims,
        image_data1.get('rotation', 0),
        fit_mode,
        True,
        border_color,
        crop_focus1,
    )
    img2 = process_source_image(
        image_data2['path'],
        processing_dims,
        image_data2.get('rotation', 0),
        fit_mode,
        True,
        border_color,
        crop_focus2,
    )
    if not img1 or not img2:
        print("Skipping diptych due to image processing error.")
        return
    canvas = create_diptych_canvas(img1, img2, final_dims, gap_px, outer_border_px, border_color)
    # Save with the specified DPI
    canvas.save(output_path, 'jpeg', quality=95, dpi=(dpi, dpi))
    print(f"Successfully created diptych: {os.path.basename(output_path)}")