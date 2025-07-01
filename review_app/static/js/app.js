document.addEventListener('DOMContentLoaded', () => {
    // --- State Management ---
    const appState = {
        // Centralized state for each slot's data
        // Example: { 'slot-0': { left: {...}, right: {...} } }
        slots: {},
        // Cache for loaded Image objects to avoid re-loading
        imageCache: {},
        // Drag-and-pan interaction state
        interaction: {
            isPanning: false,
            targetSlotId: null,
            targetPosition: null, // 'left' or 'right'
            startX: 0,
            startY: 0,
        }
    };

    // --- Element Selectors ---
    const welcomeScreen = document.getElementById('welcome-screen');
    const appContainer = document.getElementById('app-container');
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
    const zipToggle = document.getElementById('zip-toggle');

    // --- Event Listeners ---
    selectFolderBtn.addEventListener('click', () => selectImagesAndSetup(true));
    selectFilesBtn.addEventListener('click', () => selectImagesAndSetup(false));
    generateBtn.addEventListener('click', generateDiptychs);
    [outputSizeSelect, gapSlider].forEach(el => el.addEventListener('change', refreshAllCanvases));

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
                setTimeout(() => {
                    setupWorkbench(imagePaths);
                    loadingOverlay.classList.add('hidden');
                }, 100);
            } else {
                loadingOverlay.classList.add('hidden');
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
        appState.slots = {};
        appState.imageCache = {};

        imagePaths.forEach(path => {
            imagePool.appendChild(createImageThumbnail(path));
        });

        const initialSlots = Math.max(12, Math.ceil(imagePaths.length / 2));
        for (let i = 0; i < initialSlots; i++) {
            diptychPairsContainer.appendChild(createDiptychCanvasSlot(i));
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
        container.innerHTML = `<img src="/thumbnail/${encodeURIComponent(filename)}" title="${filename}" draggable="false">`;
        return container;
    }

    function createDiptychCanvasSlot(index) {
        const slotId = `slot-${index}`;
        const wrapper = document.createElement('div');
        wrapper.className = 'diptych-canvas-wrapper';
        wrapper.innerHTML = `
            <canvas id="${slotId}" class="diptych-canvas"></canvas>
            <div class="canvas-controls" data-slot-id="${slotId}">
                <div class="half-controls" data-position="left">
                    <button class="control-btn rotate-btn" title="Rotate Left Half"><svg class="icon-rotate" viewBox="0 0 24 24"><path d="M15 15l6-6m0 0l-6-6m6 6H9a6 6 0 000 12h3"/></svg></button>
                    <button class="control-btn clear-btn" title="Clear Left Half"><svg class="icon-clear" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
                </div>
                <div class="half-controls" data-position="right">
                    <button class="control-btn rotate-btn" title="Rotate Right Half"><svg class="icon-rotate" viewBox="0 0 24 24"><path d="M15 15l6-6m0 0l-6-6m6 6H9a6 6 0 000 12h3"/></svg></button>
                    <button class="control-btn clear-btn" title="Clear Right Half"><svg class="icon-clear" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
                </div>
            </div>
        `;
        
        appState.slots[slotId] = { left: null, right: null };

        const canvas = wrapper.querySelector('canvas');
        canvas.addEventListener('mousedown', handlePanStart);
        canvas.addEventListener('mousemove', handlePanMove);
        canvas.addEventListener('mouseup', handlePanEnd);
        canvas.addEventListener('mouseleave', handlePanEnd);
        canvas.addEventListener('wheel', handleZoom, { passive: false });
        wrapper.querySelector('.canvas-controls').addEventListener('click', handleCanvasControls);

        // Set initial canvas size
        resizeCanvas(canvas);

        return wrapper;
    }

    function resizeCanvas(canvas) {
        const [width, height] = outputSizeSelect.value.split('x').map(parseFloat);
        const aspect = width / height;
        canvas.width = canvas.clientWidth;
        canvas.height = canvas.clientWidth / aspect;
    }
    
    function updateUnpairedCount() {
        unpairedCount.textContent = imagePool.children.length;
    }

    // --- Canvas Rendering (The WYSIWYG Core) ---
    function refreshAllCanvases() {
        document.querySelectorAll('.diptych-canvas').forEach(canvas => {
            resizeCanvas(canvas);
            renderCanvas(canvas.id);
        });
    }

    async function renderCanvas(slotId) {
        const canvas = document.getElementById(slotId);
        const ctx = canvas.getContext('2d');
        const slotData = appState.slots[slotId];
        if (!canvas || !ctx || !slotData) return;

        const gap = parseInt(gapSlider.value, 10) * (canvas.width / 400); // Scale gap
        const isLandscape = canvas.width > canvas.height;
        const halfW = isLandscape ? (canvas.width - gap) / 2 : canvas.width;
        const halfH = isLandscape ? canvas.height : (canvas.height - gap) / 2;

        ctx.fillStyle = '#f7f2f2';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        await drawImageInFrame(ctx, slotData.left, 0, 0, halfW, halfH);
        const rightX = isLandscape ? halfW + gap : 0;
        const rightY = isLandscape ? 0 : halfH + gap;
        await drawImageInFrame(ctx, slotData.right, rightX, rightY, halfW, halfH);
    }
    
    async function drawImageInFrame(ctx, imgData, frameX, frameY, frameW, frameH) {
        if (!imgData || !imgData.image) return;

        ctx.save();
        ctx.beginPath();
        ctx.rect(frameX, frameY, frameW, frameH);
        ctx.clip();

        const img = imgData.image;
        const rotation = (imgData.rotation || 0) * Math.PI / 180;
        
        // Calculate the effective dimensions of the image after rotation
        const absCos = Math.abs(Math.cos(rotation));
        const absSin = Math.abs(Math.sin(rotation));
        const rotatedWidth = img.width * absCos + img.height * absSin;
        const rotatedHeight = img.width * absSin + img.height * absCos;

        // Default zoom to fit/cover the frame
        if (!imgData.zoom) {
            imgData.zoom = Math.max(frameW / rotatedWidth, frameH / rotatedHeight);
        }
        const zoom = imgData.zoom;

        const sW = rotatedWidth * zoom;
        const sH = rotatedHeight * zoom;
        
        const dx = frameX + frameW / 2 + (imgData.offsetX || 0);
        const dy = frameY + frameH / 2 + (imgData.offsetY || 0);

        ctx.translate(dx, dy);
        ctx.rotate(rotation);
        ctx.drawImage(img, -img.width / 2, -img.height / 2, img.width, img.height);
        
        ctx.restore();
    }

    function getImage(path, callback) {
        if (appState.imageCache[path]) {
            callback(appState.imageCache[path]);
            return;
        }
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.onload = () => {
            appState.imageCache[path] = img;
            callback(img);
        };
        const filename = path.split(/[\\/]/).pop();
        // Use full image for canvas to get better quality
        img.src = `/image/${encodeURIComponent(filename)}`; 
    }
    
    // --- Canvas Interactivity ---
    function handleCanvasControls(e) {
        const button = e.target.closest('.control-btn');
        if (!button) return;

        const slotId = e.currentTarget.dataset.slotId;
        const position = button.parentElement.dataset.position;
        const imgData = appState.slots[slotId][position];

        if (!imgData) return;

        if (button.classList.contains('rotate-btn')) {
            imgData.rotation = ((imgData.rotation || 0) + 90) % 360;
        }
        if (button.classList.contains('clear-btn')) {
            imagePool.appendChild(createImageThumbnail(imgData.path));
            appState.slots[slotId][position] = null;
            updateUnpairedCount();
        }
        renderCanvas(slotId);
    }
    
    function handlePanStart(e) {
        const slotId = e.target.id;
        const { position } = getPositionOnCanvas(e);
        if (!position || !appState.slots[slotId][position]) return;

        appState.interaction.isPanning = true;
        appState.interaction.targetSlotId = slotId;
        appState.interaction.targetPosition = position;
        appState.interaction.startX = e.clientX;
        appState.interaction.startY = e.clientY;
    }

    function handlePanMove(e) {
        const { isPanning, targetSlotId, targetPosition, startX, startY } = appState.interaction;
        if (!isPanning) return;

        const imgData = appState.slots[targetSlotId][targetPosition];
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        imgData.offsetX = (imgData.offsetX || 0) + dx;
        imgData.offsetY = (imgData.offsetY || 0) + dy;
        
        appState.interaction.startX = e.clientX;
        appState.interaction.startY = e.clientY;

        renderCanvas(targetSlotId);
    }

    function handlePanEnd() {
        appState.interaction.isPanning = false;
    }

    function handleZoom(e) {
        e.preventDefault();
        const slotId = e.target.id;
        const { position } = getPositionOnCanvas(e);
        if (!position || !appState.slots[slotId][position]) return;

        const imgData = appState.slots[slotId][position];
        const zoomAmount = e.deltaY * -0.001;
        imgData.zoom = Math.max(0.1, (imgData.zoom || 1) + zoomAmount);
        renderCanvas(slotId);
    }

    function getPositionOnCanvas(e) {
        const canvas = e.target;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        const isLandscape = canvas.width > canvas.height;
        const position = isLandscape ? (x < canvas.width / 2 ? 'left' : 'right') : (y < canvas.height / 2 ? 'left' : 'right');
        
        return { position };
    }


    // --- Drag & Drop Initialization ---
    function initializeDragAndDrop() {
        new Sortable(imagePool, {
            group: 'shared',
            animation: 150,
            onEnd: updateUnpairedCount
        });

        document.querySelectorAll('.diptych-canvas-wrapper').forEach(wrapper => {
            new Sortable(wrapper, {
                group: 'shared',
                animation: 150,
                onAdd: function (evt) {
                    const item = evt.item;
                    const path = item.dataset.path;
                    const canvas = this.el.querySelector('canvas');
                    const slotId = canvas.id;
                    
                    const rect = canvas.getBoundingClientRect();
                    const x = evt.originalEvent.clientX - rect.left;
                    const y = evt.originalEvent.clientY - rect.top;
                    const isLandscape = canvas.width > canvas.height;
                    const position = isLandscape ? (x < canvas.width / 2 ? 'left' : 'right') : (y < canvas.height / 2 ? 'left' : 'right');

                    const existingImgData = appState.slots[slotId][position];
                    if (existingImgData) {
                        imagePool.appendChild(createImageThumbnail(existingImgData.path));
                    }
                    
                    getImage(path, (img) => {
                         appState.slots[slotId][position] = {
                            path: path,
                            image: img,
                            rotation: 0,
                            offsetX: 0,
                            offsetY: 0
                        };
                        // Reset zoom so it can be recalculated on render
                        delete appState.slots[slotId][position].zoom; 
                        renderCanvas(slotId);
                    });

                    item.remove();
                    updateUnpairedCount();
                }
            });
        });
    }

    // --- Final Generation (To be updated later) ---
    async function generateDiptychs() {
        alert("Generation logic needs to be updated for the new WYSIWYG canvas. This is the next step!");
        // TODO: Adapt this function to send the detailed layout data (zoom, offsets)
        // from appState.slots to the backend.
    }
});
