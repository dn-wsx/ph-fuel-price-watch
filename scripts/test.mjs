import assert from 'node:assert/strict';
import { windows, rawChange, calibrate, forecast, confidence } from './model.mjs';

// Window logic: a Tuesday looks ahead to the following Tuesday.
assert.deepEqual(windows('2026-11-10').cur, ['2026-11-09', '2026-11-13']);
assert.equal(windows('2026-11-10').target, '2026-11-17');
assert.equal(windows('2026-11-14').target, '2026-11-17'); // Saturday
assert.equal(windows('2026-11-16').target, '2026-11-17'); // Monday
assert.equal(windows('2026-11-17').target, '2026-11-24'); // Tuesday itself

// Flat prices -> zero change. +0.10 USD/gal at 58 PHP -> 0.10/3.78541*58*1.12 PHP/L.
const w = windows('2026-11-14');
const days = (start, n, v) => Object.fromEntries(Array.from({ length: n }, (_, i) => [new Date(Date.parse(start) + i * 864e5).toISOString().slice(0, 10), v]));
const fx = { '2026-10-01': 58 };
const flat = { ...days('2026-11-02', 5, 2.0), ...days('2026-11-09', 5, 2.0) };
assert.equal(rawChange(flat, fx, w).raw, 0);
const up = { ...days('2026-11-02', 5, 2.0), ...days('2026-11-09', 5, 2.1) };
assert.ok(Math.abs(rawChange(up, fx, w).raw - (0.1 / 3.78541) * 58 * 1.12) < 1e-9);
assert.equal(rawChange({ ...days('2026-11-02', 2, 2.0), ...days('2026-11-09', 5, 2.1) }, fx, w), null); // prior week too thin

// Calibration: actual = 0.8 * raw exactly -> scale 0.8, rmse 0.
const pairs = [1, -0.5, 0.7, 1.4, -1, 0.3].map((r) => [r, 0.8 * r]);
const cal = calibrate(pairs);
assert.ok(Math.abs(cal.scale - 0.8) < 1e-9 && cal.rmse < 1e-9 && cal.fitted);
assert.equal(calibrate(pairs.slice(0, 3)).scale, 1); // too little history -> unchanged

const f = forecast(1.0, { scale: 1, rmse: 0.6 }, null);
assert.deepEqual([f.direction, f.low, f.high], ['increase', 0.4, 1.6]);
assert.equal(forecast(1.0, { scale: 1, rmse: 0.6 }, [0, 0]).value, 0.5); // 50/50 blend
assert.equal(confidence(5, 10), 'high'); assert.equal(confidence(2, 10), 'low');
console.log('All tests passed');

// DOE announcement and company-table parsing.
await import('./test-doe.mjs');
