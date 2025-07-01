// This is the complete and final version of app.js.
document.addEventListener('DOMContentLoaded', () => {
    // --- State Management ---
    const appState = {
        imageRotations: {}, 
    };

    // --- Element Selectors ---
    const welcomeScreen = document.getElementById('welcome-screen');
    const appContainer = document.getElementById('app-container');
    const imagePool = document.getElementById('image-pool');
    const diptychPairsContainer = document.getElementById('diptych-pairs-container');
    const loadingOverlay = document.getElementById('loading-overlay');
    const unpairedCount = document.getElementById('unpaired-count');
    const zipToggle = document.getElementById('zip-toggle');
    const selectFolderBtn = document.getElementById('select-folder-btn');
    const selectFilesBtn = document.getElementById('select-files-btn');
    const generateBtn = document.getElementById('generate-btn');
    const outputSizeSelect = document.getElementById('output-size');
    const gapSlider = document.getElementById('output-gap');

    // --- Event Listeners ---
    selectFolderBtn.addEventListener('click', () => selectImagesAndSetup(true));
    selectFilesBtn.addEventListener('click', () => selectImagesAndSetup(false));
    generateBtn.addEventListener('click', generateDiptychs);
    
    // FIX: Add listeners to update previews when config changes
    outputSizeSelect.addEventListener('change', refreshAllPreviews);
    gapSlider.addEventListener('input', refreshAllPreviews);

    diptychPairsContainer.addEventListener('click', (e) => {
        const imgContainer = e.target.closest('.img-container');
        if (!imgContainer) return;
        const path = imgContainer.dataset.path;
        
        if (e.target.closest('.rotate-btn')) {
            appState.imageRotations[path] = (appState.imageRotations[path] + 90) % 360;
            imgContainer.querySelector('img').style.transform = `rotate(${appState.imageRotations[path]}deg)`;
            updateDiptychPreview(e.target.closest('.diptych-slot'));
        }
        if (e.target.closest('.clear-btn')) {
            const slot = e.target.closest('.diptych-half');
            imgContainer.querySelector('img').style.transform = 'rotate(0deg)'; 
            imagePool.appendChild(imgContainer);
            updateDiptychPreview(slot.parentElement);
            updateUnpairedCount();
        }
    });

    // --- Core Functions ---
    async function selectImagesAndSetup(isFolder) {
        // ... (This function is unchanged from the previous response)
        loadingOverlay.classList.remove('hidden');
        loadingOverlay.querySelector('p').textContent = 'Waiting for you to select files...';
        try {
            const response = await fetch('/select_images', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ is_folder: isFolder })
            });
            if (!response.ok) throw new Error(`Server responded with status: ${response.status}`);
            const imagePaths = await response.json();
            if (imagePaths && imagePaths.length > 0) {
                loadingOverlay.querySelector('p').textContent = 'Loading thumbnails...';
                setTimeout(() => {
                    setupWorkbench(imagePaths);
                    loadingOverlay.classList.add('hidden');
                }, 100);
            } else {
                 loadingOverlay.classList.add('hidden');
                 if (document.body.contains(welcomeScreen)) {
                    alert("No images were selected or found in the chosen directory.");
                 }
            }
        } catch (error) {
            console.error("Error selecting images:", error);
            alert("An error occurred while selecting images. Please check the console.");
            loadingOverlay.classList.add('hidden');
        }
    }

    function setupWorkbench(imagePaths) {
        // ... (This function is unchanged)
        welcomeScreen.classList.add('hidden');
        appContainer.classList.remove('hidden');
        imagePool.innerHTML = '';
        diptychPairsContainer.innerHTML = '';
        imagePaths.forEach(path => {
            appState.imageRotations[path] = 0;
            imagePool.appendChild(createImageThumbnail(path));
        });
        const initialSlots = Math.max(10, Math.ceil(imagePaths.length / 2));
        for (let i = 0; i < initialSlots; i++) {
            diptychPairsContainer.appendChild(createDiptychSlot());
        }
        updateUnpairedCount();
        initializeDragAndDrop();
    }

    function createImageThumbnail(path) {
        // ... (This function is unchanged)
        const container = document.createElement('div');
        container.className = 'img-container';
        container.dataset.path = path;
        const filename = path.split(/[\\/]/).pop();
        container.innerHTML = `
            <img src="/thumbnail/${encodeURIComponent(filename)}" title="${filename}">
            <div class="img-controls">
                <button class="control-btn rotate-btn" title="Rotate 90°"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 12c0-1.232-.046-2.453-.138-3.662a4.006 4.006 0 00-3.7-3.708c-1.21-.092-2.43-.138-3.662-.138-1.232 0-2.453.046-3.662.138a4.006 4.006 0 00-3.7 3.708c-.092 1.21-.138 2.43-.138 3.662s.046 2.453.138 3.662a4.006 4.006 0 003.7 3.708c1.21.092 2.43.138 3.662.138 1.232 0 2.453-.046 3.662-.138a4.006 4.006 0 003.7-3.708c.092-1.21.138-2.43.138-3.662zM15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" /></svg></button>
                <button class="control-btn clear-btn" title="Remove from pair"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg></button>
            </div>
        `;
        return container;
    }
    
    function createDiptychSlot() {
        const slot = document.createElement('div');
        slot.className = 'diptych-slot';
        slot.innerHTML = `<div class="diptych-half" data-position="left"></div><div class="diptych-half" data-position="right"></div>`;
        return slot;
    }
    
    function updateUnpairedCount() { unpairedCount.textContent = imagePool.children.length; }

    function refreshAllPreviews() {
        document.querySelectorAll('.diptych-slot').forEach(slot => {
            const leftImg = slot.querySelector('[data-position="left"] .img-container');
            const rightImg = slot.querySelector('[data-position="right"] .img-container');
            // Only update previews for slots that are actually filled
            if (leftImg && rightImg) {
                updateDiptychPreview(slot);
            }
        });
    }

    async function updateDiptychPreview(slot) {
        // ... (This function is unchanged)
        if (!slot) return;
        const leftHalf = slot.querySelector('[data-position="left"]');
        const rightHalf = slot.querySelector('[data-position="right"]');
        const leftImg = leftHalf.querySelector('.img-container');
        const rightImg = rightHalf.querySelector('.img-container');
        slot.style.backgroundImage = 'none';
        if (leftImg && rightImg) {
            leftHalf.style.backgroundColor = 'transparent';
            rightHalf.style.backgroundColor = 'transparent';
            const pair = [
                { path: leftImg.dataset.path, rotation: appState.imageRotations[leftImg.dataset.path] },
                { path: rightImg.dataset.path, rotation: appState.imageRotations[rightImg.dataset.path] }
            ];
            const size = document.getElementById('output-size').value.split('x');
            const config = {
                width: parseFloat(size[0].trim()), height: parseFloat(size[1].trim()),
                gap: parseInt(document.getElementById('output-gap').value, 10)
            };
            try {
                const response = await fetch('/get_preview', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ pair, config })
                });
                if (response.ok) {
                    const imageBlob = await response.blob();
                    slot.style.backgroundImage = `url(${URL.createObjectURL(imageBlob)})`;
                    slot.style.backgroundSize = 'contain';
                    slot.style.backgroundPosition = 'center';
                    slot.style.backgroundRepeat = 'no-repeat';
                } else { console.error("Preview generation failed on the server."); }
            } catch (error) { console.error("Error fetching preview:", error); }
        }
    }

    function initializeDragAndDrop() {
        new Sortable(imagePool, {
            group: 'shared', animation: 150, onEnd: updateUnpairedCount
        });

        document.querySelectorAll('.diptych-half').forEach(half => {
            new Sortable(half, {
                group: { name: 'shared', put: true, pull: true },
                animation: 150,
                onAdd: function (evt) {
                    // FIX: This logic ensures only one item per slot
                    while (this.el.children.length > 1) {
                        const oldItem = Array.from(this.el.children).find(child => child !== evt.item);
                        imagePool.appendChild(oldItem);
                    }
                    updateDiptychPreview(this.el.parentElement);
                    updateUnpairedCount();
                },
                onRemove: function(evt) {
                     updateDiptychPreview(this.el.parentElement);
                }
            });
        });
    }

    async function generateDiptychs() {
        // ... (This function is unchanged)
        loadingOverlay.classList.remove('hidden');
        loadingOverlay.querySelector('p').textContent = 'Generating... Please wait.';
        const pairs = [];
        document.querySelectorAll('.diptych-slot').forEach(slot => {
            const leftImg = slot.querySelector('[data-position="left"] .img-container');
            const rightImg = slot.querySelector('[data-position="right"] .img-container');
            if (leftImg && rightImg) {
                pairs.push([
                    { path: leftImg.dataset.path, rotation: appState.imageRotations[leftImg.dataset.path] },
                    { path: rightImg.dataset.path, rotation: appState.imageRotations[rightImg.dataset.path] }
                ]);
            }
        });
        if (pairs.length === 0) {
            alert("Please create at least one complete diptych pair.");
            loadingOverlay.classList.add('hidden');
            return;
        }
        const size = document.getElementById('output-size').value.split('x');
        const config = {
            width: parseFloat(size[0].trim()), height: parseFloat(size[1].trim()),
            dpi: parseInt(document.getElementById('output-dpi').value),
            gap: parseInt(document.getElementById('output-gap').value)
        };
        const shouldZip = zipToggle.checked;
        const response = await fetch('/generate_diptychs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pairs, config, zip: shouldZip })
        });
        const result = await response.json();
        loadingOverlay.classList.add('hidden');
        if (result.is_zip) {
            window.location.href = `/download_file?path=${encodeURIComponent(result.download_path)}`;
        } else if (result.download_paths) {
            result.download_paths.forEach((path, index) => {
                setTimeout(() => {
                    const a = document.createElement('a');
                    a.href = `/download_file?path=${encodeURIComponent(path)}`;
                    a.download = path.split(/[\\/]/).pop();
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                }, 200 * index);
            });
        }
    }
});