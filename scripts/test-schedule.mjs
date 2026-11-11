import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkSchedule, latestDueSlot } from './schedule.mjs';
import { PUBLIC_FORECAST_URL } from './update.mjs';

const time = (value) => Date.parse(value);
const now = time('2026-11-11T12:17:00+08:00');
const payload = (generatedAt) => ({ generatedAt, fuels: { gasoline: { value: -1 } } });
const response = (body) => async () => new Response(JSON.stringify(body));
const slot = (value) => latestDueSlot(time(value));

assert.equal(slot('2026-11-11T06:16:59+08:00'), null);
assert.equal(slot('2026-11-11T06:17:00+08:00'), '2026-11-10T22:17:00.000Z');
assert.equal(slot('2026-11-11T11:42:59+08:00'), '2026-11-10T22:17:00.000Z');
assert.equal(slot('2026-11-11T11:43:00+08:00'), '2026-11-11T03:43:00.000Z');
assert.equal(slot('2026-11-11T15:17:00+08:00'), '2026-11-11T07:17:00.000Z');
assert.equal(slot('2026-11-11T18:43:00+08:00'), '2026-11-11T10:43:00.000Z');
assert.equal(slot('2026-11-11T23:59:59+08:00'), '2026-11-11T10:43:00.000Z');
assert.equal(slot('2026-11-14T20:47:00+08:00'), '2026-11-14T10:43:00.000Z');
assert.equal(slot('2026-11-15T12:17:00+08:00'), null);
assert.equal(slot('2026-11-16T20:47:00+08:00'), '2026-11-15T22:17:00.000Z');
assert.equal(slot('2027-01-01T06:17:00+08:00'), '2026-12-31T22:17:00.000Z');
assert.throws(() => latestDueSlot(NaN), /Invalid time/);

let calls = 0;
const unexpectedFetch = async () => { calls++; throw new Error('Should not fetch'); };
for (const eventName of ['push', 'workflow_dispatch']) {
  assert.equal((await checkSchedule({ eventName, now, fetchImpl: unexpectedFetch })).required, true);
}
assert.equal((await checkSchedule({ eventName: 'schedule', now: time('2026-11-15T12:00:00+08:00'), fetchImpl: unexpectedFetch })).required, false);
assert.equal((await checkSchedule({ eventName: 'schedule', now: time('2026-11-11T06:00:00+08:00'), fetchImpl: unexpectedFetch })).required, false);
assert.equal(calls, 0);

const check = (body) => checkSchedule({ eventName: 'schedule', now, fetchImpl: response(body) });
assert.equal((await check(payload('2026-11-11T11:42:59+08:00'))).required, true);
assert.equal((await check(payload('2026-11-11T11:43:00+08:00'))).required, false);
assert.equal((await check(payload('2026-11-11T12:00:00+08:00'))).required, false);
assert.equal((await check(payload('2026-11-10T20:00:00+08:00'))).required, true);
assert.equal((await checkSchedule({
  eventName: 'schedule', now: time('2026-11-11T20:47:00+08:00'),
  fetchImpl: response(payload('2026-11-11T06:17:00+08:00')),
})).required, true);

for (const body of [null, {}, payload(null), payload('bad'), payload('2026-11-12T00:00:00+08:00'), { generatedAt: '2026-11-11T12:00:00+08:00', fuels: {} }]) {
  const result = await check(body);
  assert.equal(result.required, true);
  assert.match(result.warning, /public forecast/i);
}
for (const fetchImpl of [
  async () => { throw new TypeError('fetch failed'); },
  async () => new Response('Not found', { status: 404 }),
  async () => new Response('invalid json'),
]) {
  const result = await checkSchedule({ eventName: 'schedule', now, fetchImpl });
  assert.equal(result.required, true);
  assert.match(result.warning, /public forecast/i);
}
await checkSchedule({
  eventName: 'schedule', now,
  fetchImpl: async (url, init) => {
    assert.equal(url, PUBLIC_FORECAST_URL);
    assert.equal(init.cache, 'no-store');
    assert.ok(init.signal instanceof AbortSignal);
    return new Response(JSON.stringify(payload('2026-11-11T12:00:00+08:00')));
  },
});

let visible = payload('2026-11-10T18:47:00+08:00');
const updates = [];
for (let minute = 12 * 60 + 17; minute <= 20 * 60 + 47; minute += 30) {
  const current = time('2026-11-11T00:00:00+08:00') + minute * 60_000;
  if ((await checkSchedule({ eventName: 'schedule', now: current, fetchImpl: response(visible) })).required) {
    updates.push(new Date(current).toISOString());
    visible = payload(new Date(current).toISOString());
  }
}
assert.deepEqual(updates, ['2026-11-11T04:17:00.000Z', '2026-11-11T07:17:00.000Z', '2026-11-11T10:47:00.000Z']);

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fuel-schedule-'));
try {
  const output = path.join(dir, 'output');
  await fs.writeFile(output, 'existing=true\n');
  const cli = spawnSync(process.execPath, [fileURLToPath(new URL('./schedule.mjs', import.meta.url))], {
    env: { ...process.env, GITHUB_EVENT_NAME: 'push', GITHUB_OUTPUT: output }, encoding: 'utf8', timeout: 5000,
  });
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /update immediately/);
  assert.equal(await fs.readFile(output, 'utf8'), 'existing=true\nrequired=true\n');
} finally {
  await fs.rm(dir, { recursive: true, force: true });
}

const workflow = await fs.readFile(new URL('../.github/workflows/update.yml', import.meta.url), 'utf8');
assert.match(workflow, /cron: '17,47 22-23 \* \* 0-5'/);
assert.match(workflow, /cron: '17,47 0-12 \* \* 1-6'/);
assert.match(workflow, /required: \$\{\{ steps\.schedule\.outputs\.required \}\}/);
assert.match(workflow, /id: schedule\s+run: node scripts\/schedule\.mjs/);
assert.match(workflow, /update:\s+needs: check\s+if: needs\.check\.outputs\.required == 'true'/);
for (const job of ['deploy', 'health']) {
  assert.match(workflow, new RegExp(`${job}:\\s+needs: update`));
}
console.log('Scheduled catch-up, publication freshness and workflow gating tests passed');
