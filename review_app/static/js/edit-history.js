const EditHistory = (() => {
    const clone = value => JSON.parse(JSON.stringify(value));
    function create(limit = 50) {
        const past = [], future = [];
        return {
            clear() { past.length = 0; future.length = 0; },
            record(before, after, label, group = null) {
                if (JSON.stringify(before) === JSON.stringify(after)) return;
                const last = past.at(-1);
                if (group && last?.group === group) last.after = clone(after);
                else past.push({ before: clone(before), after: clone(after), label, group });
                if (past.length > limit) past.shift();
                future.length = 0;
            },
            undo() { const item = past.pop(); if (!item) return; future.push(item); return clone(item.before); },
            redo() { const item = future.pop(); if (!item) return; past.push(item); return clone(item.after); },
            get undoLabel() { return past.at(-1)?.label; },
            get redoLabel() { return future.at(-1)?.label; }
        };
    }
    function pair(paths, existing, baseConfig) {
        const images = new Map();
        existing.forEach(pair => [pair.image1, pair.image2].filter(Boolean).forEach(image => images.set(image.path, {
            ...clone(image), fit_mode: image.fit_mode || pair.config.fit_mode,
            crop_focus: clone(image.crop_focus || pair.config.crop_focus || [0.5, 0.5]), auto_rotate: false
        })));
        return paths.map(paths => {
            const previous = existing.find(pair => pair.image1?.path === paths[0] && (pair.image2?.path || null) === (paths[1] || null));
            return { image1: paths[0] ? clone(images.get(paths[0]) || {path: paths[0], auto_rotate:false}) : null,
                image2: paths[1] ? clone(images.get(paths[1]) || {path: paths[1], auto_rotate:false}) : null,
                config: clone(previous?.config || baseConfig) };
        });
    }
    return { create, pair };
})();
if (typeof module !== 'undefined') module.exports = EditHistory;
