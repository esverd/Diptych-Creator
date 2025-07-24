// review_app/static/js/app.js

document.addEventListener('DOMContentLoaded', () => {
    // --- STATE MANAGEMENT ---
    let appState = {
        images: [],
        diptychs: [],
        activeDiptychIndex: 0,
        previewDebounceTimer: null,
        isGenerating: false,
    };
    const PREVIEW_DEBOUNCE_DELAY = 300;

    // --- ELEMENT SELECTORS ---
    const fileUploader = document.getElementById('file-uploader');
    const welcomeScreen = document.getElementById('welcome-screen');
    const appContainer = document.getElementById('app-container');
    const imagePool = document.getElementById('image-pool');
    const unpairedCount = document.getElementById('unpaired-count');
    const mainCanvas = document.getElementById('main-canvas');
    const previewImage = document.getElementById('preview-image');
    const canvasGrid = document.getElementById('canvas-grid');
    const diptychTray = document.getElementById('diptych-tray');
    const leftPanel = document.getElementById('left-panel');
    const rightPanel = document.getElementById('right-panel');
    const selectImagesBtn = document.getElementById('select-images-btn');
    const uploadMoreBtn = document.getElementById('upload-more-btn');
    const uploadLabel = document.getElementById('upload-label');
    const downloadBtn = document.getElementById('download-btn');
    const autoPairBtn = document.getElementById('auto-pair-btn');
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    const outputSizeSelect = document.getElementById('output-size');
    const orientationBtn = document.getElementById('orientation-btn');
    const customDimContainer = document.getElementById('custom-dim-container');
    const customWidthInput = document.getElementById('custom-width');
    const customHeightInput = document.getElementById('custom-height');
    const outputDpiSelect = document.getElementById('output-dpi');
    const imageFittingSelect = document.getElementById('image-fitting');
    const borderSizeSlider = document.getElementById('border-size');
    const borderSizeValue = document.getElementById('border-size-value');
    const zipToggle = document.getElementById('zip-toggle');
    const loadingOverlay = document.getElementById('loading-overlay');
    const progressText = document.getElementById('progress-text');
    const progressBar = document.getElementById('progress-bar');
    const outerBorderSizeSlider = document.getElementById('outer-border-size');
    const outerBorderSizeValue = document.getElementById('outer-border-size-value');
    const borderColorInput = document.getElementById('border-color');

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
        [selectImagesBtn, uploadMoreBtn, uploadLabel].forEach(el => el.addEventListener('click', () => fileUploader.click()));
        fileUploader.addEventListener('change', handleFileUpload);
        downloadBtn.addEventListener('click', generateDiptychs);
        autoPairBtn.addEventListener('click', autoPairImages);
        mobileMenuBtn.addEventListener('click', toggleMobilePanels);
        outputSizeSelect.addEventListener('change', handleConfigChange);
        orientationBtn.addEventListener('click', toggleOrientation);
        [customWidthInput, customHeightInput].forEach(el => el.addEventListener('input', handleConfigChange));
        outputDpiSelect.addEventListener('change', handleConfigChange);
        imageFittingSelect.addEventListener('change', handleConfigChange);
        borderSizeSlider.addEventListener('input', handleConfigChange);
        outerBorderSizeSlider.addEventListener('input', handleConfigChange);
        borderColorInput.addEventListener('input', handleConfigChange);
        document.addEventListener('click', (e) => {
            if (e.target.closest('.btn-rotate')) handleRotate(e);
            if (e.target.closest('.btn-remove')) handleRemove(e);
        });
        diptychTray.addEventListener('click', handleTrayClick);
        document.getElementById('scroll-left-btn').addEventListener('click', () => scrollTray(-200));
        document.getElementById('scroll-right-btn').addEventListener('click', () => scrollTray(200));
    }

    // --- UI & STATE ---
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
        const leftPanel = document.getElementById('left-panel');
        const rightPanel = document.getElementById('right-panel');
        const isHidden = leftPanel.classList.contains('hidden');

        if (isHidden) {
            leftPanel.classList.remove('hidden');
            rightPanel.classList.remove('hidden');
        } else {
            leftPanel.classList.add('hidden');
            rightPanel.classList.add('hidden');
        }
        updateMobileMenuIcon();
    }

    async function handleFileUpload(event) {
        const files = event.target.files;
        if (!files.length) return;
        showLoading('Uploading images...');
        const formData = new FormData();
        Array.from(files).forEach(file => formData.append('files[]', file));
        try {
            const response = await fetch('/upload_images', { method: 'POST', body: formData });
            if (!response.ok) throw new Error('Upload failed');
            const uploaded = await response.json();
            const newImages = uploaded.map(name => ({ path: name }));
            newImages.forEach(newImg => {
                if (!appState.images.some(existing => existing.path === newImg.path)) {
                    appState.images.push(newImg);
                }
            });
            renderImagePool();
            showAppContainer();
        } catch (error) {
            console.error('Upload failed:', error);
            alert(`Upload failed: ${error.message}`);
        } finally {
            hideLoading();
            event.target.value = null;
        }
    }

    function getDefaultConfig() {
        return { fit_mode: 'fill', gap: 25, width: 10, height: 8, orientation: 'landscape', dpi: 300, outer_border: 0, border_color: '#ffffff' };
    }

    function addNewDiptych(andSwitch = true, baseConfig = null) {
        const reference = baseConfig || appState.diptychs[appState.activeDiptychIndex]?.config || getDefaultConfig();
        const newDiptych = {
            image1: null,
            image2: null,
            config: { ...reference }
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

    async function autoPairImages() {
        if (appState.images.length === 0) return;
        showLoading('Pairing images...');
        try {
            const baseConfig = { ...(appState.diptychs[appState.activeDiptychIndex]?.config || getDefaultConfig()) };
            appState.diptychs = [];
            for (let i = 0; i < appState.images.length; i += 2) {
                const img1 = appState.images[i] ? { ...appState.images[i] } : null;
                const img2 = appState.images[i + 1] ? { ...appState.images[i + 1] } : null;
                appState.diptychs.push({ image1: img1, image2: img2, config: { ...baseConfig } });
            }
            if (appState.diptychs.length === 0) addNewDiptych();
            appState.activeDiptychIndex = 0;
            renderDiptychTray();
            renderImagePool();
            renderActiveDiptychUI();
        } catch (err) {
            alert('Auto pairing failed: ' + err.message);
        } finally {
            hideLoading();
        }
    }

    function handleConfigChange() {
        const activeDiptych = appState.diptychs[appState.activeDiptychIndex];
        if (!activeDiptych) return;
        const config = activeDiptych.config;
        const selectedSize = outputSizeSelect.value;
        
        const isSwitchingToCustom = selectedSize === 'custom' && customDimContainer.classList.contains('hidden');
        if (isSwitchingToCustom) {
            customWidthInput.value = config.width;
            customHeightInput.value = config.height;
        }
        
        customDimContainer.classList.toggle('hidden', selectedSize !== 'custom');

        if (selectedSize === 'custom') {
            config.width = parseFloat(customWidthInput.value) || 10;
            config.height = parseFloat(customHeightInput.value) || 8;
        } else {
            [config.width, config.height] = selectedSize.split('x').map(parseFloat);
        }
        
        config.dpi = parseInt(outputDpiSelect.value, 10);
        config.fit_mode = imageFittingSelect.value;
        config.gap = parseInt(borderSizeSlider.value, 10);
        borderSizeValue.textContent = `${config.gap} px`;
        config.outer_border = parseInt(outerBorderSizeSlider.value, 10);
        outerBorderSizeValue.textContent = `${config.outer_border} px`;
        config.border_color = borderColorInput.value;
        
        // Update UI elements that depend on config changes
        renderActiveDiptychUI();
        requestPreviewRefresh();
    }

    function toggleOrientation() {
        const activeDiptych = appState.diptychs[appState.activeDiptychIndex];
        if (!activeDiptych) return;
        activeDiptych.config.orientation = activeDiptych.config.orientation === 'landscape' ? 'portrait' : 'landscape';
        renderActiveDiptychUI();
    }
    
    function handleRotate(e) {
        const slot = e.target.closest('button').dataset.slot;
        const activeDiptych = appState.diptychs[appState.activeDiptychIndex];
        const imageKey = `image${slot}`;
        if (activeDiptych?.[imageKey]) {
            activeDiptych[imageKey].rotation = ((activeDiptych[imageKey].rotation || 0) + 90) % 360;
            requestPreviewRefresh();
        }
    }

    function handleRemove(e) {
        const slot = e.target.closest('button').dataset.slot;
        const activeDiptych = appState.diptychs[appState.activeDiptychIndex];
        const imageKey = `image${slot}`;
        if (activeDiptych?.[imageKey]) {
            activeDiptych[imageKey] = null;
            renderImagePool();
            renderActiveDiptychUI();
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
            imgEl.onerror = () => setTimeout(() => { imgEl.src = `/thumbnail/${encodeURIComponent(imgData.path)}?t=${Date.now()}` }, 1000);
            const filenameDiv = document.createElement('div');
            filenameDiv.className = 'filename';
            filenameDiv.textContent = imgData.path;
            thumbContainer.append(imgEl, filenameDiv);
            imagePool.appendChild(thumbContainer);
        });
    }

    function renderActiveDiptychUI() {
        const activeDiptych = appState.diptychs[appState.activeDiptychIndex];
        if (!activeDiptych) return;
        const { config } = activeDiptych;
        
        const sizeValue = `${config.width}x${config.height}`;
        outputSizeSelect.value = outputSizeSelect.querySelector(`option[value="${sizeValue}"]`) ? sizeValue : 'custom';
        
        customDimContainer.classList.toggle('hidden', outputSizeSelect.value !== 'custom');
        customWidthInput.value = config.width;
        customHeightInput.value = config.height;

        outputDpiSelect.value = config.dpi;
        imageFittingSelect.value = config.fit_mode;
        borderSizeSlider.value = config.gap;
        borderSizeValue.textContent = `${config.gap} px`;
        outerBorderSizeSlider.value = config.outer_border;
        outerBorderSizeValue.textContent = `${config.outer_border} px`;
        borderColorInput.value = config.border_color;
        
        orientationBtn.innerHTML = config.orientation === 'landscape' 
            ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="12" rx="2" ry="2"></rect></svg>` 
            : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="3" width="12" height="18" rx="2" ry="2"></rect></svg>`;
        orientationBtn.setAttribute('aria-label', `Toggle to ${config.orientation === 'landscape' ? 'portrait' : 'landscape'}`);

        const isSquare = config.width === config.height;
        orientationBtn.disabled = isSquare;
        orientationBtn.classList.toggle('opacity-50', isSquare);
        orientationBtn.classList.toggle('cursor-not-allowed', isSquare);

        document.getElementById('image-1-controls').classList.toggle('hidden', !activeDiptych.image1);
        document.getElementById('image-2-controls').classList.toggle('hidden', !activeDiptych.image2);
        
        requestPreviewRefresh();
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
            updateTrayPreview(preview, diptych);
        });
        const addButton = document.createElement('div');
        addButton.className = 'add-diptych-btn';
        addButton.innerHTML = `<svg fill="currentColor" height="24" viewBox="0 0 256 256" width="24"><path d="M224,128a8,8,0,0,1-8,8H136v80a8,8,0,0,1-16,0V136H40a8,8,0,0,1,0-16h80V40a8,8,0,0,1,16,0v80h80A8,8,0,0,1,224,128Z"></path></svg>`;
        diptychTray.appendChild(addButton);
    }
    
    // --- WYSIWYG PREVIEW SYSTEM ---
    function requestPreviewRefresh() {
        clearTimeout(appState.previewDebounceTimer);
        appState.previewDebounceTimer = setTimeout(refreshWysiwygPreview, PREVIEW_DEBOUNCE_DELAY);
    }

    async function refreshWysiwygPreview() {
        const activeDiptych = appState.diptychs[appState.activeDiptychIndex];
        if (!activeDiptych || (!activeDiptych.image1 && !activeDiptych.image2)) {
            previewImage.classList.add('hidden');
            mainCanvas.classList.remove('preview-loading');
            return;
        }
        try {
            mainCanvas.classList.add('preview-loading');
            const response = await fetch('/get_wysiwyg_preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ diptych: activeDiptych })
            });
            if (!response.ok) {
                throw new Error(`Preview failed: ${response.statusText}`);
            }
            const blob = await response.blob();
            const imageUrl = URL.createObjectURL(blob);
            previewImage.onload = () => {
                previewImage.classList.remove('hidden');
                mainCanvas.classList.remove('preview-loading');
                URL.revokeObjectURL(imageUrl);
            };
            previewImage.src = imageUrl;
        } catch (error) {
            console.error('Preview generation failed:', error);
            previewImage.classList.add('hidden');
            mainCanvas.classList.remove('preview-loading');
        }
    }
    
    async function updateTrayPreview(element, diptych) {
        if (!element || !diptych || (!diptych.image1 && !diptych.image2)) {
            if(element) element.style.backgroundImage = 'none';
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
        const dropZones = document.querySelectorAll('.drop-zone');
        const thumbnails = document.querySelectorAll('.img-thumbnail');

        // Track if we're currently dragging
        let isDragging = false;

        // Handle drag events for thumbnails
        document.addEventListener('dragstart', (e) => {
            const thumbnail = e.target.closest('.img-thumbnail');
            if (thumbnail) {
                isDragging = true;
                e.dataTransfer.setData('text/plain', thumbnail.dataset.path);
                e.dataTransfer.effectAllowed = 'move';
            }
        });

        document.addEventListener('dragend', () => {
            isDragging = false;
            dropZones.forEach(zone => zone.classList.remove('drag-over'));
        });

        // Handle drop zone events
        dropZones.forEach(zone => {
            zone.addEventListener('dragenter', (e) => {
                if (isDragging) {
                    e.preventDefault();
                    zone.classList.add('drag-over');
                }
            });

            zone.addEventListener('dragover', (e) => {
                if (isDragging) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                }
            });

            zone.addEventListener('dragleave', (e) => {
                if (!e.relatedTarget || !zone.contains(e.relatedTarget)) {
                    zone.classList.remove('drag-over');
                }
            });

            zone.addEventListener('drop', (e) => {
                e.preventDefault();
                zone.classList.remove('drag-over');
                
                const path = e.dataTransfer.getData('text/plain');
                const slot = zone.dataset.slot;
                const activeDiptych = appState.diptychs[appState.activeDiptychIndex];
                
                if (activeDiptych) {
                    const imageKey = `image${slot}`;
                    activeDiptych[imageKey] = { path };
                    renderActiveDiptychUI();
                    requestPreviewRefresh();
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
            pairs: pairsToGenerate.map(d => ({ pair: [d.image1, d.image2], config: d.config })),
            zip: zipToggle.checked
        };
        try {
            const startResponse = await fetch('/generate_diptychs', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!startResponse.ok) throw new Error('Failed to start generation on server.');
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
            hideLoading();
            alert(`An error occurred: ${error.message}`);
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

    init();
});