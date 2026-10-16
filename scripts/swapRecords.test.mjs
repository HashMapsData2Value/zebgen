import assert from 'node:assert/strict';
import { test } from 'node:test';
import { saveSwapRecord, listSwapRecords, saveSignedTransactions, listSignedTransactions } from '../lib/wallet/swapRecords.ts';

function storage() {
  let data = {};
  return {
    get: async (key) => structuredClone(key === null ? data : { [key]: data[key] }),
    set: async (items) => { data = JSON.parse(JSON.stringify({ ...data, ...items })); },
  };
}
const record = {
  version: 1, genesisHash: 'A'.repeat(43) + '=', appId: '123', appAddress: 'A'.repeat(58),
  role: 'ali', algoAddress: 'B'.repeat(58), aliAddress: 'B'.repeat(58), xinAddress: 'C'.repeat(58), t0: 100, t1: 200,
  context: { version: 1, walletId: 1, network: 'regtest', combinedAddress: '4'.repeat(95),
    counterpartyPublicSpendKey: 'ab'.repeat(32), counterpartyPrivateViewKey: 'cd'.repeat(32), restoreHeight: 50 },
};

test('encrypted swap survives JSON storage, preserves earliest height, rejects identity replacement', async () => {
  const store = storage();
  await saveSwapRecord(store, record, 'secret');
  assert.equal(JSON.stringify(await store.get(null)).includes(record.context.counterpartyPrivateViewKey), false);
  await saveSwapRecord(store, { ...record, context: { ...record.context, restoreHeight: 70 } }, 'secret');
  assert.deepEqual(await listSwapRecords(store, 'secret'), [record]);
  await assert.rejects(listSwapRecords(store, 'wrong'));
  await assert.rejects(saveSwapRecord(store, { ...record, t1: 201 }, 'secret'), /identity/);
  const raw = await store.get(null);
  const key = Object.keys(raw)[0];
  raw[key].ciphertext[0] ^= 1;
  await store.set(raw);
  await assert.rejects(listSwapRecords(store, 'secret'));
});

test('networks remain distinct and swapped encrypted records fail closed', async () => {
  const store = storage();
  await saveSwapRecord(store, record, 'secret');
  await saveSwapRecord(store, { ...record, genesisHash: 'B'.repeat(43) + '=' }, 'secret');
  assert.equal((await listSwapRecords(store, 'secret')).length, 2);
  const raw = await store.get(null);
  const keys = Object.keys(raw);
  await store.set({ [keys[0]]: raw[keys[1]] });
  await assert.rejects(listSwapRecords(store, 'secret'), /index/);
});

test('signed transaction journal survives lost page state without claiming confirmation', async () => {
  const store = storage();
  const entry = { version: 1, genesisHash: record.genesisHash, txId: 'A'.repeat(52), sender: record.algoAddress,
    origin: 'https://app.leakswap.com', firstValid: '1', lastValid: '1000', unsignedTransaction: 'AQID', signedAt: new Date().toISOString() };
  await saveSignedTransactions(store, [entry], 'secret');
  assert.deepEqual(await listSignedTransactions(store, 'secret'), [entry]);
  assert.equal('confirmedRound' in (await listSignedTransactions(store, 'secret'))[0], false);
  await assert.rejects(saveSignedTransactions(store, [{ ...entry, lastValid: '0' }], 'secret'));
});