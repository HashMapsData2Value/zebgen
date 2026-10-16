import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(new URL('../../leakswap-all/leakswap-private/e2e-ui/package.json', import.meta.url));
const { chromium } = require('playwright');

test('built extension keeps a quiet scan connected beyond the MV3 idle window', { timeout: 90000 }, async () => {
  let requests = 0;
  const timers = new Set();
  const proxy = createServer(async (request, response) => {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const upstream = await fetch(`http://127.0.0.1:18081${request.url}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: Buffer.concat(chunks),
      });
      const body = await upstream.text();
      requests++;
      const timer = setTimeout(() => {
        timers.delete(timer);
        response.writeHead(upstream.status, { 'Content-Type': 'application/json' });
        response.end(body);
      }, requests <= 2 ? 18000 : 0);
      timers.add(timer);
    } catch (error) { response.writeHead(502); response.end(String(error)); }
  });
  await new Promise(resolveListen => proxy.listen(0, '127.0.0.1', resolveListen));
  let context;
  const profile = await mkdtemp(resolve(tmpdir(), 'zebgen-scan-connection-'));
  try {
    const extension = resolve('.output/chrome-mv3');
    context = await chromium.launchPersistentContext(profile, {
      headless: false, ignoreDefaultArgs: ['--disable-extensions'],
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker');
    const page = await context.newPage();
    await page.goto(worker.url().replace(/background.js$/, 'dashboard.html'));
    const source = ts.transpileModule(readFileSync(new URL('../lib/network/messages.ts', import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const started = Date.now();
    const result = await page.evaluate(`(async () => {
      const exports = {};
      const require = () => ({ browser: chrome });
      ${source}
      return exports.scanMoneroBalanceViaBackground({
        config: { network: 'regtest', networkType: 0, daemon: { uri: 'http://127.0.0.1:${proxy.address().port}' } },
        restoreHeight: 17500, walletId: 1, primaryAddress: 'test', lockSecret: 'test'
      });
    })()`);
    assert.ok(Date.now() - started >= 35000, 'must cross the 30-second worker idle window');
    assert.equal(result.ok, false);
    assert.match(result.error, /Set a wallet password or PIN first/);
    assert.ok(requests >= 2);
  } finally {
    await context?.close();
    await rm(profile, { recursive: true, force: true });
    for (const timer of timers) clearTimeout(timer);
    proxy.closeAllConnections();
    await new Promise(resolveClose => proxy.close(resolveClose));
  }
});