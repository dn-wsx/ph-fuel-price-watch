import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import * as net from './http.mjs';

assert.equal(typeof net.readUrl, 'function');
const server = http.createServer((req, res) => {
  if (req.url === '/headers') return;
  if (req.url === '/body') { res.writeHead(200); res.write('partial'); return; }
  res.end('ok');
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
try {
  for (const endpoint of ['headers', 'body']) {
    const started = Date.now();
    await assert.rejects(net.readUrl(`http://127.0.0.1:${server.address().port}/${endpoint}`, { timeoutMs: 25, attempts: 1 }), /timed out|timeout/i);
    assert.ok(Date.now() - started < 1500);
  }
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
let calls = 0;
const sleeps = [];
const options = { sleepImpl: async (ms) => sleeps.push(ms), fetchImpl: async () => { calls++; return new Response('unavailable', { status: 503 }); } };
await assert.rejects(net.readUrl('https://example.test', options), /503.*3 attempts/);
assert.equal(calls, 3);
assert.equal(sleeps.length, 2);
calls = 0;
await assert.rejects(net.readUrl('https://example.test', { ...options, fetchImpl: async () => { calls++; return new Response('missing', { status: 404 }); } }), /404/);
assert.equal(calls, 1);
calls = 0;
await assert.rejects(net.readUrl('https://example.test', { ...options, format: 'json', fetchImpl: async () => { calls++; return new Response('{ bad'); } }), SyntaxError);
assert.equal(calls, 1);
calls = 0;
assert.equal((await net.readUrl('https://example.test', { ...options, fetchImpl: async () => {
  if (++calls < 3) throw new TypeError('fetch failed');
  return new Response('done');
} })).body, 'done');
assert.equal(calls, 3);
const controller = new AbortController();
controller.abort(new Error('source budget exhausted'));
calls = 0;
await assert.rejects(net.readUrl('https://example.test', { ...options, signal: controller.signal }), /budget exhausted/);
assert.equal(calls, 0);
console.log('Bounded HTTP and retry tests passed');
