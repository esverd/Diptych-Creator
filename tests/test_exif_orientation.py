import pytest
from PIL import Image

from diptych_creator import apply_exif_orientation, ORIENTATION_TAG


def build_image(size, pixels):
    img = Image.new('RGB', size)
    for (x, y), color in pixels.items():
        img.putpixel((x, y), color)
    return img


def attach_orientation(img, orientation):
    def _getexif():
        return {ORIENTATION_TAG: orientation}
    img._getexif = _getexif
    return img


def test_orientation_2_horizontal_flip():
    img = build_image((2, 1), {(0, 0): (255, 0, 0), (1, 0): (0, 0, 255)})
    img = attach_orientation(img, 2)
    result = apply_exif_orientation(img)
    assert result.size == (2, 1)
    assert result.getpixel((0, 0)) == (0, 0, 255)
    assert result.getpixel((1, 0)) == (255, 0, 0)


def test_orientation_4_vertical_flip():
    img = build_image((1, 2), {(0, 0): (255, 0, 0), (0, 1): (0, 0, 255)})
    img = attach_orientation(img, 4)
    result = apply_exif_orientation(img)
    assert result.size == (1, 2)
    assert result.getpixel((0, 0)) == (0, 0, 255)
    assert result.getpixel((0, 1)) == (255, 0, 0)


def test_orientation_5_mirror_and_rotate():
    img = build_image((2, 1), {(0, 0): (255, 0, 0), (1, 0): (0, 0, 255)})
    img = attach_orientation(img, 5)
    result = apply_exif_orientation(img)
    assert result.size == (1, 2)
    assert result.getpixel((0, 0)) == (255, 0, 0)
    assert result.getpixel((0, 1)) == (0, 0, 255)


def test_orientation_7_mirror_and_rotate():
    img = build_image((2, 1), {(0, 0): (255, 0, 0), (1, 0): (0, 0, 255)})
    img = attach_orientation(img, 7)
    result = apply_exif_orientation(img)
    assert result.size == (1, 2)
    assert result.getpixel((0, 0)) == (0, 0, 255)
    assert result.getpixel((0, 1)) == (255, 0, 0)
