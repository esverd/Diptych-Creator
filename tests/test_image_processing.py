import os
import sys
from PIL import Image


# Ensure project root on path
PROJECT_ROOT = os.path.dirname(os.path.dirname(__file__))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from diptych_creator import process_source_image, create_diptych


def test_process_source_image_crop_focus(tmp_path):
    path = tmp_path / "wide.jpg"
    base = Image.new('RGB', (200, 50), (255, 0, 0))
    base.paste(Image.new('RGB', (100, 50), (0, 255, 0)), (100, 0))
    base.save(path)

    left = process_source_image(str(path), (100, 50), fit_mode='fill', crop_focus=(0, 0.5))
    right = process_source_image(str(path), (100, 50), fit_mode='fill', crop_focus=(1, 0.5))

    assert left.size == (50, 50)
    assert right.size == (50, 50)
    r, g, b = left.getpixel((25, 25))
    assert r > 240 and g < 20 and b < 20
    r, g, b = right.getpixel((25, 25))
    assert g > 240 and r < 20 and b < 20


def test_create_diptych_combines_images(tmp_path):
    left = tmp_path / "left.jpg"
    right = tmp_path / "right.jpg"
    Image.new('RGB', (10, 10), (255, 0, 0)).save(left)
    Image.new('RGB', (10, 10), (0, 255, 0)).save(right)
    output = tmp_path / "out.jpg"

    create_diptych({'path': str(left)}, {'path': str(right)}, str(output), (20, 10), 0, 'fill', 72)

    with Image.open(output) as result:
        assert result.size == (20, 10)
        r, g, b = result.getpixel((5, 5))
        assert r > 240 and g < 20 and b < 20
        r, g, b = result.getpixel((15, 5))
        assert g > 240 and r < 20 and b < 20

