/* Canonical lengths are inches; the selected unit only changes presentation. */
const Measurements = (() => {
    const labels = { in: 'in', mm: 'mm', px: 'px' };
    function toInches(value, unit, dpi) {
        return Number(value) / (unit === 'mm' ? 25.4 : unit === 'px' ? dpi : 1);
    }
    function fromInches(value, unit, dpi) {
        return value * (unit === 'mm' ? 25.4 : unit === 'px' ? dpi : 1);
    }
    function display(value, unit, dpi) {
        return Number(fromInches(value, unit, dpi).toFixed(unit === 'px' ? 0 : 3)).toString();
    }
    function outputSize(config) {
        return config.orientation === 'portrait' ? [config.height, config.width] : [config.width, config.height];
    }
    function spacing(config, key) {
        return config[`${key}_inches`] ?? (config[key] || 0) / config.dpi;
    }
    function validate(width, height, gap, border, dpi) {
        if (![width, height, gap, border, dpi].every(Number.isFinite) || width <= 0 || height <= 0 || gap < 0 || border < 0) {
            return 'Enter positive output dimensions and non-negative spacing and border.';
        }
        const w = Math.floor(width * dpi), h = Math.floor(height * dpi);
        if (w > 20000 || h > 20000) return 'Keep each output dimension at or below 20,000 pixels.';
        if (w < 2 || h < 2) return 'Output must be at least 2 pixels wide and high.';
        if (Math.min(w, h) - 2 * Math.round(border * dpi) < 2 || Math.max(w, h) - 2 * Math.round(border * dpi) - Math.round(gap * dpi) < 2) {
            return 'Reduce the spacing or border so there is room for both photos.';
        }
        return '';
    }
    return { labels, toInches, fromInches, display, outputSize, spacing, validate };
})();
if (typeof module !== 'undefined') module.exports = Measurements;
