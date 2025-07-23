import importlib
import sys
import types


def load_module():
    if 'diptych_creator' in sys.modules:
        return sys.modules['diptych_creator']

    # Create a minimal PIL stub
    pil = types.ModuleType('PIL')

    class FakeImage:
        def __init__(self, size, color='white'):
            self.width, self.height = size
            self.size = size

        @classmethod
        def new(cls, mode, size, color='white'):
            return cls(size, color)

        def paste(self, img, box):
            pass

    pil.Image = types.SimpleNamespace(new=FakeImage.new, Resampling=types.SimpleNamespace(LANCZOS=1))
    pil.ExifTags = types.SimpleNamespace(TAGS={'Orientation': 274})

    sys.modules['PIL'] = pil
    sys.modules['PIL.Image'] = pil.Image
    sys.modules['PIL.ExifTags'] = pil.ExifTags

    return importlib.import_module('diptych_creator')


def test_calculate_pixel_dimensions():
    mod = load_module()
    assert mod.calculate_pixel_dimensions(8.5, 11, 300) == (2550, 3300)


def test_create_diptych_canvas_no_gap_with_missing_image():
    mod = load_module()
    img1 = mod.Image.new('RGB', (100, 100), 'white')
    canvas = mod.create_diptych_canvas(img1, None, (300, 200), 50)
    assert canvas.size == (300, 200)
