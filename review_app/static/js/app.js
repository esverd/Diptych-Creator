// review_app/static/js/app.js

const DiptychApp = (() => {
    // --- STATE MANAGEMENT ---
    let appState = {
        images: [],
        diptychs: [],
        activeDiptychIndex: 0,
        previewDebounceTimer: null,
        isGenerating: false,
        // Holds the Sortable instance for used images; allows us to destroy
        // the instance before creating a new one when the pool is re-rendered.
        usedSortable: null,
    };
    const PREVIEW_DEBOUNCE_DELAY = 300;

    function pxToMm(px, dpi) {
        return Math.round((px / dpi) * 25.4);
    }

    // --- ELEMENT SELECTORS ---
    const fileUploader = document.getElementById('file-uploader');
    const welcomeScreen = document.getElementById('welcome-screen');
    const appContainer = document.getElementById('app-container');
    const imagePool = document.getElementById('image-pool');
    const usedImagePool = document.getElementById('used-image-pool');
    const unpairedCount = document.getElementById('unpaired-count');
    const usedCount = document.getElementById('used-count');
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
    const groupingMethodSelect = document.getElementById('grouping-method');
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
    // Crop focus selectors (horizontal and vertical) allow the user to
    // choose which part of the image is preserved when cropping.  Values
    // correspond to 0 (start), 0.5 (center) and 1 (end).
    const cropFocusHSelect = document.getElementById('crop-focus-h');
    const cropFocusVSelect = document.getElementById('crop-focus-v');
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
        if (cropFocusHSelect) cropFocusHSelect.addEventListener('change', handleConfigChange);
        if (cropFocusVSelect) cropFocusVSelect.addEventListener('change', handleConfigChange);
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

    function updateCanvasAspectRatio(config) {
        let w = config.width;
        let h = config.height;
        if (config.orientation === 'portrait') {
            [w, h] = [h, w];
        }
        mainCanvas.style.aspectRatio = `${w} / ${h}`;
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
            const result = await response.json();
            let uploadedNames;
            let invalidNames = [];
            // The server returns an object with either a list of uploaded names
            // or both uploaded and invalid keys.  Support both formats.
            if (Array.isArray(result)) {
                uploadedNames = result;
            } else {
                uploadedNames = result.uploaded || [];
                invalidNames = result.invalid || [];
            }
            if (invalidNames.length) {
                alert(`Some files were not uploaded (unsupported type):\n${invalidNames.join(', ')}`);
            }
            const newImages = uploadedNames.map(name => ({ path: name }));
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

    function addNewDiptych(andSwitch = true) {
        let baseConfig = { fit_mode: 'fit', gap: 20, width: 6, height: 4, orientation: 'landscape', dpi: 300, outer_border: 20, border_color: '#ffffff', crop_focus: [0.5, 0.5] };
        if (appState.diptychs.length > 0) {
            baseConfig = { ...appState.diptychs[appState.activeDiptychIndex].config };
        }
        const newDiptych = {
            image1: null,
            image2: null,
            config: { ...baseConfig }
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

    function deleteDiptych(index) {
        if (appState.diptychs.length <= 1) return;
        if (index >= 0 && index < appState.diptychs.length) {
            appState.diptychs.splice(index, 1);
            if (appState.activeDiptychIndex >= appState.diptychs.length) {
                appState.activeDiptychIndex = appState.diptychs.length - 1;
            }
            renderDiptychTray();
            renderImagePool();
            renderActiveDiptychUI();
        }
    }

    async function autoPairImages() {
        if (appState.images.length === 0) return;
        showLoading('Pairing images...');
        try {
            const baseConfig = appState.diptychs.length > 0
                ? { ...appState.diptychs[appState.activeDiptychIndex].config }
                : { fit_mode: 'fit', gap: 20, width: 6, height: 4, orientation: 'landscape', dpi: 300, outer_border: 20, border_color: '#ffffff' };
            // Determine grouping method from the selector.  Defaults to chronological.
            const method = groupingMethodSelect ? groupingMethodSelect.value : 'chronological';
            const response = await fetch('/auto_group', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method }) });
            if (!response.ok) throw new Error('Auto grouping failed');
            const data = await response.json();
            appState.diptychs = data.pairs.map(p => ({
                image1: p[0] ? { path: p[0] } : null,
                image2: p[1] ? { path: p[1] } : null,
                config: { ...baseConfig }
            }));
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
        borderSizeValue.textContent = `${pxToMm(config.gap, config.dpi)} mm`;
        config.outer_border = parseInt(outerBorderSizeSlider.value, 10);
        outerBorderSizeValue.textContent = `${pxToMm(config.outer_border, config.dpi)} mm`;
        config.border_color = borderColorInput.value;
        // Update crop focus from selectors if present
        if (cropFocusHSelect && cropFocusVSelect) {
            const hValue = parseFloat(cropFocusHSelect.value);
            const vValue = parseFloat(cropFocusVSelect.value);
            if (!isNaN(hValue) && !isNaN(vValue)) {
                config.crop_focus = [hValue, vValue];
            }
        }
        // Keep preview background in sync with selected border color
        previewImage.style.backgroundColor = config.border_color;
        mainCanvas.style.backgroundColor = config.border_color;
        // Update UI elements that depend on config changes
        renderActiveDiptychUI();
        updateActiveTrayPreview();
        requestPreviewRefresh();
    }

    function toggleOrientation() {
        const activeDiptych = appState.diptychs[appState.activeDiptychIndex];
        if (!activeDiptych) return;
        activeDiptych.config.orientation = activeDiptych.config.orientation === 'landscape' ? 'portrait' : 'landscape';
        renderActiveDiptychUI();
        updateActiveTrayPreview();
    }

    function handleRotate(e) {
        const slot = e.target.closest('button').dataset.slot;
        const activeDiptych = appState.diptychs[appState.activeDiptychIndex];
        const imageKey = `image${slot}`;
        if (activeDiptych?.[imageKey]) {
            activeDiptych[imageKey].rotation = ((activeDiptych[imageKey].rotation || 0) + 90) % 360;
            updateActiveTrayPreview();
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
            updateActiveTrayPreview();
        }
    }

    function handleTrayClick(e) {
        if (e.target.closest('.delete-diptych-btn')) {
            const item = e.target.closest('.diptych-tray-item');
            if (item) deleteDiptych(parseInt(item.dataset.index, 10));
            return;
        }
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
        usedImagePool.innerHTML = '';
        const usedPaths = appState.diptychs.flatMap(d => [d.image1?.path, d.image2?.path]).filter(Boolean);
        const unusedImages = appState.images.filter(img => !usedPaths.includes(img.path));
        const usedImages = appState.images.filter(img => usedPaths.includes(img.path));
        unpairedCount.textContent = unusedImages.length;
        usedCount.textContent = usedImages.length;
        function createThumb(imgData) {
            const thumbContainer = document.createElement('div');
            thumbContainer.className = 'img-thumbnail thumbnail-loading';
            thumbContainer.dataset.path = imgData.path;
            const imgEl = document.createElement('img');
            // Provide alt text for accessibility.  Use the basename of the
            // uploaded file as a descriptive label so screen readers can
            // identify each image.  This also assists users with visual
            // impairments when navigating the image pool.
            const baseName = imgData.path.split(/[/\\]/).pop();
            imgEl.alt = baseName;
            imgEl.src = `/thumbnail/${encodeURIComponent(imgData.path)}`;
            imgEl.onload = () => { imgEl.classList.add('loaded'); thumbContainer.classList.remove('thumbnail-loading'); };
            imgEl.onerror = () => setTimeout(() => { imgEl.src = `/thumbnail/${encodeURIComponent(imgData.path)}?t=${Date.now()}` }, 1000);
            const filenameDiv = document.createElement('div');
            filenameDiv.className = 'filename';
            filenameDiv.textContent = imgData.path;
            thumbContainer.append(imgEl, filenameDiv);
            return thumbContainer;
        }
        unusedImages.forEach(imgData => imagePool.appendChild(createThumb(imgData)));
        usedImages.forEach(imgData => usedImagePool.appendChild(createThumb(imgData)));
        // Enable drag-and-drop reordering on the used image pool.  Destroy any previous
        // Sortable instance to avoid duplicates.
        if (appState.usedSortable) {
            try { appState.usedSortable.destroy(); } catch (err) {}
            appState.usedSortable = null;
        }
        if (typeof Sortable !== 'undefined' && usedImages.length > 1) {
            appState.usedSortable = new Sortable(usedImagePool, {
                animation: 150,
                onEnd: () => {
                    // Determine new order of used images based on DOM order
                    const newOrderPaths = Array.from(usedImagePool.querySelectorAll('.img-thumbnail')).map(el => el.dataset.path);
                    const newImages = [];
                    // Add used images in new order
                    newOrderPaths.forEach(path => {
                        const img = appState.images.find(i => i.path === path);
                        if (img) newImages.push(img);
                    });
                    // Append any remaining unused images preserving their order
                    appState.images.forEach(img => {
                        if (!newOrderPaths.includes(img.path)) {
                            newImages.push(img);
                        }
                    });
                    appState.images = newImages;
                    // Re-render image pools to reflect new order
                    renderImagePool();
                }
            });
        }
    }

    function renderActiveDiptychUI() {
        const activeDiptych = appState.diptychs[appState.activeDiptychIndex];
        if (!activeDiptych) return;
        const { config } = activeDiptych;
        updateCanvasAspectRatio(config);
        const sizeValue = `${config.width}x${config.height}`;
        outputSizeSelect.value = outputSizeSelect.querySelector(`option[value="${sizeValue}"]`) ? sizeValue : 'custom';
        customDimContainer.classList.toggle('hidden', outputSizeSelect.value !== 'custom');
        customWidthInput.value = config.width;
        customHeightInput.value = config.height;
        outputDpiSelect.value = config.dpi;
        imageFittingSelect.value = config.fit_mode;
        borderSizeSlider.value = config.gap;
        borderSizeValue.textContent = `${pxToMm(config.gap, config.dpi)} mm`;
        outerBorderSizeSlider.value = config.outer_border;
        outerBorderSizeValue.textContent = `${pxToMm(config.outer_border, config.dpi)} mm`;
        borderColorInput.value = config.border_color;
        // Sync crop focus selectors with the configuration
        if (cropFocusHSelect && cropFocusVSelect && Array.isArray(config.crop_focus)) {
            cropFocusHSelect.value = String(config.crop_focus[0]);
            cropFocusVSelect.value = String(config.crop_focus[1]);
        }
        // Sync preview background with current border color
        previewImage.style.backgroundColor = config.border_color;
        mainCanvas.style.backgroundColor = config.border_color;
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
            const delBtn = document.createElement('div');
            delBtn.className = 'delete-diptych-btn';
            delBtn.innerHTML = `<svg fill="currentColor" height="12" viewBox="0 0 256 256" width="12"><path d="M208.49,191.51a12,12,0,0,1-17,17L128,145,64.49,208.49a12,12,0,0,1-17-17L111,128,47.51,64.49a12,12,0,0,1,17-17L128,111l63.51-63.51a12,12,0,0,1,17,17L145,128Z"></path></svg>`;
            item.append(preview, number, delBtn);
            diptychTray.appendChild(item);
            updateTrayPreview(preview, diptych);
        });
        const addButton = document.createElement('div');
        addButton.className = 'add-diptych-btn';
        addButton.innerHTML = `<svg fill="currentColor" height="24" viewBox="0 0 256 256" width="24"><path d="M224,128a8,8,0,0,1-8,8H136v80a8,8,0,0,1-16,0V136H40a8,8,0,0,1,0-16h80V40a8,8,0,0,1,16,0v80h80A8,8,0,0,1,224,128Z"></path></svg>`;
        diptychTray.appendChild(addButton);
    }

    function updateActiveTrayPreview() {
        const item = diptychTray.querySelectorAll('.diptych-tray-item')[appState.activeDiptychIndex];
        if (item) {
            const preview = item.querySelector('.diptych-tray-preview');
            if (preview) updateTrayPreview(preview, appState.diptychs[appState.activeDiptychIndex]);
        }
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
        // Ensure preview background matches outer border color
        previewImage.style.backgroundColor = activeDiptych.config.border_color;
        mainCanvas.style.backgroundColor = activeDiptych.config.border_color;
        try {
            mainCanvas.classList.add('preview-loading');
            // Create a deep copy of the diptych and attach crop_focus to each image
            const diptychPayload = JSON.parse(JSON.stringify(activeDiptych));
            if (diptychPayload.image1) diptychPayload.image1.crop_focus = activeDiptych.config.crop_focus;
            if (diptychPayload.image2) diptychPayload.image2.crop_focus = activeDiptych.config.crop_focus;
            const response = await fetch('/get_wysiwyg_preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ diptych: diptychPayload })
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
            // Include crop_focus in payload
            const diptychPayload = JSON.parse(JSON.stringify(diptych));
            if (diptychPayload.image1) diptychPayload.image1.crop_focus = diptych.config.crop_focus;
            if (diptychPayload.image2) diptychPayload.image2.crop_focus = diptych.config.crop_focus;
            const response = await fetch('/get_wysiwyg_preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ diptych: diptychPayload })
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
        // Track if we're currently dragging
        let isDragging = false;
        // Handle drag events for thumbnails
        document.addEventListener('dragstart', (e) => {
            const thumbnail = e.target.closest('.img-thumbnail');
            if (thumbnail) {
                isDragging = true;
                e.dataTransfer.setData('text/plain', thumbnail.dataset.path);
                e.dataTransfer.effectAllowed = 'move';
                dropZones.forEach(z => z.classList.add('drag-active'));
            }
        });
        document.addEventListener('dragend', () => {
            isDragging = false;
            dropZones.forEach(zone => {
                zone.classList.remove('drag-over');
                zone.classList.remove('drag-active');
            });
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
                zone.classList.remove('drag-active');
                const path = e.dataTransfer.getData('text/plain');
                const slot = zone.dataset.slot;
                const activeDiptych = appState.diptychs[appState.activeDiptychIndex];
                if (activeDiptych) {
                    const imageKey = `image${slot}`;
                    activeDiptych[imageKey] = { path };
                    renderImagePool();
                    renderActiveDiptychUI();
                    updateActiveTrayPreview();
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
            pairs: pairsToGenerate.map(d => {
                // Copy image objects and attach crop_focus to each
                const img1 = d.image1 ? { ...d.image1, crop_focus: d.config.crop_focus } : null;
                const img2 = d.image2 ? { ...d.image2, crop_focus: d.config.crop_focus } : null;
                return { pair: [img1, img2], config: d.config };
            }),
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
                // Check for server-side errors
                if (progress.error) {
                    clearInterval(progressInterval);
                    hideLoading();
                    alert(`Generation failed: ${progress.error}`);
                    appState.isGenerating = false;
                    return;
                }
                const percent = progress.total > 0 ? (progress.processed / progress.total) * 100 : 0;
                const current = Math.min(progress.processed + 1, progress.total);
                updateLoadingProgress(percent, `Generating diptych ${current} of ${progress.total}...`);
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
        // Update ARIA attribute on progress bar so screen readers can
        // announce the current progress value.  Round to the nearest
        // integer for clarity.
        progressBar.setAttribute('aria-valuenow', Math.round(percent));
        loadingOverlay.classList.remove('hidden');
    }
    function updateLoadingProgress(percent, text) {
        progressText.textContent = text;
        progressBar.style.width = `${percent}%`;
        progressBar.setAttribute('aria-valuenow', Math.round(percent));
    }
    function hideLoading() {
        loadingOverlay.classList.add('hidden');
    }

    return { init };
})();

document.addEventListener('DOMContentLoaded', () => DiptychApp.init());