import os
import time
from PIL import Image

from app import app, UPLOAD_DIR


def create_image(path, color):
    Image.new('RGB', (20, 20), color).save(path)


def test_generate_respects_order(tmp_path):
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    img_paths = []
    colors = ['red', 'green', 'blue', 'yellow']
    names = ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg']
    for name, color in zip(names, colors):
        p = os.path.join(UPLOAD_DIR, name)
        create_image(p, color)
        img_paths.append(p)
    pair1 = {'pair': [{'path': img_paths[0]}, {'path': img_paths[1]}], 'config': {'width': 4, 'height': 3, 'dpi': 10}}
    pair2 = {'pair': [{'path': img_paths[2]}, {'path': img_paths[3]}], 'config': {'width': 4, 'height': 3, 'dpi': 10}}
    order = [
        {'image1': img_paths[2], 'image2': img_paths[3]},
        {'image1': img_paths[0], 'image2': img_paths[1]},
    ]
    with app.test_client() as client:
        resp = client.post('/generate_diptychs', json={'pairs': [pair1, pair2], 'order': order, 'zip': False})
        assert resp.status_code == 200
        # wait for background task to finish
        while True:
            progress = client.get('/get_generation_progress').get_json()
            if progress['processed'] >= progress['total']:
                break
            time.sleep(0.1)
        final = client.get('/finalize_download').get_json()
        assert final['is_zip'] is False
        paths_out = final['download_paths']
        assert len(paths_out) == 2
        first = Image.open(paths_out[0])
        r, g, b = first.getpixel((0, first.height // 2))
        # first image should start with blue from pair2
        assert b > r and b > g
