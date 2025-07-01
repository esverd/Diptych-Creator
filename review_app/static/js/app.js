document.addEventListener('DOMContentLoaded', () => {
    // --- Element Selectors ---
    const appContainer = document.getElementById('app-container');
    const welcomeScreen = document.getElementById('welcome-screen');
    const imagePool = document.getElementById('image-pool');
    const diptychPairsContainer = document.getElementById('diptych-pairs-container');
    const loadingOverlay = document.getElementById('loading-overlay');
    const unpairedCount = document.getElementById('unpaired-count');

    // Button Selectors
    const selectFolderBtn = document.getElementById('select-folder-btn');
    const selectFilesBtn = document.getElementById('select-files-btn');
    const loadSessionBtn = document.getElementById('load-session-btn');
    const saveSessionBtn = document.getElementById('save-session-btn');
    const generateBtn = document.getElementById('generate-btn');

    // --- Event Listeners ---
    selectFolderBtn.addEventListener('click', () => triggerPathSelection(true));
    selectFilesBtn.addEventListener('click', () => triggerPathSelection(false));
    // NOTE: Add event listeners for Save/Load later
    generateBtn.addEventListener('click', generateDiptychs);
    
    // --- Core Functions ---
    async function triggerPathSelection(isFolder) {
        await fetch('/select_paths', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_folder: isFolder })
        });

        const response = await fetch('/get_images');
        const imagePaths = await response.json();
        
        if (imagePaths.length > 0) {
            setupWorkbench(imagePaths);
        } else {
            alert("No images were selected or found.");
        }
    }

    function setupWorkbench(imagePaths, pairings = []) {
        welcomeScreen.classList.add('hidden');
        appContainer.classList.remove('hidden');

        imagePool.innerHTML = '';
        diptychPairsContainer.innerHTML = '';

        const pairedPaths = new Set(pairings.flat());
        const unpaired = imagePaths.filter(p => !pairedPaths.has(p));

        // Create slots for existing pairs
        pairings.forEach(pair => {
            const slot = createDiptychSlot();
            if (pair[0]) slot.querySelector('[data-position="left"]').appendChild(createImageElement(pair[0]));
            if (pair[1]) slot.querySelector('[data-position="right"]').appendChild(createImageElement(pair[1]));
            diptychPairsContainer.appendChild(slot);
        });

        // Add remaining unpaired images to the pool
        unpaired.forEach(path => {
            imagePool.appendChild(createImageElement(path));
        });

        // Add a few empty slots for flexibility
        for (let i = 0; i < 5; i++) {
             diptychPairsContainer.appendChild(createDiptychSlot());
        }
        
        updateUnpairedCount();
        initializeDragAndDrop();
    }
    
    function createImageElement(path) {
        const container = document.createElement('div');
        container.className = 'img-container';
        container.dataset.path = path;
        
        const img = document.createElement('img');
        img.src = `/image_preview?path=${encodeURIComponent(path)}`;
        img.title = path.split(/[\\/]/).pop(); // Show only filename on hover
        container.appendChild(img);
        return container;
    }

    function createDiptychSlot() {
        const slot = document.createElement('div');
        slot.className = 'diptych-slot';
        slot.innerHTML = `
            <div class="diptych-half" data-position="left"></div>
            <div class="diptych-half" data-position="right"></div>
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
            onEnd: updateUnpairedCount,
        });

        document.querySelectorAll('.diptych-half').forEach(half => {
            new Sortable(half, {
                group: 'shared',
                animation: 150,
                onAdd: function (evt) {
                    if (this.el.children.length > 1) {
                        const oldItem = this.el.children[0] === evt.item ? this.el.children[1] : this.el.children[0];
                        imagePool.appendChild(oldItem);
                    }
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
            alert("Please create at least one complete diptych pair.");
            loadingOverlay.classList.add('hidden');
            return;
        }

        const sizeInput = document.getElementById('output-size').value.split('x');
        const config = {
            width: sizeInput[0].trim(),
            height: sizeInput[1].trim(),
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
            const a = document.createElement('a');
            a.href = `/download_zip?path=${encodeURIComponent(result.zip_path)}&name=${encodeURIComponent(result.download_name)}`;
            a.download = result.download_name;
            document.body.appendChild(a);
a.click();
            document.body.removeChild(a);
        } else {
            alert("An error occurred during diptych generation.");
        }
    }
});