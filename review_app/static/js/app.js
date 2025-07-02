// review_app/static/js/app.js

document.addEventListener('DOMContentLoaded', () => {
    // --- STATE MANAGEMENT ---
    let appState = {
        images: [], // All uploaded images: { path: 'filename.jpg' }
        diptychs: [], // All created diptychs
        activeDiptychIndex: 0,
        previewDebounceTimer: null,
        isGenerating: false,
    };
    const PREVIEW_DEBOUNCE_DELAY = 300; // ms to wait after a change before fetching a new preview

    // --- ELEMENT SELECTORS ---
    const fileUploader = document.getElementById('file-uploader');
    const welcomeScreen = document.getElementById('welcome-screen');
    const appContainer = document.getElementById('app-container');
    const imagePool = document.getElementById('image-pool');
    const unpairedCount = document.getElementById('unpaired-count');
    const mainCanvas = document.getElementById('main-canvas');
    const canvasGrid = document.getElementById('canvas-grid');
    const diptychTray = document.getElementById('diptych-tray');
    const leftPanel = document.getElementById('left-panel');
    const rightPanel = document.getElementById('right-panel');
    
    const selectImagesBtn = document.getElementById('select-images-btn');
    const uploadMoreBtn = document.getElementById('upload-more-btn');
    const uploadLabel = document.getElementById('upload-label');
    const downloadBtn = document.getElementById('download-btn');
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');

    // Config Controls
    const outputSizeSelect = document.getElementById('output-size');
    const outputDpiSelect = document.getElementById('output-dpi');
    const imageFittingSelect = document.getElementById('image-fitting');
    const borderSizeSlider = document.getElementById('border-size');
    const borderSizeValue = document.getElementById('border-size-value');
    const zipToggle = document.getElementById('zip-toggle');
    
    const loadingOverlay = document.getElementById('loading-overlay');
    const progressText = document.getElementById('progress-text');
    const progressBar = document.getElementById('progress-bar');

    const hamburgerIcon = `<svg fill="none" height="20" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" width="20"><line x1="3" x2="21" y1="12" y2="12"></line><line x1="3" x2="21" y1="6" y2="6"></line><line x1="3" x2="21" y1="18" y2="18"></line></svg>`;
    const closeIcon = `<svg fill="none" height="20" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" width="20"><line x1="18" x2="6" y1="6" y2="18"></line><line x1="6" x2="18" y1="6" y2="18"></line></svg>`;

    // --- INITIALIZATION ---
    function init() {
        addEventListeners();
        addNewDiptych();
        initializeDragAndDrop();
        updateMobileMenuIcon();
    }

    // --- EVENT LISTENERS ---
    function addEventListeners() {
        selectImagesBtn.addEventListener('click', () => fileUploader.click());
        uploadMoreBtn.addEventListener('click', () => fileUploader.click());
        uploadLabel.addEventListener('click', () => fileUploader.click());
        fileUploader.addEventListener('change', handleFileUpload);
        downloadBtn.addEventListener('click', generateDiptychs);
        mobileMenuBtn.addEventListener('click', toggleMobilePanels);

        // All config changes trigger a new preview
        outputSizeSelect.addEventListener('change', handleConfigChange);
        outputDpiSelect.addEventListener('change', handleConfigChange);
        imageFittingSelect.addEventListener('change', handleConfigChange);
        borderSizeSlider.addEventListener('input', handleConfigChange); // Use input for live updates

        document.addEventListener('click', (e) => {
            if (e.target.closest('.btn-rotate')) handleRotate(e);
            if (e.target.closest('.btn-remove')) handleRemove(e);
        });
        
        diptychTray.addEventListener('click', handleTrayClick);
        document.getElementById('scroll-left-btn').addEventListener('click', () => scrollTray(-200));
        document.getElementById('scroll-right-btn').addEventListener('click', () => scrollTray(200));
    }

    // --- UI LOGIC & STATE ---
    function showAppContainer() {
        if (!welcomeScreen.classList.contains('hidden')) {
            welcomeScreen.classList.add('hidden');
            appContainer.classList.remove('hidden');
            if (window.innerWidth >= 768) {
                leftPanel.classList.remove('hidden');
                rightPanel.classList.remove('hidden');
            }
        }
    }

    function updateMobileMenuIcon() {
        mobileMenuBtn.innerHTML = (leftPanel.classList.contains('hidden') && rightPanel.classList.contains('hidden')) ? hamburgerIcon : closeIcon;
    }

    function toggleMobilePanels() {
        const isLeftHidden = leftPanel.classList.contains('hidden');
        const isRightHidden = rightPanel.classList.contains('hidden');
        if (!isLeftHidden) { leftPanel.classList.add('hidden'); rightPanel.classList.remove('hidden'); } 
        else if (!isRightHidden) { rightPanel.classList.add('hidden'); } 
        else { leftPanel.classList.remove('hidden'); }
        updateMobileMenuIcon();
    }

    async function handleFileUpload(event) {
        const files = event.target.files;
        if (!files.length) return;
        showLoading('Uploading images...');
        const formData = new FormData();
        const newFilenames = Array.from(files).map(f => f.name);
        for (const file of files) formData.append('files[]', file);
        
        showAppContainer();
        const newImages = newFilenames.map(filename => ({ path: filename }));
        newImages.forEach(newImg => {
            if (!appState.images.some(existing => existing.path === newImg.path)) appState.images.push(newImg);
        });
        renderImagePool();

        try {
            const response = await fetch('/upload_images', { method: 'POST', body: formData });
            if (!response.ok) throw new Error(`Upload failed: ${response.statusText}`);
            hideLoading();
        } catch (error) {
            console.error("Error during file upload:", error);
            alert(`An error occurred during upload: ${error.message}`);
            hideLoading();
            appState.images = appState.images.filter(img => !newFilenames.includes(img.path));
            renderImagePool();
        }
        event.target.value = null;
    }

    function addNewDiptych(andSwitch = true) {
        const newDiptych = {
            image1: null, image2: null,
            config: { fit_mode: 'fill', gap: 25, width: 10, height: 8, dpi: 300 }
        };
        appState.diptychs.push(newDiptych);
        if (andSwitch) appState.activeDiptychIndex = appState.diptychs.length - 1;
        renderDiptychTray();
        if (andSwitch) renderActiveDiptychUI();
    }

    function switchActiveDiptych(index) {
        if (index >= 0 && index < appState.diptychs.length) {
            appState.activeDiptychIndex = index;
            renderDiptychTray();
            renderActiveDiptychUI();
        }
    }

    function handleConfigChange() {
        const activeDiptych = appState.diptychs[appState.activeDiptychIndex];
        if (!activeDiptych) return;
        
        // Update state from UI
        const [width, height] = outputSizeSelect.value.split('x').map(parseFloat);
        activeDiptych.config.width = width;
        activeDiptych.config.height = height;
        activeDiptych.config.dpi = parseInt(outputDpiSelect.value, 10);
        activeDiptych.config.fit_mode = imageFittingSelect.value;
        activeDiptych.config.gap = parseInt(borderSizeSlider.value, 10);
        
        // Update UI that doesn't require a full re-render
        borderSizeValue.textContent = `${activeDiptych.config.gap} px`;

        // Trigger a debounced preview refresh
        requestPreviewRefresh();
    }
    
    function handleRotate(e) {
        const slot = e.target.closest('button').dataset.slot;
        const activeDiptych = appState.diptychs[appState.activeDiptychIndex];
        const imageKey = `image${slot}`;
        if (activeDiptych && activeDiptych[imageKey]) {
            activeDiptych[imageKey].rotation = ((activeDiptych[imageKey].rotation || 0) + 90) % 360;
            requestPreviewRefresh(); // A rotation requires a new preview
        }
    }

    function handleRemove(e) {
        const slot = e.target.closest('button').dataset.slot;
        const activeDiptych = appState.diptychs[appState.activeDiptychIndex];
        const imageKey = `image${slot}`;
        if (activeDiptych && activeDiptych[imageKey]) {
            activeDiptych[imageKey] = null;
            renderImagePool();
            renderActiveDiptychUI(); // Full UI refresh to show placeholder
        }
    }
    
    function handleTrayClick(e) {
        const item = e.target.closest('.diptych-tray-item');
        if (item) switchActiveDiptych(parseInt(item.dataset.index, 10));
        else if (e.target.closest('.add-diptych-btn')) addNewDiptych();
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
        unpairedImages.forEach(imgData => {
            const thumbContainer = document.createElement('div');
            thumbContainer.className = 'img-thumbnail thumbnail-loading';
            thumbContainer.dataset.path = imgData.path;
            const imgEl = document.createElement('img');
            imgEl.src = `/thumbnail/${encodeURIComponent(imgData.path)}`;
            imgEl.onload = () => { imgEl.classList.add('loaded'); thumbContainer.classList.remove('thumbnail-loading'); };
            imgEl.onerror = () => { setTimeout(() => { imgEl.src = `/thumbnail/${encodeURIComponent(imgData.path)}?t=${new Date().getTime()}` }, 1000); };
            const filenameDiv = document.createElement('div');
            filenameDiv.className = 'filename';
            filenameDiv.textContent = imgData.path;
            thumbContainer.append(imgEl, filenameDiv);
            imagePool.appendChild(thumbContainer);
        });
    }

    /**
     * Renders the entire active diptych UI, including controls and the main canvas.
     * This function is "dumb" - it just reflects the current appState.
     */
    function renderActiveDiptychUI() {
        const activeDiptych = appState.diptychs[appState.activeDiptychIndex];
        if (!activeDiptych) return;

        // Sync right-panel controls with the active diptych's state
        outputSizeSelect.value = `${activeDiptych.config.width}x${activeDiptych.config.height}`;
        outputDpiSelect.value = activeDiptych.config.dpi;
        imageFittingSelect.value = activeDiptych.config.fit_mode;
        borderSizeSlider.value = activeDiptych.config.gap;
        borderSizeValue.textContent = `${activeDiptych.config.gap} px`;
        
        // Show/hide image-specific controls
        document.getElementById('image-1-controls').classList.toggle('hidden', !activeDiptych.image1);
        document.getElementById('image-2-controls').classList.toggle('hidden', !activeDiptych.image2);
        
        // Render the drop zone placeholders
        canvasGrid.innerHTML = '';
        canvasGrid.appendChild(createDropZone(1));
        canvasGrid.appendChild(createDropZone(2));
        initializeCanvasDropZones();

        // Trigger a preview refresh, which will handle showing the image or placeholders
        requestPreviewRefresh();
    }
    
    function createDropZone(slotNumber) {
        const zone = document.createElement('div');
        zone.className = 'drop-zone';
        zone.dataset.slot = slotNumber;
        zone.innerHTML = `<div class="drop-zone-placeholder"><svg viewBox="0 0 24 24" stroke="currentColor"><rect height="18" rx="2" ry="2" width="18" x="3" y="3"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg><p>Drop Image ${slotNumber} Here</p></div>`;
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
            if (index === appState.activeDiptychIndex) preview.classList.add('active');
            const number = document.createElement('span');
            number.className = 'diptych-tray-number';
            number.textContent = index + 1;
            item.append(preview, number);
            diptychTray.appendChild(item);
            // Tray previews are now also generated via the WYSIWYG endpoint
            updateTrayPreview(preview, diptych);
        });
        const addButton = document.createElement('div');
        addButton.className = 'add-diptych-btn';
        addButton.innerHTML = `<svg fill="currentColor" height="24" viewBox="0 0 256 256" width="24"><path d="M224,128a8,8,0,0,1-8,8H136v80a8,8,0,0,1-16,0V136H40a8,8,0,0,1,0-16h80V40a8,8,0,0,1,16,0v80h80A8,8,0,0,1,224,128Z"></path></svg>`;
        diptychTray.appendChild(addButton);
    }
    
    // --- WYSIWYG PREVIEW SYSTEM ---

    /**
     * Central function to request a preview refresh. Debounces requests to avoid
     * overwhelming the server during rapid changes (like dragging a slider).
     */
    function requestPreviewRefresh() {
        clearTimeout(appState.previewDebounceTimer);
        appState.previewDebounceTimer = setTimeout(refreshWysiwygPreview, PREVIEW_DEBOUNCE_DELAY);
    }

    /**
     * Fetches and displays the accurate, server-generated preview.
     * This is the heart of the new WYSIWYG system.
     */
    async function refreshWysiwygPreview() {
        const activeDiptych = appState.diptychs[appState.activeDiptychIndex];
        if (!activeDiptych) return;

        // 1. Set the main canvas aspect ratio to match the output
        mainCanvas.style.aspectRatio = `${activeDiptych.config.width} / ${activeDiptych.config.height}`;

        // 2. Show loading state on the canvas
        mainCanvas.classList.add('preview-loading');

        try {
            const response = await fetch('/get_wysiwyg_preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ diptych: activeDiptych })
            });

            if (response.ok) {
                const imageBlob = await response.blob();
                const objectURL = URL.createObjectURL(imageBlob);
                mainCanvas.style.backgroundImage = `url(${objectURL})`;
                // Hide the dropzone grid when a valid preview is shown
                canvasGrid.classList.add('hidden');
            } else {
                 // If the server returns an error (e.g., no images), clear the preview
                mainCanvas.style.backgroundImage = 'none';
                // Show the dropzone grid so the user can add images
                canvasGrid.classList.remove('hidden');
            }
        } catch (error) {
            console.error("WYSIWYG Preview failed:", error);
            mainCanvas.style.backgroundImage = 'none';
            canvasGrid.classList.remove('hidden');
        } finally {
            // 4. Hide loading state
            mainCanvas.classList.remove('preview-loading');
            // Also update the small tray preview
            updateTrayPreview(diptychTray.querySelector(`[data-index='${appState.activeDiptychIndex}'] .diptych-tray-preview`), activeDiptych);
        }
    }
    
    /**
     * Updates the small preview in the bottom tray.
     * Re-uses the same WYSIWYG endpoint for consistency.
     */
    async function updateTrayPreview(element, diptych) {
        if (!element || !diptych) return;
        
        // Don't fetch if there are no images
        if (!diptych.image1 && !diptych.image2) {
            element.style.backgroundImage = 'none';
            return;
        }

        try {
            const response = await fetch('/get_wysiwyg_preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ diptych: diptych })
            });
            if (response.ok) {
                const imageBlob = await response.blob();
                element.style.backgroundImage = `url(${URL.createObjectURL(imageBlob)})`;
            } else {
                element.style.backgroundImage = 'none';
            }
        } catch (error) { 
            console.error("Tray preview failed:", error); 
            element.style.backgroundImage = 'none';
        }
    }

    // --- DRAG & DROP ---
    function initializeDragAndDrop() {
        new Sortable(imagePool, {
            group: { name: 'shared', pull: 'clone', put: false },
            animation: 150,
            sort: false,
        });
    }
    
    function initializeCanvasDropZones() {
        // This logic remains largely the same, but now it just updates the state
        // and triggers a full UI/Preview refresh.
        document.querySelectorAll('#canvas-grid .drop-zone').forEach(zone => {
            new Sortable(zone, {
                group: 'shared', animation: 150,
                onAdd: function (evt) {
                    const path = evt.item.dataset.path;
                    const slot = evt.to.dataset.slot;
                    evt.item.parentElement.removeChild(evt.item); // Remove the dragged clone
                    if (slot) {
                        const activeDiptych = appState.diptychs[appState.activeDiptychIndex];
                        const imageKey = `image${slot}`;
                        activeDiptych[imageKey] = { path, rotation: 0 };
                        renderImagePool();
                        renderActiveDiptychUI(); // This will trigger the new preview
                    }
                },
                onStart: () => document.body.classList.add('is-dragging'),
                onEnd: () => document.body.classList.remove('is-dragging'),
                onMove: (evt) => {
                    document.querySelectorAll('.drop-zone').forEach(z => z.classList.remove('drag-over'));
                    if (evt.related.classList.contains('drop-zone')) evt.related.classList.add('drag-over');
                }
            });
        });
    }

    // --- FINAL GENERATION ---
    async function generateDiptychs() {
        if (appState.isGenerating) return;
        const pairsToGenerate = appState.diptychs.filter(d => d.image1 && d.image2);
        
        if (pairsToGenerate.length === 0) {
            alert("Please create at least one complete diptych pair before downloading.");
            return;
        }

        appState.isGenerating = true;
        showLoading('Preparing generation...', 0);
        const payload = {
            pairs: pairsToGenerate.map(d => ({
                pair: [d.image1, d.image2],
                config: d.config
            })),
            zip: zipToggle.checked
        };

        try {
            const startResponse = await fetch('/generate_diptychs', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const startResult = await startResponse.json();
            if (startResult.status !== 'started') throw new Error('Failed to start generation on server.');

            const progressInterval = setInterval(async () => {
                const progressResponse = await fetch('/get_generation_progress');
                const progress = await progressResponse.json();
                const percent = progress.total > 0 ? (progress.processed / progress.total) * 100 : 0;
                updateLoadingProgress(percent, `Generating... (${progress.processed} of ${progress.total})`);
                
                if (progress.processed >= progress.total) {
                    clearInterval(progressInterval);
                    updateLoadingProgress(100, 'Finalizing download...');
                    const finalResponse = await fetch('/finalize_download');
                    const finalResult = await finalResponse.json();
                    hideLoading();
                    
                    if (finalResult.download_path) {
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
        } catch (error) {
            console.error("Generation failed:", error);
            hideLoading();
            alert(`An error occurred during generation: ${error.message}`);
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