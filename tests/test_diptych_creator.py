import pytest
from PIL import Image
from diptych_creator import create_diptych_canvas

def make_img(w=50, h=50, color='white'):
    return Image.new('RGB', (w, h), color)

def test_landscape_gap_used_when_both_images():
    img1 = make_img()
    img2 = make_img()
    canvas = create_diptych_canvas(img1, img2, (100, 50), gap_px=10)
    assert canvas.size == (110, 50)

def test_landscape_no_gap_when_missing_image():
    img1 = make_img()
    canvas = create_diptych_canvas(img1, None, (100, 50), gap_px=10)
    assert canvas.size == (100, 50)

def test_portrait_gap_used_when_both_images():
    img1 = make_img()
    img2 = make_img()
    canvas = create_diptych_canvas(img1, img2, (50, 100), gap_px=10)
    assert canvas.size == (50, 110)

def test_portrait_no_gap_when_missing_image():
    img = make_img()
    canvas = create_diptych_canvas(None, img, (50, 100), gap_px=10)
    assert canvas.size == (50, 100)
