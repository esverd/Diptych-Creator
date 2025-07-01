document.addEventListener('DOMContentLoaded', () => {
    // --- STATE MANAGEMENT ---
    let appState = {
        images: [], // { path: '...', filename: '...' }
        diptychs: [], // Array of diptych objects
        activeDiptychIndex: 0,
        pregenDebounceTimers: {},
        isGenerating: false,
    };
    const PREGEN_DELAY = 1000; // 1 second delay

    // --- ELEMENT SELECTORS ---
    const welcomeScreen = document.getElementById('welcome-screen');
    const appContainer = document.getElementById('app-container');
    const imagePool = document.getElementById('image-pool');
    const unpairedCount = document.getElementById('unpaired-count');
    const mainCanvas = document.getElementById('main-canvas');
    const diptychTray = document.getElementById('diptych-tray');
    
    // Buttons
    const selectFolderBtn = document.getElementById('select-folder-btn');
    const selectFilesBtn = document.getElementById('select-files-btn');
    const uploadMoreBtn = document.getElementById('upload-more-btn');
    const downloadBtn = document.getElementById('download-btn');

    // Config Controls
    const imageFittingSelect = document.getElementById('image-fitting');
    const borderSizeSlider = document.getElementById('border-size');
    const borderSizeValue = document.getElementById('border-size-value');
    const zipToggle = document.getElementById('zip-toggle');

    // Dynamic Controls
    const image1Controls = document.getElementById('image-1-controls');
    const image2Controls = document.getElementById('image-2-controls');
    
    // Loading Overlay
    const loadingOverlay = document.getElementById('loading-overlay');
    const progressText = document.getElementById('progress-text');
    const progressBar = document.getElementById('progress-bar');

    // --- INITIALIZATION ---
    function init() {
        addEventListeners();
        addNewDiptych(); // Start with one empty diptych
        initializeDragAndDrop();
    }

    // --- EVENT LISTENERS ---
    function addEventListeners() {
        selectFolderBtn.addEventListener('click', () => selectImages(true));
        selectFilesBtn.addEventListener('click', () => selectImages(false));
        uploadMoreBtn.addEventListener('click', () => selectImages(false));
        document.getElementById('upload-input-main').addEventListener('change', handleFileInput);

        downloadBtn.addEventListener('click', generateDiptychs);

        imageFittingSelect.addEventListener('change', handleConfigChange);
        borderSizeSlider.addEventListener('input', () => {
            borderSizeValue.textContent = `${borderSizeSlider.value} px`;
        });
        borderSizeSlider.addEventListener('change', handleConfigChange);
        zipToggle.addEventListener('change', handleConfigChange);

        document.querySelectorAll('.btn-rotate').forEach(btn => btn.addEventListener('click', handleRotate));
        document.querySelectorAll('.btn-remove').forEach(btn => btn.addEventListener('click', handleRemove));
        
        diptychTray.addEventListener('click', handleTrayClick);
        document.getElementById('scroll-left-btn').addEventListener('click', () => scrollTray(-150));
        document.getElementById('scroll-right-btn').addEventListener('click', () => scrollTray(150));
    }

    // --- CORE LOGIC ---
    async function selectImages(isFolder) {
        showLoading('Waiting for you to select files...');
        try {
            const response = await fetch('/select_images', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ is_folder: isFolder })
            });
            if (!response.ok) throw new Error(`Server error: ${response.statusText}`);
            const imagePaths = await response.json();

            if (imagePaths && imagePaths.length > 0) {
                showLoading('Loading thumbnails...');
                setTimeout(() => { // Allows UI to update
                    const newImages = imagePaths.map(path => ({ path, filename: path.split(/[\\/]/).pop() }));
                    appState.images = [...appState.images, ...newImages];
                    
                    if (welcomeScreen.style.display !== 'none') {
                        welcomeScreen.classList.add('hidden');
                        appContainer.classList.remove('hidden');
                    }
                    renderImagePool();
                    hideLoading();
                }, 100);
            } else {
                hideLoading();
            }
        } catch (error) {
            console.error("Error during file selection:", error);
            hideLoading();
        }
    }
    
    function handleFileInput(e) {
        // This would require a new endpoint to handle direct uploads
        // For now, it's a placeholder. The logic is tied to the Python-based dialog.
        alert("Direct file upload from browser not yet implemented. Please use the 'Select...' buttons.");
    }

    function addNewDiptych(andSwitch = true) {
        const newDiptych = {
            image1: null, // { path, rotation }
            image2: null,
            config: {
                fit_mode: 'fill',
                gap: 10,
            }
        };
        appState.diptychs.push(newDiptych);
        if (andSwitch) {
            appState.activeDiptychIndex = appState.diptychs.length - 1;
        }
        renderDiptychTray();
        if (andSwitch) {
            renderActiveDiptych();
        }
    }

    function switchActiveDiptych(index) {
        if (index >= 0 && index < appState.diptychs.length) {
            appState.activeDiptychIndex = index;
            renderDiptychTray();
            renderActiveDiptych();
        }
    }

    function handleConfigChange() {
        const activeDiptych = appState.diptychs[appState.activeDiptychIndex];
        if (!activeDiptych) return;

        activeDiptych.config.fit_mode = imageFittingSelect.value;
        activeDiptych.config.gap = parseInt(borderSizeSlider.value, 10);
        
        debouncedPreviewUpdate();
    }

    function handleRotate(e) {
        const slot = e.target.closest('button').dataset.slot;
        const activeDiptych = appState.diptychs[appState.activeDiptychIndex];
        const imageKey = `image${slot}`;
        
        if (activeDiptych && activeDiptych[imageKey]) {
            activeDiptych[imageKey].rotation = (activeDiptych[imageKey].rotation + 90) % 360;
            debouncedPreviewUpdate();
        }
    }

    function handleRemove(e) {
        const slot = e.target.closest('button').dataset.slot;
        const activeDiptych = appState.diptychs[appState.activeDiptychIndex];
        const imageKey = `image${slot}`;

        if (activeDiptych && activeDiptych[imageKey]) {
            activeDiptych[imageKey] = null;
            renderImagePool();
            renderActiveDiptych();
        }
    }
    
    function handleTrayClick(e) {
        const item = e.target.closest('.diptych-tray-item');
        if (item) {
            switchActiveDiptych(parseInt(item.dataset.index, 10));
        } else if (e.target.closest('.add-diptych-btn')) {
            addNewDiptych();
        }
    }
    
    function scrollTray(amount) {
        diptychTray.parentElement.scrollBy({ left: amount, behavior: 'smooth' });
    }

    // --- RENDERING ---
    function renderImagePool() {
        imagePool.innerHTML = '';
        const usedPaths = appState.diptychs.flatMap(d => [d.image1?.path, d.image2?.path]).filter(Boolean);
        const unpairedImages = appState.images.filter(img => !usedPaths.includes(img.path));

        unpairedCount.textContent = unpairedImages.length;

        unpairedImages.forEach(img => {
            const thumb = document.createElement('div');
            thumb.className = 'img-thumbnail';
            thumb.dataset.path = img.path;
            thumb.innerHTML = `
                <img src="/thumbnail/${encodeURIComponent(img.filename)}" alt="${img.filename}" draggable="false">
                <div class="filename">${img.filename}</div>
            `;
            imagePool.appendChild(thumb);
        });
    }

    function renderActiveDiptych() {
        const activeDiptych = appState.diptychs[appState.activeDiptychIndex];
        if (!activeDiptych) return;

        // Update config controls
        imageFittingSelect.value = activeDiptych.config.fit_mode;
        borderSizeSlider.value = activeDiptych.config.gap;
        borderSizeValue.textContent = `${activeDiptych.config.gap} px`;
        
        // Update canvas placeholders and image controls
        mainCanvas.innerHTML = ''; // Clear previous
        mainCanvas.style.backgroundImage = 'none';

        for (let i = 1; i <= 2; i++) {
            const imageKey = `image${i}`;
            const controls = document.getElementById(`image-${i}-controls`);
            const dropZone = createDropZone(i);

            if (activeDiptych[imageKey]) {
                controls.classList.remove('hidden');
                dropZone.classList.add('has-image');
            } else {
                controls.classList.add('hidden');
                dropZone.classList.remove('has-image');
            }
            mainCanvas.appendChild(dropZone);
        }
        
        debouncedPreviewUpdate();
    }
    
    function createDropZone(slotNumber) {
        const zone = document.createElement('div');
        zone.className = 'drop-zone';
        zone.dataset.slot = slotNumber;
        zone.innerHTML = `
            <div class="drop-zone-placeholder">
                <svg viewBox="0 0 24 24" stroke="currentColor"><rect height="18" rx="2" ry="2" width="18" x="3" y="3"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
                <p>Drop Image ${slotNumber} Here</p>
            </div>
        `;
        return zone;
    }

    function renderDiptychTray() {
        diptychTray.innerHTML = '';
        appState.diptychs.forEach((diptych, index) => {
            const item = document.createElement('div');
            item.className = 'diptych-tray-item';
            item.dataset.index = index;
            
            const preview = document.createElement('div');
            preview.className = 'diptych-tray-preview';
            if (index === appState.activeDiptychIndex) {
                preview.classList.add('active');
            }
            
            const number = document.createElement('span');
            number.className = 'diptych-tray-number';
            number.textContent = index + 1;
            
            item.appendChild(preview);
            item.appendChild(number);
            diptychTray.appendChild(item);
            
            // Update preview image
            updateTrayPreview(preview, diptych);
        });
        
        // Add the "add new" button
        const addButton = document.createElement('div');
        addButton.className = 'add-diptych-btn';
        addButton.innerHTML = `<svg fill="currentColor" height="24" viewBox="0 0 256 256" width="24"><path d="M224,128a8,8,0,0,1-8,8H136v80a8,8,0,0,1-16,0V136H40a8,8,0,0,1,0-16h80V40a8,8,0,0,1,16,0v80h80A8,8,0,0,1,224,128Z"></path></svg>`;
        diptychTray.appendChild(addButton);
    }
    
    // --- PREVIEWS ---
    const debouncedPreviewUpdate = () => {
        const activeDiptych = appState.diptychs[appState.activeDiptychIndex];
        if (!activeDiptych) return;
        
        const key = `diptych-${appState.activeDiptychIndex}`;
        clearTimeout(appState.pregenDebounceTimers[key]);
        appState.pregenDebounceTimers[key] = setTimeout(() => {
            updateMainCanvasPreview(activeDiptych);
            const trayPreviewEl = diptychTray.querySelector(`[data-index='${appState.activeDiptychIndex}'] .diptych-tray-preview`);
            if(trayPreviewEl) updateTrayPreview(trayPreviewEl, activeDiptych);
        }, PREGEN_DELAY);
    };

    async function updateMainCanvasPreview(diptych) {
        if (!diptych.image1 || !diptych.image2) {
            mainCanvas.style.backgroundImage = 'none';
            return;
        }

        const pair = [diptych.image1, diptych.image2];
        const config = { ...diptych.config, width: 10, height: 5, dpi: 72 }; // Use aspect ratio for preview

        try {
            const response = await fetch('/get_preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pair, config })
            });
            if (response.ok) {
                const imageBlob = await response.blob();
                mainCanvas.style.backgroundImage = `url(${URL.createObjectURL(imageBlob)})`;
                
                // Fire-and-forget high-res pre-generation
                fetch('/pregenerate_diptych', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ pair, config: { ...config, dpi: 300 } })
                });
            }
        } catch (error) {
            console.error("Preview failed:", error);
        }
    }
    
    async function updateTrayPreview(element, diptych) {
        if (!diptych.image1 || !diptych.image2) {
            element.style.backgroundImage = 'none';
            return;
        }
        const pair = [diptych.image1, diptych.image2];
        const config = { ...diptych.config, width: 7, height: 4, dpi: 72 }; // Low res for tray
        try {
            const response = await fetch('/get_preview', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pair, config })
            });
            if (response.ok) {
                const imageBlob = await response.blob();
                element.style.backgroundImage = `url(${URL.createObjectURL(imageBlob)})`;
            }
        } catch (error) {
            console.error("Tray preview failed:", error);
        }
    }

    // --- DRAG & DROP ---
    function initializeDragAndDrop() {
        new Sortable(imagePool, {
            group: { name: 'shared', pull: 'clone', put: false },
            animation: 150,
            sort: false,
        });

        new Sortable(mainCanvas, {
            group: 'shared',
            animation: 150,
            onAdd: function (evt) {
                const path = evt.item.dataset.path;
                const slot = evt.to.dataset.slot;
                
                // Remove the cloned thumbnail from the canvas
                evt.item.parentElement.removeChild(evt.item);
                
                if (slot) {
                    const activeDiptych = appState.diptychs[appState.activeDiptychIndex];
                    const imageKey = `image${slot}`;
                    activeDiptych[imageKey] = { path, rotation: 0 };
                    
                    renderImagePool();
                    renderActiveDiptych();
                }
            }
        });
    }

    // --- FINAL GENERATION ---
    async function generateDiptychs() {
        if (appState.isGenerating) return;

        const pairsToGenerate = appState.diptychs.filter(d => d.image1 && d.image2);
        if (pairsToGenerate.length === 0) {
            alert("Please create at least one complete diptych pair.");
            return;
        }
        
        appState.isGenerating = true;
        showLoading('Preparing generation...', 0);

        const payload = {
            pairs: pairsToGenerate.map(d => ({
                pair: [d.image1, d.image2],
                config: { ...d.config, width: 10, height: 8, dpi: 300 } // Example fixed output size
            })),
            zip: zipToggle.checked
        };
        
        const startResponse = await fetch('/generate_diptychs', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const startResult = await startResponse.json();

        if (startResult.status === 'started') {
            const progressInterval = setInterval(async () => {
                const progressResponse = await fetch('/get_generation_progress');
                const progress = await progressResponse.json();
                
                const percent = (progress.processed / progress.total) * 100;
                updateLoadingProgress(percent, `Generating... (${progress.processed} of ${progress.total})`);
                
                if (progress.processed >= progress.total) {
                    clearInterval(progressInterval);
                    updateLoadingProgress(100, 'Finalizing download...');

                    const finalResponse = await fetch('/finalize_download');
                    const finalResult = await finalResponse.json();
                    hideLoading();
                    
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
                    appState.isGenerating = false;
                }
            }, 1000);
        } else {
            hideLoading();
            appState.isGenerating = false;
        }
    }
    
    // --- UI HELPERS ---
    function showLoading(text, percent = 0) {
        progressText.textContent = text;
        progressBar.style.width = `${percent}%`;
        loadingOverlay.classList.remove('hidden');
    }
    
    function updateLoadingProgress(percent, text) {
        progressText.textContent = text;
        progressBar.style.width = `${percent}%`;
    }

    function hideLoading() {
        loadingOverlay.classList.add('hidden');
    }

    // --- START THE APP ---
    init();
});
