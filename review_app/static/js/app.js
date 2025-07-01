document.addEventListener('DOMContentLoaded', () => {
    // --- Element Selectors ---
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
    selectFolderBtn.addEventListener('click', () => triggerPathSelection(true));
    selectFilesBtn.addEventListener('click', () => triggerPathSelection(false));
    generateBtn.addEventListener('click', generateDiptychs);
    
    // --- Core Functions ---
    async function triggerPathSelection(isFolder) {
        // Step 1: Tell the Python backend to open a native file/folder dialog
        await fetch('/select_paths', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_folder: isFolder })
        });

        // Step 2: Now that Python has the paths, ask for them
        const response = await fetch('/get_images');
        const imagePaths = await response.json();
        
        if (imagePaths.length > 0) {
            setupWorkbench(imagePaths);
        } else {
            alert("No images were selected or found.");
        }
    }

    function setupWorkbench(imagePaths) {
        welcomeScreen.classList.add('hidden');
        appContainer.classList.remove('hidden');
        generateBtn.classList.remove('hidden');

        imagePool.innerHTML = '';
        diptychPairsContainer.innerHTML = '';

        // Auto-pair chronologically as a starting suggestion
        const unpaired = [...imagePaths];
        while (unpaired.length >= 2) {
            const pair = [unpaired.shift(), unpaired.shift()];
            const slot = createDiptychSlot();
            pair.forEach(path => {
                const imgContainer = createImageElement(path);
                const targetHalf = slot.querySelector(pair.indexOf(path) === 0 ? '[data-position="left"]' : '[data-position="right"]');
                targetHalf.innerHTML = ''; // Clear "Drop..." text
                targetHalf.appendChild(imgContainer);
            });
            diptychPairsContainer.appendChild(slot);
        }

        // Add remaining single images to the pool
        unpaired.forEach(path => {
            const imgContainer = createImageElement(path);
            imagePool.appendChild(imgContainer);
        });

        // Add one empty slot for flexibility
        diptychPairsContainer.appendChild(createDiptychSlot());
        
        updateUnpairedCount();
        initializeDragAndDrop();
    }
    
    function createImageElement(path) {
        const container = document.createElement('div');
        container.className = 'img-container';
        container.dataset.path = path;
        
        const img = document.createElement('img');
        // This route now works because app.py has the full path
        img.src = `/image_preview?path=${encodeURIComponent(path)}`;
        img.title = path; // Show full path on hover
        container.appendChild(img);
        return container;
    }

    function createDiptychSlot() {
        const slot = document.createElement('div');
        slot.className = 'diptych-slot';
        slot.innerHTML = `
            <div class="diptych-half" data-position="left"><span>Drop Left</span></div>
            <div class="diptych-half" data-position="right"><span>Drop Right</span></div>
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
                    const item = evt.item;
                    // Ensure only one image per half
                    if (this.el.children.length > 1) {
                        const oldItem = this.el.children[0] === item ? this.el.children[1] : this.el.children[0];
                        imagePool.appendChild(oldItem);
                    }
                    if (this.el.querySelector('span')) {
                        this.el.querySelector('span').style.display = 'none';
                    }
                    updateUnpairedCount();
                },
                onRemove: function(evt) {
                     if (this.el.children.length === 0) {
                        this.el.innerHTML = `<span>Drop ${this.el.dataset.position.charAt(0).toUpperCase() + this.el.dataset.position.slice(1)}</span>`;
                    }
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
            width: sizeInput[0] || 6,
            height: sizeInput[1] || 4,
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
            // Trigger download via a hidden link
            const a = document.createElement('a');
            a.href = `/download_zip?path=${encodeURIComponent(result.zip_path)}&name=${encodeURIComponent(result.download_name)}`;
            a.download = result.download_name;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        } else {
            alert("An error occurred during diptych generation. See console for details.");
        }
    }
});