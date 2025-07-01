document.addEventListener('DOMContentLoaded', () => {
    const selectFolderBtn = document.getElementById('select-folder-btn');
    const selectFilesBtn = document.getElementById('select-files-btn');
    const appContainer = document.getElementById('app-container');
    const welcomeScreen = document.getElementById('welcome-screen');
    const imagePool = document.getElementById('image-pool');
    const diptychPairsContainer = document.getElementById('diptych-pairs-container');
    const generateBtn = document.getElementById('generate-btn');
    const loadingOverlay = document.getElementById('loading-overlay');
    const unpairedCount = document.getElementById('unpaired-count');

    // --- Event Listeners ---
    selectFolderBtn.addEventListener('click', () => handleFileSelection(true));
    selectFilesBtn.addEventListener('click', () => handleFileSelection(false));
    generateBtn.addEventListener('click', generateDiptychs);
    
    // --- Core Functions ---
    async function handleFileSelection(isFolder) {
        // This is a conceptual example. Electron or Tauri would be needed for native dialogs.
        // For a simple local web app, we'll use the standard file input.
        const input = document.createElement('input');
        input.type = 'file';
        input.webkitdirectory = isFolder;
        input.multiple = !isFolder;
        input.onchange = async (e) => {
            const files = Array.from(e.target.files);
            const paths = files.map(file => file.webkitRelativePath || file.name); // This is a limitation
            
            // In a real desktop app, we'd get full paths. Here we simulate.
            // A better approach would be a Python-triggered dialog.
            alert("This is a proof of concept. In a real application, you'd get full file paths. For now, ensure your `app.py` has access to the image directory.");

            // Let's assume for this demo that the backend can find the images.
            // We'll need to adapt the backend to know where to look.
            // For now, let's just send the file names.
            const fileNames = files.map(f => f.name);
            const response = await fetch('/get_images', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ paths: fileNames }) // Sending filenames
            });
            const imagePaths = await response.json();
            setupWorkbench(imagePaths);
        };
        input.click();
    }

    function setupWorkbench(imagePaths) {
        welcomeScreen.classList.add('hidden');
        appContainer.classList.remove('hidden');
        generateBtn.classList.remove('hidden');

        imagePool.innerHTML = '';
        diptychPairsContainer.innerHTML = '';

        imagePaths.forEach(path => {
            const imgContainer = createImageElement(path);
            imagePool.appendChild(imgContainer);
        });

        // Create initial diptych slots
        for (let i = 0; i < Math.ceil(imagePaths.length / 2); i++) {
            const slot = createDiptychSlot();
            diptychPairsContainer.appendChild(slot);
        }

        updateUnpairedCount();
        initializeDragAndDrop();
    }
    
    function createImageElement(path) {
        const container = document.createElement('div');
        container.className = 'img-container';
        container.dataset.path = path;
        
        // In a true local app, we'd load the image via a custom file protocol or blob URL
        // For this demo, let's assume images are served by Flask for preview.
        // This is a significant architectural decision. Let's adapt Flask for this.
        const img = document.createElement('img');
        img.src = `/image_preview?path=${encodeURIComponent(path)}`;
        container.appendChild(img);
        return container;
    }

    function createDiptychSlot() {
        const slot = document.createElement('div');
        slot.className = 'diptych-slot';
        slot.innerHTML = `
            <div class="diptych-half" data-position="left">Drop Left Image</div>
            <div class="diptych-half" data-position="right">Drop Right Image</div>
        `;
        return slot;
    }
    
    function updateUnpairedCount() {
        unpairedCount.textContent = imagePool.children.length;
    }

    function initializeDragAndDrop() {
        new Sortable(imagePool, {
            group: 'shared',
            animation: 150,
            onEnd: updateUnpairedCount
        });

        document.querySelectorAll('.diptych-half').forEach(half => {
            new Sortable(half, {
                group: 'shared',
                animation: 150,
                onAdd: function (evt) {
                    // Ensure only one image per half
                    if (this.el.children.length > 1) {
                        const oldItem = this.el.children[0] === evt.item ? this.el.children[1] : this.el.children[0];
                        imagePool.appendChild(oldItem);
                    }
                    this.el.style.border = '1px solid #eee';
                    this.el.innerText = '';
                    updateUnpairedCount();
                }
            });
        });
    }

    async function generateDiptychs() {
        loadingOverlay.classList.remove('hidden');

        const pairs = [];
        document.querySelectorAll('.diptych-slot').forEach(slot => {
            const leftImg = slot.querySelector('[data-position="left"] .img-container');
            const rightImg = slot.querySelector('[data-position="right"] .img-container');
            if (leftImg && rightImg) {
                pairs.push([leftImg.dataset.path, rightImg.dataset.path]);
            }
        });

        if (pairs.length === 0) {
            alert("Please create at least one complete pair.");
            loadingOverlay.classList.add('hidden');
            return;
        }

        const config = {
            width: document.getElementById('output-size').value.split('x')[0],
            height: document.getElementById('output-size').value.split('x')[1],
            dpi: document.getElementById('output-dpi').value,
            gap: document.getElementById('output-gap').value
        };

        const response = await fetch('/generate_diptychs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pairs, config })
        });
        
        const result = await response.json();
        
        loadingOverlay.classList.add('hidden');
        
        if (result.zip_path) {
            window.location.href = `/download_zip?path=${encodeURIComponent(result.zip_path)}&name=${encodeURIComponent(result.download_name)}`;
        } else {
            alert("Something went wrong during generation.");
        }
    }

    // A note on the file selection limitation:
    // A true cross-platform desktop feel requires a framework like Electron or Tauri.
    // For this pure Python + Web UI approach, we'll need to adjust app.py to serve images.
    // I will add an `/image_preview` route to app.py now.
});

// Update app.py with this route:
/*
@app.route('/image_preview')
def image_preview():
    path = request.args.get('path')
    if os.path.exists(path):
        return send_file(path)
    return "Image not found", 404
*/