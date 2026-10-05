const assert = require('node:assert/strict');
const M = require('../review_app/static/js/measurements.js');
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
for (const unit of ['in', 'mm', 'px']) {
    for (const dpi of [72, 150, 300, 600]) {
        for (const length of [0, 0.1, 4, 6, 10.25]) {
            near(M.toInches(M.fromInches(length, unit, dpi), unit, dpi), length);
        }
    }
}
near(M.toInches(152.4, 'mm', 300), 6);
near(M.toInches(1800, 'px', 300), 6);
assert.equal(M.display(6, 'mm', 300), '152.4');
assert.deepEqual(M.outputSize({ width: 6, height: 4, orientation: 'portrait' }), [4, 6]);
near(M.spacing({ gap: 30, dpi: 300 }, 'gap'), 0.1);
assert.equal(M.validate(6, 4, 0.1, 0.1, 300), '');
assert.match(M.validate(6, 4, 0.1, 2, 300), /Reduce/);
assert.match(M.validate(NaN, 4, 0.1, 0.1, 300), /positive/);
assert.match(M.validate(100, 100, 0, 0, 300), /20,000/);
console.log('Measurement conversions and validation passed.');
