// review_app/static/js/app.js

const DiptychApp = (() => {
    // --- STATE MANAGEMENT ---
    let appState = {
        images: [],
        selectedImagePath: null,
        measurementUnit: 'in',
        framing: null,
        diptychs: [],
        activeDiptychIndex: 0,
        previewDebounceTimer: null,
        previewRequestSeq: 0,
        isGenerating: false,
        // Holds the Sortable instance for used images; allows us to destroy
        // the instance before creating a new one when the pool is re-rendered.
        usedSortable: null,
        // Sortable instance for the diptych tray so pairs can be reordered
        traySortable: null,
    };
    const PREVIEW_DEBOUNCE_DELAY = 300;
    const history = EditHistory.create();
    let historyReady = false;
    let editGesture = 0;
    const snapshot = () => JSON.parse(JSON.stringify({diptychs: appState.diptychs, activeDiptychIndex: appState.activeDiptychIndex}));
    function recordEdit(before, label, group = null) {
        if (historyReady) history.record(before, snapshot(), label, group);
        updateHistoryControls();
    }
    function updateHistoryControls() {
        for (const action of ['undo', 'redo']) {
            const button = document.getElementById(`${action}-btn`);
            const label = history[`${action}Label`];
            button.disabled = !label;
            button.title = label ? `${action === 'undo' ? 'Undo' : 'Redo'}: ${label}` : `Nothing to ${action}`;
        }
    }
    function restoreEdit(action) {
        if (framingDialog.open || !loadingOverlay.classList.contains('hidden')) return;
        const restored = history[action]();
        if (!restored) return;
        Object.assign(appState, restored, {selectedImagePath: null});
        appState.previewRequestSeq++;
        renderImagePool(); renderDiptychTray(); renderActiveDiptychUI();
        requestPreviewRefresh(); persistDiptychOrder(); saveSettings(); updateHistoryControls();
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
    const unitSelect = document.getElementById('measurement-unit');
    const framingDialog = document.getElementById('framing-dialog');
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
    const tabImagesBtn = document.getElementById('tab-images');
    const tabSettingsBtn = document.getElementById('tab-settings');
    const statusBanner = document.getElementById('status-banner');
    const statusMessage = document.getElementById('status-message');
    const statusCloseBtn = document.getElementById('status-close');
    // --- INITIALIZATION ---
    function init() {
        addEventListeners();
        addNewDiptych();
        loadSavedSettings();
        initializeDragAndDrop();
        updateMobileMenuIcon();
        initializeFraming();
        historyReady = true;
        updateHistoryControls();
        const canvasSizer = new ResizeObserver(fitCanvasToWorkspace);
        canvasSizer.observe(document.getElementById('preview-panel'));
        canvasSizer.observe(document.querySelector('.workspace-heading'));
    }

    // --- EVENT LISTENERS ---
    function addEventListeners() {
        [selectImagesBtn, uploadMoreBtn, uploadLabel].forEach(el => el.addEventListener('click', () => fileUploader.click()));
        ['undo', 'redo'].forEach(action => document.getElementById(`${action}-btn`).addEventListener('click', () => restoreEdit(action)));
        document.addEventListener('focusin', () => editGesture++);
        document.addEventListener('keydown', event => {
            if (!(event.ctrlKey || event.metaKey) || event.altKey || event.target.closest('input, textarea, select, [contenteditable="true"]') || framingDialog.open) return;
            const key = event.key.toLowerCase();
            if (key === 'z' || key === 'y') {
                event.preventDefault();
                restoreEdit(key === 'y' || event.shiftKey ? 'redo' : 'undo');
            }
        });
        fileUploader.addEventListener('change', handleFileUpload);
        downloadBtn.addEventListener('click', generateDiptychs);
        autoPairBtn.addEventListener('click', autoPairImages);
        document.getElementById('tab-preview').addEventListener('click', () => toggleMobileTab('preview'));
        document.addEventListener('keydown', e => { if (e.key === 'Escape') toggleMobileTab('preview'); });
        document.querySelectorAll('.drop-zone').forEach(zone => zone.addEventListener('click', () => {
            const placed = appState.diptychs[appState.activeDiptychIndex]?.[`image${zone.dataset.slot}`];
            if (placed && !appState.selectedImagePath) openFraming(zone.dataset.slot);
            else placeImage(appState.selectedImagePath, zone.dataset.slot);
        }));
        outputSizeSelect.addEventListener('change', handleOutputSizeChange);
        unitSelect.addEventListener('change', handleUnitChange);
        orientationBtn.addEventListener('click', toggleOrientation);
        [customWidthInput, customHeightInput].forEach(el => el.addEventListener('input', handleConfigChange));
        outputDpiSelect.addEventListener('change', handleConfigChange);
        imageFittingSelect.addEventListener('change', handleConfigChange);
        borderSizeSlider.addEventListener('input', handleConfigChange);
        outerBorderSizeSlider.addEventListener('input', handleConfigChange);
        borderColorInput.addEventListener('input', handleConfigChange);

        document.addEventListener('click', (e) => {
            if (e.target.closest('.btn-frame')) openFraming(e.target.closest('.btn-frame').dataset.slot);
            if (e.target.closest('.btn-rotate')) handleRotate(e);
            if (e.target.closest('.btn-remove')) handleRemove(e);
        });
        diptychTray.addEventListener('click', handleTrayClick);
        document.getElementById('scroll-left-btn').addEventListener('click', () => scrollTray(-200));
        document.getElementById('scroll-right-btn').addEventListener('click', () => scrollTray(200));
        if (tabImagesBtn && tabSettingsBtn) {
            tabImagesBtn.addEventListener('click', () => toggleMobileTab('images'));
            tabSettingsBtn.addEventListener('click', () => toggleMobileTab('settings'));
        }
        if (statusCloseBtn) {
            statusCloseBtn.addEventListener('click', () => hideStatus());
        }
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
        mainCanvas.style.setProperty("--canvas-ratio", w / h);
        canvasGrid.style.gridTemplateColumns = config.orientation === "portrait" ? "1fr" : "1fr 1fr";
        canvasGrid.style.gridTemplateRows = config.orientation === "portrait" ? "1fr 1fr" : "1fr";
        fitCanvasToWorkspace();
    }

    function fitCanvasToWorkspace() {
        const panel = document.getElementById('preview-panel');
        if (window.innerWidth < 900 || !panel.clientHeight) return;
        const style = getComputedStyle(panel);
        let height = panel.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
        for (const element of [panel.querySelector('.workspace-heading'), panel.querySelector('p.mt-4')]) {
            const childStyle = getComputedStyle(element);
            height -= element.getBoundingClientRect().height + (parseFloat(childStyle.marginTop) || 0) + (parseFloat(childStyle.marginBottom) || 0);
        }
        mainCanvas.style.setProperty('--available-canvas-height', `${Math.max(60, height)}px`);
    }

    function updateMobileMenuIcon() {} // Retained for existing initialization calls.

    function toggleMobileTab(which) {
        appContainer.dataset.view = which;
        ['images', 'settings', 'preview'].forEach(view => {
            const button = document.getElementById(`tab-${view}`);
            button.classList.toggle('mobile-tab-active', view === which);
            button.setAttribute('aria-pressed', String(view === which));
        });
    }

    function placeImage(path, slot) {
        if (!path) {
            showStatus('Select an image from Available or Placed, then choose a slot.');
            toggleMobileTab('images');
            return;
        }
        if (!appState.images.some(image => image.path === path)) return;
        const active = appState.diptychs[appState.activeDiptychIndex];
        const before = snapshot();
        const previousImage = appState.diptychs.flatMap(pair => [pair.image1, pair.image2]).find(image => image?.path === path);
        removeImageFromDiptychs(path);
        active[`image${slot}`] = { ...previousImage, path, auto_rotate: false };
        appState.selectedImagePath = null;
        document.getElementById('placement-hint').textContent = 'Select an image, then click a slot. You can also drag images.';
        renderImagePool();
        renderDiptychTray();
        renderActiveDiptychUI();
        requestPreviewRefresh();
        toggleMobileTab('preview');
        recordEdit(before, 'Place photo');
        persistDiptychOrder();
    }

    async function handleFileUpload(event) {
        const files = event.target.files;
        if (!files.length) return;
        hideStatus();
        showLoading('Uploading images...');
        const formData = new FormData();
        Array.from(files).forEach(file => formData.append('files[]', file));
        try {
            const response = await fetch('/upload_images', { method: 'POST', body: formData });
            const result = await response.json().catch(() => ({}));
            if (!response.ok && !(result.uploaded || []).length) {
                throw new Error(result.error || 'No readable images found. Choose JPEG, PNG, WebP or TIFF files.');
            }
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
                showStatus(`Some files were not uploaded: ${invalidNames.join(', ')}`, 'warning');
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
            showStatus(`Upload failed: ${error.message}`, 'error');
        } finally {
            hideLoading();
            event.target.value = null;
        }
    }

    function addNewDiptych(andSwitch = true) {
        const before = snapshot();
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
        if (andSwitch) { renderActiveDiptychUI(); requestPreviewRefresh(); }
        persistDiptychOrder();
        recordEdit(before, 'Add pair');
    }

    function switchActiveDiptych(index) {
        if (index >= 0 && index < appState.diptychs.length) {
            appState.activeDiptychIndex = index;
            renderDiptychTray();
            renderActiveDiptychUI();
            requestPreviewRefresh();
        }
    }

    function deleteDiptych(index) {
        if (appState.diptychs.length <= 1) return;
        if (index >= 0 && index < appState.diptychs.length) {
            const before = snapshot();
            appState.diptychs.splice(index, 1);
            if (index < appState.activeDiptychIndex) appState.activeDiptychIndex--;
            if (appState.activeDiptychIndex >= appState.diptychs.length) {
                appState.activeDiptychIndex = appState.diptychs.length - 1;
            }
            renderDiptychTray();
            renderImagePool();
            renderActiveDiptychUI();
            requestPreviewRefresh();
            persistDiptychOrder();
            recordEdit(before, 'Delete pair');
        }
    }

    async function autoPairImages() {
        if (appState.images.length === 0) return;
        const before = snapshot();
        showLoading('Pairing images...');
        try {
            const baseConfig = appState.diptychs.length > 0
                ? { ...appState.diptychs[appState.activeDiptychIndex].config }
                : { fit_mode: 'fit', gap: 20, width: 6, height: 4, orientation: 'landscape', dpi: 300, outer_border: 20, border_color: '#ffffff' };
            // Determine grouping method from the selector.  Defaults to chronological.
            const method = groupingMethodSelect ? groupingMethodSelect.value : 'chronological';
            const response = await fetch('/auto_group', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method, files: appState.images.map(image => image.path) }) });
            if (!response.ok) throw new Error('Auto grouping failed');
            const data = await response.json();
            appState.diptychs = EditHistory.pair(data.pairs, appState.diptychs, baseConfig);
            if (appState.diptychs.length === 0) addNewDiptych();
            appState.activeDiptychIndex = 0;
            renderDiptychTray();
            renderImagePool();
            renderActiveDiptychUI();
            requestPreviewRefresh();
            persistDiptychOrder();
            recordEdit(before, 'Auto Pair');
        } catch (err) {
            showStatus(`Auto pairing failed: ${err.message}`, 'error');
        } finally {
            hideLoading();
        }
    }


    function migrateMeasurements(config) {
        config.gap_inches ??= (config.gap || 0) / config.dpi;
        config.outer_border_inches ??= (config.outer_border || 0) / config.dpi;
    }

    function handleUnitChange() {
        if (!validateVisibleLengths()) {
            unitSelect.value = appState.measurementUnit;
            return;
        }
        appState.measurementUnit = unitSelect.value;
        renderActiveDiptychUI();
        saveSettings();
    }

    function handleOutputSizeChange() {
        if (outputSizeSelect.value === 'custom') {
            customWidthInput.focus();
            return;
        }
        const before = snapshot();
        const config = appState.diptychs[appState.activeDiptychIndex].config;
        [config.width, config.height] = outputSizeSelect.value.split('x').map(Number);
        if (config.width === config.height) config.orientation = 'landscape';
        renderActiveDiptychUI();
        handleConfigChange(undefined, before);
    }

    function saveSettings() {
        try {
            const config = appState.diptychs[appState.activeDiptychIndex]?.config;
            if (!config) return;
            localStorage.setItem('diptychSettings', JSON.stringify({ version: 2, unit: appState.measurementUnit, config }));
        } catch (err) { console.warn('Failed to save settings', err); }
    }

    function loadSavedSettings() {
        try {
            const settings = JSON.parse(localStorage.getItem('diptychSettings') || 'null');
            if (!settings) return;
            const active = appState.diptychs[appState.activeDiptychIndex];
            if (settings.version === 2 && settings.config) {
                active.config = { ...active.config, ...settings.config };
                appState.measurementUnit = ['mm', 'in', 'px'].includes(settings.unit) ? settings.unit : 'in';
            } else {
                // Migrate the original inch dimensions / pixel spacing preference.
                const dimensions = settings.outputSize === 'custom' ? [Number(settings.customWidth), Number(settings.customHeight)] : (settings.outputSize || '6x4').split('x').map(Number);
                if (dimensions.every(value => value > 0 && Number.isFinite(value))) [active.config.width, active.config.height] = dimensions;
                active.config.dpi = Number(settings.dpi) || 300;
                active.config.orientation = settings.orientation || 'landscape';
                active.config.gap = settings.border ?? 20;
                active.config.outer_border = settings.outerBorder ?? 20;
                active.config.fit_mode = settings.fitMode || 'fit';
                active.config.border_color = settings.borderColor || '#ffffff';
                active.config.crop_focus = settings.cropFocus || [0.5, 0.5];
            }
            migrateMeasurements(active.config);
            renderActiveDiptychUI();
        } catch (err) { console.warn('Failed to load settings', err); }
    }

    function visibleLengths(dpi = Number(outputDpiSelect.value)) {
        const unit = appState.measurementUnit;
        return [customWidthInput, customHeightInput, borderSizeSlider, outerBorderSizeSlider].map(input => Measurements.toInches(input.value || NaN, unit, dpi));
    }

    function validateVisibleLengths() {
        const lengths = visibleLengths();
        const error = Measurements.validate(...lengths, Number(outputDpiSelect.value));
        const message = document.getElementById('dimension-error');
        message.textContent = error;
        message.classList.toggle('hidden', !error);
        [customWidthInput, customHeightInput, borderSizeSlider, outerBorderSizeSlider].forEach(input => input.setAttribute('aria-invalid', String(Boolean(error))));
        return !error;
    }

    function handleConfigChange(event, previous) {
        const active = appState.diptychs[appState.activeDiptychIndex];
        if (!active || !validateVisibleLengths()) return;
        const before = previous || snapshot();
        const config = active.config;
        migrateMeasurements(config);
        const target = event?.target;
        const dpi = Number(outputDpiSelect.value);
        const [width, height, gap, border] = visibleLengths(dpi);
        const pixelDpiChange = target === outputDpiSelect && appState.measurementUnit === 'px';
        if (target === customWidthInput || target === customHeightInput || pixelDpiChange) {
            config.width = Math.max(width, height);
            config.height = Math.min(width, height);
            config.orientation = width < height ? 'portrait' : 'landscape';
            if (!pixelDpiChange) outputSizeSelect.value = 'custom';
        }
        if (target === borderSizeSlider || pixelDpiChange) config.gap_inches = gap;
        if (target === outerBorderSizeSlider || pixelDpiChange) config.outer_border_inches = border;
        config.dpi = dpi;
        config.gap = Math.round(config.gap_inches * dpi);
        config.outer_border = Math.round(config.outer_border_inches * dpi);
        config.fit_mode = imageFittingSelect.value;
        config.border_color = borderColorInput.value;
        renderActiveDiptychUI(Boolean(target && [customWidthInput, customHeightInput, borderSizeSlider, outerBorderSizeSlider].includes(target)));
        updateActiveTrayPreview();
        requestPreviewRefresh();
        saveSettings();
        recordEdit(before, 'Change layout', event?.type === 'input' ? `${target.id}:${editGesture}` : null);
    }

    function serializeDiptych(diptych) {
        const payload = JSON.parse(JSON.stringify(diptych));
        [payload.image1, payload.image2].filter(Boolean).forEach(image => {
            image.crop_focus ??= diptych.config.crop_focus || [0.5, 0.5];
            image.auto_rotate = false;
        });
        return payload;
    }

    function toggleOrientation() {
        const activeDiptych = appState.diptychs[appState.activeDiptychIndex];
        if (!activeDiptych || !validateVisibleLengths()) return;
        const before = snapshot();
        activeDiptych.config.orientation = activeDiptych.config.orientation === 'landscape' ? 'portrait' : 'landscape';
        renderActiveDiptychUI();
        updateActiveTrayPreview();
        requestPreviewRefresh();
        saveSettings();
        recordEdit(before, 'Change orientation');
    }

    function handleRotate(e) {
        const slot = e.target.closest('button').dataset.slot;
        const activeDiptych = appState.diptychs[appState.activeDiptychIndex];
        const imageKey = `image${slot}`;
        if (activeDiptych?.[imageKey]) {
            const before = snapshot();
            activeDiptych[imageKey].rotation = ((activeDiptych[imageKey].rotation || 0) + 90) % 360;
            activeDiptych[imageKey].auto_rotate = false;
            renderActiveDiptychUI();
            updateActiveTrayPreview();
            requestPreviewRefresh();
            recordEdit(before, 'Rotate photo');
        }
    }

    function handleRemove(e) {
        const slot = e.target.closest('button').dataset.slot;
        const activeDiptych = appState.diptychs[appState.activeDiptychIndex];
        const imageKey = `image${slot}`;
        if (activeDiptych?.[imageKey]) {
            const before = snapshot();
            activeDiptych[imageKey] = null;
            renderImagePool();
            renderActiveDiptychUI();
            updateActiveTrayPreview();
            requestPreviewRefresh();
            recordEdit(before, 'Remove photo');
        }
    }

    // Remove an image path from all diptychs. Used when dragging an image
    // to a new slot so it acts like a move instead of a copy.
    function removeImageFromDiptychs(path) {
        appState.diptychs.forEach((d, i) => {
            if (d.image1 && d.image1.path === path) {
                d.image1 = null;
                if (i === appState.activeDiptychIndex) updateActiveTrayPreview();
            }
            if (d.image2 && d.image2.path === path) {
                d.image2 = null;
                if (i === appState.activeDiptychIndex) updateActiveTrayPreview();
            }
        });
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
        diptychTray.scrollBy({ left: amount, behavior: 'smooth' });
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
            const thumbContainer = document.createElement('button');
            thumbContainer.type = 'button';
            thumbContainer.draggable = true;
            thumbContainer.setAttribute('aria-label', `Select ${imgData.path}`);
            thumbContainer.setAttribute('aria-pressed', String(appState.selectedImagePath === imgData.path));
            thumbContainer.title = imgData.path;
            thumbContainer.addEventListener('click', () => {
                appState.selectedImagePath = imgData.path;
                renderImagePool();
                renderActiveDiptychUI(true);
                document.getElementById('placement-hint').textContent = `Selected ${imgData.path}. Choose slot 1 or 2 to place it.`;
                toggleMobileTab('preview');
            });
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
        if (!unusedImages.length) imagePool.innerHTML = '<p class="pool-empty">All images are placed. Upload more or select a placed image to move it.</p>';
        document.getElementById('used-images-section').classList.toggle('hidden', !usedImages.length);
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

    function renderActiveDiptychUI(preserveCustom = false) {
        const activeDiptych = appState.diptychs[appState.activeDiptychIndex];
        if (!activeDiptych) return;
        const { config } = activeDiptych;
        document.getElementById('pair-heading').textContent = `Pair ${appState.activeDiptychIndex + 1} of ${appState.diptychs.length}`;
        migrateMeasurements(config);
        const [outputWidth, outputHeight] = Measurements.outputSize(config);
        const unit = appState.measurementUnit;
        const pixelSummary = `${Math.floor(outputWidth * config.dpi)} × ${Math.floor(outputHeight * config.dpi)} px`;
        document.getElementById('output-summary').textContent = unit === 'px' ? `${pixelSummary} · ${config.dpi} DPI` : `${Measurements.display(outputWidth, unit, config.dpi)} × ${Measurements.display(outputHeight, unit, config.dpi)} ${unit} · ${pixelSummary}`;
        document.getElementById('resolution-help').textContent = unit === 'px' ? 'DPI changes print size; pixel dimensions stay fixed.' : 'DPI changes pixel resolution; print dimensions and spacing stay fixed.';
        unitSelect.value = unit;
        document.querySelectorAll('.length-unit').forEach(label => label.textContent = unit);
        customWidthInput.setAttribute('aria-label', `Output width (${unit})`);
        customHeightInput.setAttribute('aria-label', `Output height (${unit})`);
        [customWidthInput, customHeightInput, borderSizeSlider, outerBorderSizeSlider].forEach(input => { input.step = 'any'; input.min = input === borderSizeSlider || input === outerBorderSizeSlider ? '0' : unit === 'px' ? '2' : '0.01'; });
        for (const option of outputSizeSelect.options) {
            if (option.value === 'custom') continue;
            const [w, h] = option.value.split('x').map(Number);
            option.textContent = `${Measurements.display(w, unit, config.dpi)} × ${Measurements.display(h, unit, config.dpi)} ${unit}${w === h ? ' (square)' : ''}`;
        }
        document.querySelectorAll('.drop-zone').forEach(zone => {
            const filled = Boolean(activeDiptych[`image${zone.dataset.slot}`]);
            zone.classList.toggle('slot-filled', filled);
            zone.setAttribute('aria-label', filled && !appState.selectedImagePath ? `Adjust photo ${zone.dataset.slot} in preview` : `${filled ? 'Replace' : 'Place selected image in'} slot ${zone.dataset.slot}`);
            zone.querySelector('span > span').textContent = filled ? (appState.selectedImagePath ? 'Click to replace this photo' : 'Click to crop, position or resize') : 'Select an image, then place it here';
        });
        updateCanvasAspectRatio(config);
        const preset = Array.from(outputSizeSelect.options).find(option => {
            const [w, h] = option.value.split('x').map(Number);
            return Math.abs(w - config.width) < 0.00001 && Math.abs(h - config.height) < 0.00001;
        });
        if (!preserveCustom) {
            outputSizeSelect.value = preset ? preset.value : 'custom';
            customWidthInput.value = Measurements.display(outputWidth, unit, config.dpi);
            customHeightInput.value = Measurements.display(outputHeight, unit, config.dpi);
            borderSizeSlider.value = Measurements.display(config.gap_inches, unit, config.dpi);
            outerBorderSizeSlider.value = Measurements.display(config.outer_border_inches, unit, config.dpi);
            document.getElementById('dimension-error').classList.add('hidden');
            [customWidthInput, customHeightInput, borderSizeSlider, outerBorderSizeSlider].forEach(input => input.setAttribute('aria-invalid', 'false'));
        }
        customDimContainer.classList.remove('hidden');
        outputDpiSelect.value = config.dpi;
        imageFittingSelect.value = config.fit_mode;
        borderSizeSlider.setAttribute('aria-label', `Space between photos (${unit})`);
        outerBorderSizeSlider.setAttribute('aria-label', `Outer border (${unit})`);
        borderSizeValue.textContent = unit;
        outerBorderSizeValue.textContent = unit;
        borderColorInput.value = config.border_color;
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
        if (!appState.selectedImagePath) document.getElementById('placement-hint').textContent = activeDiptych.image1 || activeDiptych.image2 ? 'Click a photo to adjust it. Select an image from the library to replace it.' : 'Select an image, then click a slot. You can also drag images.';
        document.getElementById('image-1-controls').classList.toggle('hidden', !activeDiptych.image1);
        document.getElementById('image-2-controls').classList.toggle('hidden', !activeDiptych.image2);
        [1, 2].forEach(slot => {
            const image = activeDiptych[`image${slot}`];
            if (!image) return;
            document.getElementById(`image-${slot}-name`).textContent = image.path;
            document.getElementById(`image-${slot}-summary`).textContent = `${(image.fit_mode || config.fit_mode) === 'fill' ? 'Fill' : 'Fit'} · ${Math.round((image.zoom || 1) * 100)}% · ${image.rotation || 0}°`;
        });
    }

    function renderDiptychTray() {
        diptychTray.innerHTML = '';
        appState.diptychs.forEach((diptych, index) => {
            const item = document.createElement('div');
            item.className = 'diptych-tray-item';
            item.dataset.index = index;
            const preview = document.createElement('button');
            preview.type = 'button';
            preview.setAttribute('aria-label', `Edit pair ${index + 1}`);
            preview.setAttribute('aria-pressed', String(index === appState.activeDiptychIndex));
            preview.className = 'diptych-tray-preview';
            if (index === appState.activeDiptychIndex) preview.classList.add('active');
            const number = document.createElement('span');
            number.className = 'diptych-tray-number';
            number.textContent = index + 1;
            const delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.setAttribute('aria-label', `Delete pair ${index + 1}`);
            delBtn.disabled = appState.diptychs.length === 1;
            delBtn.className = 'delete-diptych-btn';
            delBtn.innerHTML = `<svg fill="currentColor" height="12" viewBox="0 0 256 256" width="12"><path d="M208.49,191.51a12,12,0,0,1-17,17L128,145,64.49,208.49a12,12,0,0,1-17-17L111,128,47.51,64.49a12,12,0,0,1,17-17L128,111l63.51-63.51a12,12,0,0,1,17,17L145,128Z"></path></svg>`;
            item.append(preview, number, delBtn);
            diptychTray.appendChild(item);
            updateTrayPreview(preview, diptych);
        });
        const addButton = document.createElement('button');
        addButton.type = 'button';
        addButton.setAttribute('aria-label', 'Add pair');
        addButton.className = 'add-diptych-btn';
        addButton.innerHTML = `Add pair <svg fill="currentColor" height="24" viewBox="0 0 256 256" width="24"><path d="M224,128a8,8,0,0,1-8,8H136v80a8,8,0,0,1-16,0V136H40a8,8,0,0,1,0-16h80V40a8,8,0,0,1,16,0v80h80A8,8,0,0,1,224,128Z"></path></svg>`;
        diptychTray.appendChild(addButton);

        // Enable drag-and-drop reordering of diptychs
        if (appState.traySortable) {
            try { appState.traySortable.destroy(); } catch (err) {}
            appState.traySortable = null;
        }
        const trayItems = diptychTray.querySelectorAll('.diptych-tray-item');
        if (typeof Sortable !== 'undefined' && trayItems.length > 1) {
            appState.traySortable = new Sortable(diptychTray, {
                animation: 150,
                filter: '.add-diptych-btn',
                onEnd: () => {
                    const before = snapshot();
                    const order = Array.from(diptychTray.querySelectorAll('.diptych-tray-item'))
                        .map(el => parseInt(el.dataset.index, 10));
                    const newDiptychs = order.map(i => appState.diptychs[i]);
                    const newActive = order.indexOf(appState.activeDiptychIndex);
                    appState.diptychs = newDiptychs;
                    if (newActive !== -1) appState.activeDiptychIndex = newActive;
                    renderDiptychTray();
                    renderActiveDiptychUI();
                    recordEdit(before, 'Reorder pairs');
                    persistDiptychOrder();
                }
            });
        }
    }

    function updateActiveTrayPreview() {
        const item = diptychTray.querySelectorAll('.diptych-tray-item')[appState.activeDiptychIndex];
        if (item) {
            const preview = item.querySelector('.diptych-tray-preview');
            if (preview) updateTrayPreview(preview, appState.diptychs[appState.activeDiptychIndex]);
        }
    }

    async function persistDiptychOrder() {
        try {
            const order = appState.diptychs.map(d => ({
                image1: d.image1 ? d.image1.path : null,
                image2: d.image2 ? d.image2.path : null,
            }));
            await fetch('/update_diptych_order', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ order })
            });
        } catch (err) {
            console.error('Failed to persist diptych order:', err);
        }
    }

    // --- WYSIWYG PREVIEW SYSTEM ---
    function requestPreviewRefresh() {
        clearTimeout(appState.previewDebounceTimer);
        appState.previewDebounceTimer = setTimeout(refreshWysiwygPreview, PREVIEW_DEBOUNCE_DELAY);
    }

    function showLowResPreview(diptych) {
        const container = document.getElementById('lowres-preview');
        const img1 = document.getElementById('lowres-img1');
        const img2 = document.getElementById('lowres-img2');
        if (!diptych) return;
        container.classList.remove('hidden');
        container.classList.toggle('portrait', diptych.config.orientation === 'portrait');
        container.classList.toggle('landscape', diptych.config.orientation !== 'portrait');
        container.style.backgroundColor = diptych.config.border_color;
        if (diptych.image1) {
            img1.src = `/thumbnail/${encodeURIComponent(diptych.image1.path)}`;
            img1.classList.remove('hidden');
        } else {
            img1.classList.add('hidden');
            img1.removeAttribute('src');
        }
        if (diptych.image2) {
            img2.src = `/thumbnail/${encodeURIComponent(diptych.image2.path)}`;
            img2.classList.remove('hidden');
        } else {
            img2.classList.add('hidden');
            img2.removeAttribute('src');
        }
    }

    function hideLowResPreview() {
        const container = document.getElementById('lowres-preview');
        container.classList.add('hidden');
    }

    async function refreshWysiwygPreview() {
        const requestSeq = ++appState.previewRequestSeq;
        const activeDiptych = appState.diptychs[appState.activeDiptychIndex];
        if (!activeDiptych || (!activeDiptych.image1 && !activeDiptych.image2)) {
            previewImage.classList.add('hidden');
            mainCanvas.classList.remove('preview-loading');
            hideLowResPreview();
            return;
        }
        // Ensure preview background matches outer border color
        previewImage.style.backgroundColor = activeDiptych.config.border_color;
        mainCanvas.style.backgroundColor = activeDiptych.config.border_color;
        showLowResPreview(activeDiptych);
        try {
            mainCanvas.classList.add('preview-loading');
            // Create a deep copy of the diptych and attach crop_focus to each image
            const diptychPayload = serializeDiptych(activeDiptych);
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
            if (requestSeq !== appState.previewRequestSeq) {
                URL.revokeObjectURL(imageUrl);
                return;
            }
            previewImage.onload = () => {
                if (requestSeq !== appState.previewRequestSeq) {
                    URL.revokeObjectURL(imageUrl);
                    return;
                }
                previewImage.classList.remove('hidden');
                mainCanvas.classList.remove('preview-loading');
                hideLowResPreview();
                URL.revokeObjectURL(imageUrl);
            };
            previewImage.src = imageUrl;
        } catch (error) {
            if (requestSeq !== appState.previewRequestSeq) return;
            console.error('Preview generation failed:', error);
            showStatus('Preview could not be rendered. Change a layout setting to retry.', 'error');
            previewImage.classList.add('hidden');
            mainCanvas.classList.remove('preview-loading');
            hideLowResPreview();
        }
    }

    async function updateTrayPreview(element, diptych) {
        if (element && diptych) {
            element.classList.toggle('portrait', diptych.config.orientation === 'portrait');
            element.classList.toggle('landscape', diptych.config.orientation !== 'portrait');
            element.textContent = !diptych.image1 && !diptych.image2 ? 'Empty' : '';
        }
        if (!element || !diptych || (!diptych.image1 && !diptych.image2)) {
            revokeTrayPreviewUrl(element);
            if(element) element.style.backgroundImage = 'none';
            return;
        }
        element.classList.toggle('portrait', diptych.config.orientation === 'portrait');
        element.classList.toggle('landscape', diptych.config.orientation !== 'portrait');
        try {
            // Include crop_focus in payload
            const diptychPayload = serializeDiptych(diptych);
            const response = await fetch('/get_wysiwyg_preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ diptych: diptychPayload })
            });
            if (response.ok) {
                const imageBlob = await response.blob();
                revokeTrayPreviewUrl(element);
                const objectUrl = URL.createObjectURL(imageBlob);
                element.dataset.objectUrl = objectUrl;
                element.style.backgroundImage = `url(${objectUrl})`;
            } else {
                revokeTrayPreviewUrl(element);
                element.style.backgroundImage = 'none';
            }
        } catch (error) {
            console.error("Tray preview failed:", error);
            revokeTrayPreviewUrl(element);
            element.style.backgroundImage = 'none';
        }
    }

    function revokeTrayPreviewUrl(element) {
        if (element?.dataset?.objectUrl) {
            URL.revokeObjectURL(element.dataset.objectUrl);
            delete element.dataset.objectUrl;
        }
    }

    // --- INDEPENDENT PHOTO FRAMING ---
    function initializeFraming() {
        const canvas = document.getElementById('framing-canvas');
        const close = () => framingDialog.close();
        ['framing-close', 'framing-cancel'].forEach(id => document.getElementById(id).addEventListener('click', close));
        framingDialog.addEventListener('close', () => {
            const trigger = appState.framing?.trigger;
            appState.framing = null;
            trigger?.focus();
        });
        document.getElementById('framing-mode').addEventListener('change', event => {
            const frame = appState.framing;
            frame.draft.fit_mode = event.target.value;
            frame.draft.zoom = 1;
            updateFraming();
        });
        ['zoom', 'x', 'y'].forEach(axis => document.getElementById(`framing-${axis}`).addEventListener('input', event => {
            const draft = appState.framing.draft;
            if (axis === 'zoom') draft.zoom = Number(event.target.value);
            else draft.crop_focus[axis === 'x' ? 0 : 1] = Number(event.target.value);
            updateFraming();
        }));
        document.getElementById('framing-rotate').addEventListener('click', () => {
            const frame = appState.framing;
            frame.draft.rotation = ((frame.draft.rotation || 0) + 90) % 360;
            frame.rotated = null;
            updateFraming();
        });
        document.getElementById('framing-reset').addEventListener('click', () => {
            Object.assign(appState.framing.draft, { rotation: 0, zoom: 1, crop_focus: [0.5, 0.5] });
            appState.framing.rotated = null;
            updateFraming();
        });
        document.getElementById('framing-apply').addEventListener('click', () => {
            const frame = appState.framing;
            if (!frame?.source || !frame.ready) return;
            const before = snapshot();
            frame.pair[`image${frame.slot}`] = { ...frame.draft, crop_focus: [...frame.draft.crop_focus], auto_rotate: false };
            framingDialog.close();
            recordEdit(before, 'Adjust photo framing');
            renderActiveDiptychUI();
            updateActiveTrayPreview();
            requestPreviewRefresh();
        });
        let drag = null;
        canvas.addEventListener('pointerdown', event => {
            const frame = appState.framing;
            if (!frame?.ready || event.button !== 0) return;
            canvas.focus();
            canvas.setPointerCapture(event.pointerId);
            drag = { x: event.clientX, y: event.clientY, focus: [...frame.draft.crop_focus] };
        });
        canvas.addEventListener('pointermove', event => {
            if (!drag || !appState.framing?.geometry) return;
            const frame = appState.framing;
            const geometry = frame.geometry;
            const rect = canvas.getBoundingClientRect();
            const dx = (event.clientX - drag.x) * canvas.width / rect.width;
            const dy = (event.clientY - drag.y) * canvas.height / rect.height;
            const rangeX = canvas.width - geometry.width;
            const rangeY = canvas.height - geometry.height;
            if (Math.abs(rangeX) > 0.5) frame.draft.crop_focus[0] = clamp(drag.focus[0] + dx / rangeX);
            if (Math.abs(rangeY) > 0.5) frame.draft.crop_focus[1] = clamp(drag.focus[1] + dy / rangeY);
            updateFraming();
        });
        ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(name => canvas.addEventListener(name, () => { drag = null; }));
        canvas.addEventListener('keydown', event => {
            const direction = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [1, -1], ArrowDown: [1, 1] }[event.key];
            if (!direction || !appState.framing?.geometry) return;
            event.preventDefault();
            const frame = appState.framing;
            const axis = direction[0];
            const range = axis === 0 ? canvas.width - frame.geometry.width : canvas.height - frame.geometry.height;
            if (Math.abs(range) > 0.5) frame.draft.crop_focus[axis] = clamp(frame.draft.crop_focus[axis] + direction[1] * (range > 0 ? 1 : -1) * (event.shiftKey ? 0.1 : 0.01));
            updateFraming();
        });
    }

    function clamp(value) { return Math.min(1, Math.max(0, value)); }

    function openFraming(slot) {
        if (!validateVisibleLengths()) {
            showStatus('Correct the output dimensions before adjusting a photo.', 'warning');
            return;
        }
        const pair = appState.diptychs[appState.activeDiptychIndex];
        const image = pair[`image${slot}`];
        if (!image) return;
        const frame = {
            pair, slot, source: new Image(), ready: false, rotated: null,
            trigger: document.querySelector(`.btn-frame[data-slot="${slot}"]`),
            draft: { ...image, rotation: image.rotation || 0, zoom: image.zoom || 1, fit_mode: image.fit_mode || pair.config.fit_mode, crop_focus: [...(image.crop_focus || pair.config.crop_focus || [0.5, 0.5])], auto_rotate: false }
        };
        appState.framing = frame;
        document.getElementById('framing-title').textContent = `Adjust photo ${slot}`;
        document.getElementById('framing-filename').textContent = image.path;
        document.getElementById('framing-error').classList.add('hidden');
        document.getElementById('framing-help').textContent = 'Loading photo…';
        framingDialog.showModal();
        updateFraming();
        frame.source.onload = () => {
            if (appState.framing !== frame) return;
            frame.ready = true;
            updateFraming();
        };
        frame.source.onerror = () => {
            if (appState.framing !== frame) return;
            document.getElementById('framing-error').textContent = 'Photo could not be loaded. Cancel and upload it again.';
            document.getElementById('framing-error').classList.remove('hidden');
            document.getElementById('framing-help').textContent = 'The photo is unavailable.';
        };
        frame.source.src = `/framing_source/${encodeURIComponent(image.path)}`;
    }

    function updateFraming() {
        const frame = appState.framing;
        if (!frame) return;
        const { draft, pair } = frame;
        const canvas = document.getElementById('framing-canvas');
        const config = pair.config;
        const [w, h] = Measurements.outputSize(config).map(value => Math.floor(value * config.dpi));
        const border = Math.round(Measurements.spacing(config, 'outer_border') * config.dpi);
        const gap = pair.image1 && pair.image2 ? Math.round(Measurements.spacing(config, 'gap') * config.dpi) : 0;
        const cellW = w >= h ? Math.floor((w - 2 * border - gap) / 2) : w - 2 * border;
        const cellH = w >= h ? h - 2 * border : Math.floor((h - 2 * border - gap) / 2);
        const ratio = cellW / cellH;
        canvas.width = Math.round(Math.min(650, 480 * ratio));
        canvas.height = Math.round(canvas.width / ratio);
        document.getElementById('framing-stage').style.aspectRatio = String(ratio);
        const context = canvas.getContext('2d');
        context.fillStyle = config.border_color;
        context.fillRect(0, 0, canvas.width, canvas.height);
        document.getElementById('framing-mode').value = draft.fit_mode;
        const zoom = document.getElementById('framing-zoom');
        zoom.min = draft.fit_mode === 'fit' ? '0.1' : '1';
        zoom.max = draft.fit_mode === 'fit' ? '1' : '4';
        draft.zoom = Math.min(Number(zoom.max), Math.max(Number(zoom.min), draft.zoom));
        zoom.value = draft.zoom;
        document.getElementById('framing-zoom-value').textContent = `${Math.round(draft.zoom * 100)}%`;
        document.getElementById('framing-size-help').textContent = draft.fit_mode === 'fill' ? '100% fills the frame. Zoom in to crop closer.' : '100% fits the whole photo. Reduce size to add space around it.';
        ['x', 'y'].forEach((axis, index) => {
            document.getElementById(`framing-${axis}`).value = draft.crop_focus[index];
            document.getElementById(`framing-${axis}-value`).textContent = `${Math.round(draft.crop_focus[index] * 100)}%`;
        });
        document.getElementById('framing-apply').disabled = !frame.ready;
        if (!frame.ready) return;
        document.getElementById('framing-help').textContent = 'Drag the photo to reposition it. Arrow keys move it precisely.';
        if (!frame.rotated) {
            const rotated = document.createElement('canvas');
            const swap = draft.rotation % 180 !== 0;
            rotated.width = swap ? frame.source.naturalHeight : frame.source.naturalWidth;
            rotated.height = swap ? frame.source.naturalWidth : frame.source.naturalHeight;
            const sourceContext = rotated.getContext('2d');
            sourceContext.translate(rotated.width / 2, rotated.height / 2);
            sourceContext.rotate(draft.rotation * Math.PI / 180);
            sourceContext.drawImage(frame.source, -frame.source.naturalWidth / 2, -frame.source.naturalHeight / 2);
            frame.rotated = rotated;
        }
        const source = frame.rotated;
        const scale = (draft.fit_mode === 'fill' ? Math.max : Math.min)(canvas.width / source.width, canvas.height / source.height) * draft.zoom;
        const width = source.width * scale, height = source.height * scale;
        frame.geometry = { width, height };
        context.drawImage(source, (canvas.width - width) * draft.crop_focus[0], (canvas.height - height) * draft.crop_focus[1], width, height);
        const xEnabled = Math.abs(canvas.width - width) > 0.5, yEnabled = Math.abs(canvas.height - height) > 0.5;
        document.getElementById('framing-x').disabled = !xEnabled;
        document.getElementById('framing-y').disabled = !yEnabled;
        canvas.classList.toggle('can-pan', xEnabled || yEnabled);
        // Frame guides do not appear in the exported image.
        context.strokeStyle = '#ffffff66';
        context.lineWidth = 1;
        for (const fraction of [1 / 3, 2 / 3]) {
            context.beginPath(); context.moveTo(canvas.width * fraction, 0); context.lineTo(canvas.width * fraction, canvas.height); context.stroke();
            context.beginPath(); context.moveTo(0, canvas.height * fraction); context.lineTo(canvas.width, canvas.height * fraction); context.stroke();
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
                placeImage(path, slot);
            });
        });
    }

    // --- FINAL GENERATION ---
    async function generateDiptychs() {
        if (appState.isGenerating) return;
        if (!validateVisibleLengths()) {
            showStatus('Correct the output dimensions, spacing or border before downloading.', 'warning');
            customWidthInput.focus();
            return;
        }
        const pairsToGenerate = appState.diptychs.filter(d => d.image1 || d.image2);
        if (pairsToGenerate.length === 0) {
            showStatus("Add at least one image before downloading.", 'warning');
            return;
        }
        appState.isGenerating = true;
        showLoading('Preparing generation...', 0);
        const payload = {
            pairs: pairsToGenerate.map(d => {
                // Copy image objects and attach crop_focus to each
                const framed = serializeDiptych(d);
                const img1 = framed.image1;
                const img2 = framed.image2;
                return { pair: [img1, img2], config: d.config };
            }),
            order: appState.diptychs.map(d => ({
                image1: d.image1 ? d.image1.path : null,
                image2: d.image2 ? d.image2.path : null,
            })),
            zip: zipToggle.checked
        };
        try {
            const startResponse = await fetch('/generate_diptychs', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!startResponse.ok) throw new Error('Failed to start generation on server.');
            const startResult = await startResponse.json();
            const jobId = startResult.job_id;
            const progressInterval = setInterval(async () => {
                const progressResponse = await fetch(`/get_generation_progress?job_id=${encodeURIComponent(jobId)}`);
                const progress = await progressResponse.json();
                // Check for server-side errors
                if (progress.error) {
                    clearInterval(progressInterval);
                    hideLoading();
                    showStatus(`Generation failed: ${progress.error}`, 'error');
                    appState.isGenerating = false;
                    return;
                }
                const percent = progress.total > 0 ? (progress.processed / progress.total) * 100 : 0;
                const current = Math.min(progress.processed + 1, progress.total);
                updateLoadingProgress(percent, `Generating diptych ${current} of ${progress.total}...`);
                if (progress.processed >= progress.total) {
                    clearInterval(progressInterval);
                    updateLoadingProgress(100, 'Finalizing download...');
                    const finalResponse = await fetch(`/finalize_download?job_id=${encodeURIComponent(jobId)}`);
                    const finalResult = await finalResponse.json();
                    hideLoading();
                    if (finalResult.error) {
                        showStatus(`Download failed: ${finalResult.error}`, 'error');
                    } else if (finalResult.download_id) {
                        window.location.href = `/download_file?id=${encodeURIComponent(finalResult.download_id)}`;
                    } else if (finalResult.download_path) {
                        window.location.href = `/download_file?path=${encodeURIComponent(finalResult.download_path)}`;
                    } else if (finalResult.download_ids) {
                        finalResult.download_ids.forEach((id, index) => {
                            setTimeout(() => {
                                const a = document.createElement('a');
                                a.href = `/download_file?id=${encodeURIComponent(id)}`;
                                document.body.appendChild(a);
                                a.click();
                                document.body.removeChild(a);
                            }, 300 * index);
                        });
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
            showStatus(`An error occurred: ${error.message}`, 'error');
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

    function showStatus(message, type = 'info') {
        if (!statusBanner || !statusMessage) return;
        statusMessage.textContent = message;
        statusBanner.classList.remove('hidden', 'status-error', 'status-warning', 'status-info');
        statusBanner.classList.add(`status-${type}`);
    }

    function hideStatus() {
        if (statusBanner) statusBanner.classList.add('hidden');
    }

    return { init };
})();

document.addEventListener('DOMContentLoaded', () => DiptychApp.init());
