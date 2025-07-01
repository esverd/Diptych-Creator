document.addEventListener('DOMContentLoaded', () => {
    // --- State Management ---
    const appState = {
        imageRotations: {}, // Stores rotation overrides: { 'path/to/img.jpg': 90 }
        pregenDebounceTimers: {}, // Stores timers for debouncing pre-generation
    };
    const PREGEN_DELAY = 1500; // 1.5 second delay after a change before pre-generating

    // --- Element Selectors ---
    const welcomeScreen = document.getElementById('welcome-screen');
    const appContainer = document.getElementById('app-container');
    const mainContent = document.getElementById('main-content');
    const canvasPanel = document.getElementById('canvas-panel');
    const rightPanel = document.getElementById('right-panel');
    const imagePool = document.getElementById('image-pool');
    const diptychPairsContainer = document.getElementById('diptych-pairs-container');
    const loadingOverlay = document.getElementById('loading-overlay');
    const progressText = document.getElementById('progress-text');
    const progressBar = document.getElementById('progress-bar');
    const unpairedCount = document.getElementById('unpaired-count');
    const selectFolderBtn = document.getElementById('select-folder-btn');
    const selectFilesBtn = document.getElementById('select-files-btn');
    const generateBtn = document.getElementById('generate-btn');
    const outputSizeSelect = document.getElementById('output-size');
    const gapSlider = document.getElementById('output-gap');
    const fitModeToggle = document.getElementById('fit-mode-toggle');
    const zipToggle = document.getElementById('zip-toggle');

    // --- Event Listeners ---
    selectFolderBtn.addEventListener('click', () => selectImagesAndSetup(true));
    selectFilesBtn.addEventListener('click', () => selectImagesAndSetup(false));
    generateBtn.addEventListener('click', generateDiptychs);
    
    [outputSizeSelect, gapSlider, fitModeToggle].forEach(el => {
        el.addEventListener('change', refreshAllPreviews);
    });

    diptychPairsContainer.addEventListener('click', (e) => {
        const imgContainer = e.target.closest('.img-container');
        if (!imgContainer) return;
        
        const path = imgContainer.dataset.path;
        
        if (e.target.closest('.rotate-btn')) {
            appState.imageRotations[path] = (appState.imageRotations[path] + 90) % 360;
            imgContainer.querySelector('img').style.transform = `rotate(${appState.imageRotations[path]}deg)`;
            handleSlotChange(e.target.closest('.diptych-slot'));
        }
        if (e.target.closest('.clear-btn')) {
            const slot = e.target.closest('.diptych-half');
            imgContainer.querySelector('img').style.transform = 'rotate(0deg)';
            appState.imageRotations[path] = 0;
            imagePool.appendChild(imgContainer);
            handleSlotChange(slot.parentElement);
        }
    });

    // --- Core Application Flow ---
    async function selectImagesAndSetup(isFolder) {
        progressText.textContent = 'Waiting for you to select files...';
        loadingOverlay.classList.remove('hidden');
        
        try {
            const response = await fetch('/select_images', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ is_folder: isFolder })
            });
            if (!response.ok) throw new Error(`Server error: ${response.statusText}`);
            const imagePaths = await response.json();
            
            if (imagePaths && imagePaths.length > 0) {
                progressText.textContent = 'Loading thumbnails...';
                setTimeout(() => { // Allows UI to update before blocking
                    setupWorkbench(imagePaths);
                    loadingOverlay.classList.add('hidden');
                }, 100);
            } else {
                loadingOverlay.classList.add('hidden');
                alert("No images were selected or found in the chosen directory.");
            }
        } catch (error) {
            console.error("Error during file selection:", error);
            loadingOverlay.classList.add('hidden');
        }
    }

    function setupWorkbench(imagePaths) {
        welcomeScreen.classList.add('hidden');
        appContainer.classList.remove('hidden');
        imagePool.innerHTML = '';
        diptychPairsContainer.innerHTML = '';

        imagePaths.forEach(path => {
            appState.imageRotations[path] = 0;
            imagePool.appendChild(createImageThumbnail(path));
        });

        const initialSlots = Math.max(12, Math.ceil(imagePaths.length / 2));
        for (let i = 0; i < initialSlots; i++) {
            diptychPairsContainer.appendChild(createDiptychSlot(i));
        }
        
        updateUnpairedCount();
        initializeDragAndDrop();
    }

    // --- UI & Element Creation ---
    function createImageThumbnail(path) {
        const container = document.createElement('div');
        container.className = 'img-container';
        container.dataset.path = path;
        const filename = path.split(/[\\/]/).pop();
        container.innerHTML = `
            <img src="/thumbnail/${encodeURIComponent(filename)}" title="${filename}">
            <div class="img-controls">
                <button class="control-btn rotate-btn" title="Rotate 90°">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 15l6-6m0 0l-6-6m6 6H9a6 6 0 000 12h3"/></svg>
                </button>
            </div>
        `;
        return container;
    }

    function createDiptychSlot(index) {
        const slot = document.createElement('div');
        slot.className = 'diptych-slot';
        slot.id = `slot-${index}`; // Unique ID for each slot
        slot.innerHTML = `<div class="diptych-half" data-position="left"></div><div class="diptych-half" data-position="right"></div>`;
        return slot;
    }
    
    function updateUnpairedCount() {
        const count = imagePool.children.length;
        unpairedCount.textContent = count;
        // Dynamically hide/show the right panel
        if (count === 0 && diptychPairsContainer.querySelector('.img-container') !== null) {
            rightPanel.classList.add('hidden');
            canvasPanel.classList.remove('max-w-[920px]');
        } else {
            rightPanel.classList.remove('hidden');
            canvasPanel.classList.add('max-w-[920px]');
        }
    }

    // --- Preview and Pre-generation ---
    function handleSlotChange(slot) {
        if (!slot) return;
        // Debounce to prevent spamming the server while dragging
        clearTimeout(appState.pregenDebounceTimers[slot.id]);
        appState.pregenDebounceTimers[slot.id] = setTimeout(() => {
            updateDiptychPreview(slot);
        }, PREGEN_DELAY);
    }

    function refreshAllPreviews() {
        document.querySelectorAll('.diptych-slot').forEach(handleSlotChange);
    }

    async function updateDiptychPreview(slot) {
        const leftHalf = slot.querySelector('[data-position="left"]');
        const rightHalf = slot.querySelector('[data-position="right"]');
        const leftImg = leftHalf.querySelector('.img-container');
        const rightImg = rightHalf.querySelector('.img-container');

        // Reset visibility and background
        slot.style.backgroundImage = 'none';
        if (leftImg) leftImg.style.visibility = 'visible';
        if (rightImg) rightImg.style.visibility = 'visible';
        
        if (leftImg && rightImg) {
            const pair = [
                { path: leftImg.dataset.path, rotation: appState.imageRotations[leftImg.dataset.path] },
                { path: rightImg.dataset.path, rotation: appState.imageRotations[rightImg.dataset.path] }
            ];
            const size = outputSizeSelect.value.split('x');
            const config = {
                width: parseFloat(size[0].trim()), height: parseFloat(size[1].trim()),
                gap: parseInt(gapSlider.value, 10),
                fit_mode: fitModeToggle.checked ? 'fit' : 'fill'
            };

            // Fetch low-res preview
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
                leftImg.style.visibility = 'hidden';
                rightImg.style.visibility = 'hidden';
                
                // Fire-and-forget the high-res pre-generation request
                fetch('/pregenerate_diptych', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ pair, config: { ...config, dpi: 300 } })
                });
            }
        }
    }

    // --- Drag & Drop Initialization ---
    function initializeDragAndDrop() {
        new Sortable(imagePool, { group: 'shared', animation: 150, onEnd: updateUnpairedCount });

        document.querySelectorAll('.diptych-half').forEach(half => {
            new Sortable(half, {
                group: 'shared', animation: 150,
                onAdd: function (evt) {
                    while (this.el.children.length > 1) {
                        const oldItem = Array.from(this.el.children).find(child => child !== evt.item);
                        imagePool.appendChild(oldItem);
                    }
                    handleSlotChange(this.el.parentElement);
                    updateUnpairedCount();
                },
                onRemove: function(evt) {
                    evt.item.style.transform = 'rotate(0deg)';
                    appState.imageRotations[evt.item.dataset.path] = 0;
                    handleSlotChange(this.el.parentElement);
                }
            });
        });
    }

    // --- Final Generation ---
    async function generateDiptychs() {
        loadingOverlay.classList.remove('hidden');
        progressText.textContent = 'Preparing generation...';
        progressBar.style.width = '0%';

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
        
        const size = outputSizeSelect.value.split('x');
        const config = {
            width: parseFloat(size[0].trim()), height: parseFloat(size[1].trim()),
            dpi: parseInt(document.getElementById('output-dpi').value),
            gap: parseInt(gapSlider.value),
            fit_mode: fitModeToggle.checked ? 'fit' : 'fill'
        };

        const startResponse = await fetch('/generate_diptychs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pairs, config, zip: zipToggle.checked })
        });
        const startResult = await startResponse.json();

        if (startResult.status === 'started') {
            const progressInterval = setInterval(async () => {
                const progressResponse = await fetch('/get_generation_progress');
                const progress = await progressResponse.json();
                
                const percent = (progress.processed / progress.total) * 100;
                progressBar.style.width = `${percent}%`;
                progressText.textContent = `Generating... (${progress.processed} of ${progress.total} complete)`;
                
                if (progress.processed >= progress.total) {
                    clearInterval(progressInterval);
                    progressText.textContent = 'Finalizing download...';

                    const finalResponse = await fetch('/finalize_download');
                    const finalResult = await finalResponse.json();
                    loadingOverlay.classList.add('hidden');
                    
                    if (finalResult.is_zip) {
                        window.location.href = `/download_file?path=${encodeURIComponent(finalResult.download_path)}`;
                    } else if (finalResult.download_paths) {
                        finalResult.download_paths.forEach((path, index) => {
                            setTimeout(() => {
                                const a = document.createElement('a');
                                a.href = `/download_file?path=${encodeURIComponent(path)}`;
                                a.download = path.split(/[\\/]/).pop();
                                document.body.appendChild(a);
                                a.click();
                                document.body.removeChild(a);
                            }, 300 * index);
                        });
                    }
                }
            }, 1000);
        }
    }
});