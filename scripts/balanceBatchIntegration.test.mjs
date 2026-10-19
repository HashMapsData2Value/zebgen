import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

function setup({ failSave = false } = {}) {
  const calls = [];
  const observations = [];
  const errors = [];
  let checkpoint;
  const dependencies = {
    'zebgen-monero-wasm': {
      default: async () => ({}),
      daemonNetwork: async () => 'stagenet',
      daemonHeight: async () => 300,
      scanBalanceBatch: async (...args) => {
        const saved = args[6] === undefined ? undefined : JSON.parse(args[6]);
        calls.push(saved);
        const height = (saved?.nextHeight ?? 100) + 100;
        return JSON.stringify({
          checkpoint: { nextHeight: height, outputs: [{ output: 'retained-output' }] },
          scannedHeight: height,
          targetHeight: 300,
          done: height === 300,
          balanceAtomic: height === 300 ? '42' : '0',
        });
      },
    },
    'zebgen-monero-wasm/zebgen_monero_wasm_bg.wasm?url&no-inline': { default: 'test.wasm' },
    '../network/networks': { networkLabel: (network) => network },
    '../wallet/moneroVault': {
      unlockMoneroWallet: async () => ({
        address: 'test-address',
        privateSpendKey: 'test-spend',
        privateViewKey: 'test-view',
      }),
    },
    '../wallet/moneroBalanceCache': {
      balanceCheckpointKey: (...parts) => JSON.stringify(parts),
      saveBalanceCheckpoint: async (...args) => observations.push(args),
    },
    '../wallet/moneroScanCheckpoint': {
      loadScanCheckpoint: async () => checkpoint,
      saveScanCheckpoint: async (_identity, value) => {
        if (failSave) throw new Error('storage quota exceeded');
        checkpoint = value;
      },
    },
    '../wallet/db': { setMoneroScanRestoreHeight: async () => {} },
  };
  const source = readFileSync(
    new URL('../lib/monero/moneroDaemon.ts', import.meta.url),
    'utf8',
  ).replaceAll('import.meta.env.MODE', "'test'");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  runInNewContext(compiled, {
    exports,
    URL,
    console: { error: (...args) => errors.push(args) },
    require: (name) => {
      assert.ok(name in dependencies, `Unexpected dependency ${name}`);
      return dependencies[name];
    },
  });
  const request = {
    config: { network: 'stagenet', networkType: 2, daemon: { uri: 'https://node.invalid' } },
    walletId: 1,
    primaryAddress: 'test-address',
    lockSecret: 'test-secret',
    restoreHeight: 100,
  };
  return {
    scan: (control) => exports.scanMoneroBalance(request, control),
    calls,
    observations,
    errors,
    get checkpoint() {
      return checkpoint;
    },
  };
}

test('cancellation after durable progress resumes with retained outputs and saves only a complete balance', async () => {
  const harness = setup();
  const controller = new AbortController();
  const stopped = await harness.scan({
    signal: controller.signal,
    onProgress: (progress) => {
      assert.equal(harness.checkpoint.nextHeight, progress.scannedHeight);
      assert.equal(progress.scannedHeight, 200);
      controller.abort();
    },
  });
  assert.equal(stopped.ok, false);
  assert.equal(harness.calls.length, 1);
  assert.equal(harness.observations.length, 0);
  assert.equal(harness.checkpoint.outputs[0].output, 'retained-output');
  const resumed = await harness.scan();
  assert.equal(resumed.ok, true);
  assert.equal(resumed.balanceAtomic, '42');
  assert.equal(harness.calls[1].nextHeight, 200);
  assert.equal(harness.calls[1].outputs[0].output, 'retained-output');
  assert.equal(harness.observations.length, 1);
  assert.equal(harness.observations[0][1].scannedHeight, 300);
  assert.equal(harness.observations[0][1].resumable, true);
});

test('checkpoint write failure stops before progress, another batch, or a balance observation', async () => {
  const harness = setup({ failSave: true });
  let progress = 0;
  const result = await harness.scan({
    onProgress: () => {
      progress++;
    },
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /storage quota exceeded/);
  assert.equal(harness.calls.length, 1);
  assert.equal(progress, 0);
  assert.equal(harness.checkpoint, undefined);
  assert.equal(harness.observations.length, 0);
  assert.equal(harness.errors.length, 1);
});
