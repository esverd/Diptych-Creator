const Workspace = (() => {
    function read(raw, available, fallback) {
        if (!raw) return null;
        const data = JSON.parse(raw);
        if (data?.version !== 1 || !Array.isArray(data.images) || !Array.isArray(data.diptychs) || data.images.length > 2000 || !data.diptychs.length || data.diptychs.length > 2000) throw new Error('Unsupported workspace');
        const names = new Set();
        const images = data.images.map(image => {
            const path = image?.path;
            if (typeof path !== 'string' || !path || /[\\/\x00]/.test(path) || names.has(path)) throw new Error('Invalid photo reference');
            names.add(path);
            return {path, missing: !available.has(path)};
        });
        const placed = new Set();
        function photo(image) {
            if (image === null) return null;
            if (!image || !names.has(image.path)) throw new Error('Photo is absent from library');
            if (placed.has(image.path)) throw new Error('Photo occurs in more than one slot');
            placed.add(image.path);
            const result = {path: image.path, auto_rotate: false};
            if (image.fit_mode !== undefined) {
                if (!['fill','fit'].includes(image.fit_mode)) throw new Error('Invalid framing');
                result.fit_mode = image.fit_mode;
            }
            if (image.rotation !== undefined) {
                if (![0,90,180,270].includes(image.rotation)) throw new Error('Invalid rotation');
                result.rotation = image.rotation;
            }
            if (image.zoom !== undefined) {
                if (!Number.isFinite(image.zoom) || image.zoom < 0.1 || image.zoom > 4) throw new Error('Invalid photo size');
                result.zoom = image.zoom;
            }
            if (image.crop_focus !== undefined) {
                if (!Array.isArray(image.crop_focus) || image.crop_focus.length !== 2 || !image.crop_focus.every(n => Number.isFinite(n) && n >= 0 && n <= 1)) throw new Error('Invalid position');
                result.crop_focus = [...image.crop_focus];
            }
            return result;
        }
        const diptychs = data.diptychs.map(pair => {
            const config = {...fallback, ...pair?.config};
            if (!['landscape','portrait'].includes(config.orientation) || !['fill','fit'].includes(config.fit_mode) || ![72,150,300,600].includes(config.dpi) || !/^#[0-9a-f]{6}$/i.test(config.border_color)) throw new Error('Invalid layout');
            config.gap_inches ??= config.gap / config.dpi;
            config.outer_border_inches ??= config.outer_border / config.dpi;
            if (Measurements.validate(config.width,config.height,config.gap_inches,config.outer_border_inches,config.dpi)) throw new Error('Invalid dimensions');
            return {image1:photo(pair.image1),image2:photo(pair.image2),config};
        });
        return {images,diptychs,
            activeDiptychIndex: Number.isInteger(data.activeDiptychIndex) ? Math.max(0,Math.min(diptychs.length-1,data.activeDiptychIndex)) : 0,
            measurementUnit: ['mm','in','px'].includes(data.measurementUnit) ? data.measurementUnit : 'in',
            libraryFilter: ['all','available','placed'].includes(data.libraryFilter) ? data.libraryFilter : 'all',
            libraryQuery: typeof data.libraryQuery === 'string' ? data.libraryQuery.slice(0,200) : ''};
    }
    function serialize(state) {
        return JSON.stringify({version:1,images:state.images.map(({path})=>({path})),diptychs:state.diptychs,
            activeDiptychIndex:state.activeDiptychIndex,measurementUnit:state.measurementUnit,
            libraryFilter:state.libraryFilter,libraryQuery:state.libraryQuery});
    }
    return {read,serialize};
})();
if (typeof module !== 'undefined') module.exports = Workspace;
