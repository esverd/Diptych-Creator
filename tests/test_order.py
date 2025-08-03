import os
import time
from PIL import Image
from app import app, UPLOAD_DIR, progress_data, progress_lock


def create_image(name, color):
    path = os.path.join(UPLOAD_DIR, name)
    Image.new('RGB', (10, 10), color).save(path)
    return name


def wait_generation(client):
    for _ in range(100):
        resp = client.get('/get_generation_progress')
        data = resp.get_json()
        if data['processed'] >= data['total']:
            break
        time.sleep(0.05)
    return data


def test_generate_diptychs_order(tmp_path):
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    create_image('a.jpg', 'red')
    create_image('b.jpg', 'green')
    create_image('c.jpg', 'blue')
    create_image('d.jpg', 'yellow')
    with progress_lock:
        progress_data.clear()
    with app.test_client() as client:
        payload = {
            'pairs': [
                {'pair': [{'path': 'a.jpg'}, {'path': 'b.jpg'}],
                 'config': {'width': 1, 'height': 1, 'dpi': 10}},
                {'pair': [{'path': 'c.jpg'}, {'path': 'd.jpg'}],
                 'config': {'width': 1, 'height': 1, 'dpi': 10}},
            ],
            'order': [1, 0],
            'zip': False
        }
        resp = client.post('/generate_diptychs', json=payload)
        assert resp.status_code == 200
        progress = wait_generation(client)
        assert progress['processed'] == progress['total'] == 2
        first = progress['final_paths'][0]
        img = Image.open(first)
        # First pixel should come from c.jpg (blue)
        color = img.getpixel((0, 0))
        assert color[2] > 200 and color[0] < 50 and color[1] < 50
        from app import diptych_order, diptych_order_lock
        with diptych_order_lock:
            assert diptych_order == [1, 0]
