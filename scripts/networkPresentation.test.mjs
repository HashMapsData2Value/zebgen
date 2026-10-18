import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../lib/network/networks.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  }
}).outputText;
const api = {};
runInNewContext(compiled, {
  exports: api, require: name => {
    assert.equal(name, '../wallet/moneroWallet');
    return { MoneroNetworkType: { MAINNET: 0, TESTNET: 1, STAGENET: 2 } };
  }
});
const { ALGORAND_NETWORK_IDS, MONERO_NETWORK_IDS, networkColor } = api;

test('Monero choices exclude Testnet without changing Algorand choices', () => {
  assert.deepEqual(Array.from(MONERO_NETWORK_IDS), ['mainnet', 'stagenet', 'regtest']);
  assert.deepEqual(Array.from(ALGORAND_NETWORK_IDS), ['mainnet', 'testnet', 'localnet']);
});

test('Monero staging and local colors match their Algorand equivalents', () => {
  assert.equal(networkColor('mainnet'), '#a78bfa');
  assert.equal(networkColor('testnet'), '#eab308');
  assert.equal(networkColor('localnet'), '#ffffff');
  assert.equal(networkColor('stagenet'), networkColor('testnet'));
  assert.equal(networkColor('regtest'), networkColor('localnet'));
  assert.notEqual(networkColor('stagenet'), networkColor('mainnet'));
  assert.notEqual(networkColor('regtest'), networkColor('mainnet'));
});