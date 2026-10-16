import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
import ts from 'typescript';

function load(name, dependencies, globals = {}) {
  const api = {};
  const compiled = ts.transpileModule(readFileSync(new URL(`../lib/wallet/${name}.ts`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(compiled, { exports: api, crypto: webcrypto, console: { error() {} }, Date, AbortSignal, URL, btoa,
    require: dependency => dependencies[dependency] ?? {}, ...globals });
  return api;
}

test('both broadcast paths require a freshly supplied correct PIN and enforce owner/expiry', async () => {
  let broadcasts = 0;
  const api = load('transactionService', {
    './algoWallet': {
      unlockWallet: async secret => { if (secret !== 'correct-pin') throw new Error('Invalid wallet password or PIN.'); },
      prepareAlgoPayment: async () => ({ sender: 'sender', signed: new Uint8Array(), txId: 'algo-hash', feeMicroAlgos: 1000n }),
      submitAlgoPayment: async () => { broadcasts++; return 'algo-hash'; },
    },
    './moneroVault': { unlockMoneroWallet: async () => ({ address: 'sender' }) },
    '../monero/moneroDaemon': {
      createMoneroTransaction: async () => ({ ok: true, txHex: 'hex', hash: 'xmr-hash', amountAtomic: '10', feeAtomic: '1' }),
      initializeMoneroWasm: async () => {}, verifyMoneroNetwork: async () => {},
    },
    'zebgen-monero-wasm': { relayTransaction: async () => { broadcasts++; return 'xmr-hash'; } },
  });
  for (const chain of ['algorand', 'monero']) {
    const prepared = await api.prepareTransaction('owner', { chain, primaryAddress: 'sender', amountAtomic: '10', config: { daemon: { uri: 'http://localhost' } } });
    assert.equal(prepared.ok, true);
    const before = broadcasts;
    for (const pin of [undefined, '', 'wrong-pin']) {
      const response = await api.submitPreparedTransaction('owner', prepared.review.id, pin);
      assert.equal(response.ok, false);
      assert.match(response.error, /Invalid wallet/);
      assert.equal(broadcasts, before);
    }
    assert.equal((await api.submitPreparedTransaction('other-owner', prepared.review.id, 'correct-pin')).ok, false);
    assert.equal((await api.submitPreparedTransaction('owner', prepared.review.id, 'correct-pin')).ok, true);
    assert.equal(broadcasts, before + 1);
    assert.equal((await api.submitPreparedTransaction('owner', prepared.review.id, 'correct-pin')).ok, false);
  }
});

test('ALGO receipts distinguish pool rejection, pending and confirmed rounds', async () => {
  let result = {};
  const api = load('transactionStatus', { '../algorand/algodClient': {
    createAlgodClient: () => ({ pendingTransactionInformation: () => ({ do: async () => result }) }),
  } });
  const request = { chain: 'algorand', hash: 'hash', endpoint: {} };
  assert.equal((await api.readTransactionStatus(request)).state, 'pending');
  result = { poolError: 'rejected by node' };
  assert.equal((await api.readTransactionStatus(request)).state, 'rejected');
  result = { confirmedRound: 42n };
  assert.equal((await api.readTransactionStatus(request)).block, '42');
});

test('XMR receipts require actual block inclusion and surface RPC errors', async () => {
  const hash = 'a'.repeat(64);
  let result = { status: 'OK', txs: [{ tx_hash: hash, in_pool: true }] };
  let ok = true;
  const api = load('transactionStatus', {}, { fetch: async () => ({ ok, status: 503, json: async () => result }) });
  const request = { chain: 'monero', hash, config: { daemon: { uri: 'http://localhost:18081' } } };
  assert.equal((await api.readTransactionStatus(request)).state, 'pending');
  result = { status: 'OK', txs: [{ tx_hash: hash, in_pool: false, block_height: 123, confirmations: 2 }] };
  const receipt = await api.readTransactionStatus(request);
  assert.equal(receipt.state, 'confirmed');
  assert.equal(receipt.block, '123');
  assert.equal(receipt.confirmations, 2);
  ok = false;
  await assert.rejects(api.readTransactionStatus(request), /HTTP 503/);
});