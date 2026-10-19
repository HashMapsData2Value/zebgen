import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import algosdk from 'algosdk';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { leakySign } from '../lib/wallet/leakySign.ts';
import { assertSafeSigningRequest, checkAgreementTransaction } from '../lib/wallet/swapAgreementTransactions.ts';
import { validateProviderRequest } from '../lib/provider/fundingValidation.ts';

test('settlement accepts only the authenticated identity and action, not page-selected transaction fields', () => {
  const params = { agreementDigest: 'ab'.repeat(32), appId: '42', action: 'claim' };
  validateProviderRequest('settleLeakSwap', params);
  for (const invalid of [null, [], {}, { ...params, signatureHex: '00' }, { ...params, receiver: 'attacker' },
    { ...params, action: 'punish' }, { ...params, agreementDigest: '' }, { ...params, appId: '0' },
    { ...params, appId: '01' }, { ...params, appId: '18446744073709551616' }]) {
    assert.throws(() => validateProviderRequest('settleLeakSwap', invalid));
  }
});

function fixture(action = 'claim') {
  const party = algosdk.generateAccount();
  const other = algosdk.generateAccount();
  const genesisHash = new Uint8Array(32).fill(1);
  const now = Math.floor(Date.now() / 1000);
  const state = { action, balance: 5000000n, sponsorBalance: 209000n, ready: 1n, timestamp: now,
    t0: now + 3600, t1: now + 7200, wrongParty: false, wrongKey: false, wrongNetwork: false,
    verifyFailure: false, simulationFailure: false, simulationError: false, submitError: false, journalError: false, cancelAfterSimulation: false };
  const controller = new AbortController();
  let clock = now * 1000;
  class TestDate extends Date { static now() { return clock; } }
  const calls = [];
  const publicKey = '02'.repeat(32);
  const agreement = { offer: { payload: { aliAlgoAddress: action === 'refund' ? party.addr.toString() : other.addr.toString(),
    aliPublicSpendKey: publicKey, algoGenesisHash: Buffer.from(genesisHash).toString('base64'), algoAmount: '5000000' } },
    acceptance: { payload: { xinAlgoAddress: action === 'claim' ? party.addr.toString() : other.addr.toString(), xinPublicSpendKey: publicKey } } };
  const sponsor = new algosdk.LogicSigAccount(new Uint8Array([6, 129, 1]));
  let group;
  const algod = {
    getTransactionParams: () => ({ do: async () => ({ genesisHash: state.wrongNetwork ? new Uint8Array(32) : genesisHash,
      genesisID: 'mock', fee: 1000n, minFee: 1000n, firstValid: 1n, lastValid: 100n }) }),
    getApplicationByID: () => ({ do: async () => ({ params: { globalState: [{ key: new TextEncoder().encode('aliReady'), value: { uint: state.ready } }] } }) }),
    status: () => ({ do: async () => ({ lastRound: 1n }) }),
    block: () => ({ do: async () => ({ block: { header: { timestamp: state.timestamp } } }) }),
    accountInformation: address => ({ do: async () => ({ amount: address.toString() === sponsor.address().toString() ? state.sponsorBalance : state.balance }) }),
    simulateTransactions: request => ({ do: async () => {
      calls.push('simulate'); group = request.txnGroups[0].txns;
      if (state.cancelAfterSimulation) controller.abort();
      if (state.expireAfterSimulation) clock = (state.t0 + 1) * 1000;
      if (state.simulationError) throw new Error('private node details must not escape');
      return { txnGroups: [{ ...(state.simulationFailure ? { failureMessage: 'rejected' } : {}) }] };
    } }),
    sendRawTransaction: blobs => ({ do: async () => { calls.push('broadcast'); assert.equal(blobs.length, 2); if (state.submitError) throw new Error('lost response'); } }),
  };
  const settings = { algorand: { network: 'localnet', algod: { server: 'local' } }, monero: { network: 'regtest', networkType: 'stagenet' } };
  const api = {};
  const dependencies = {
    algosdk: { ...algosdk, Algodv2: function () { return algod; }, waitForConfirmation: async () => { calls.push('confirm'); return { confirmedRound: 2n }; } },
    '@noble/hashes/utils.js': { bytesToHex, hexToBytes },
    '../network/networkStore': { getNetworkSettings: async () => settings },
    '../network/chainIdentity': { verifyAlgorandGenesis: () => {} },
    '../provider/base64': { bytesToBase64: bytes => Buffer.from(bytes).toString('base64') },
    '../provider/fundingValidation': { validateProviderRequest },
    '../provider/connectionApproval': { assertConnectionAccounts: async () => {} },
    './algoWallet': { deriveActiveSeedAlgoAddressAtIndex: async () => ({ algoAddress: (state.wrongParty ? other : party).addr.toString() }),
      signRawTransactions: async (_secret, index, bytes) => { calls.push('algo-sign'); assert.equal(index, 0); return bytes.map(bytes => algosdk.decodeUnsignedTransaction(bytes).signTxn(party.sk)); } },
    './swapHandshakeVault': { resolveSwapWalletId: async () => -1 },
    './moneroVault': { unlockMoneroWallet: async () => ({ publicSpendKey: state.wrongKey ? 'bad' : publicKey, privateSpendKey: '01' + '00'.repeat(31) }) },
    './swapRecordVault': { verifyAgreementApplication: async () => {
      calls.push('verify'); if (state.verifyFailure) throw new Error('Wrong application');
      Object.assign(agreement.offer.payload, { t0: state.t0, t1: state.t1 }); return agreement;
    }, journalSignedAlgorandTransactions: async () => { calls.push('journal'); if (state.journalError) throw new Error('Storage unavailable'); } },
    './swapAgreementArtifact': { agreementSponsorLogicSig: () => sponsor },
    './swapAgreementTransactions': { assertSafeSigningRequest, checkAgreementTransaction },
    './leakySign': { leakySign: (...args) => { calls.push('leaky-sign'); return leakySign(...args); } },
  };
  const code = ts.transpileModule(readFileSync(new URL('../lib/wallet/settleLeakSwap.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  runInNewContext(code, { exports: api, Uint8Array, TextDecoder, Date: TestDate, console,
    navigator: { locks: { request: async (_name, action) => action() } },
    require: name => { if (!(name in dependencies)) throw new Error(name); return dependencies[name]; },
  });
  return { state, calls, group: () => group, run: () => api.settleLeakSwap({ agreementDigest: 'ab'.repeat(32), appId: '42', action }, 'secret', 'https://app.leakswap.com', controller.signal) };
}

for (const action of ['claim', 'refund']) test(`wallet owns ${action} construction, signing and broadcast; returns only receipt`, async () => {
  const current = fixture(action);
  if (action === 'refund') current.state.ready = 0n;
  const result = await current.run();
  assert.deepEqual(Object.keys(result).sort(), ['confirmedRound', 'txId']);
  assert.equal(result.confirmedRound, '2');
  assert.deepEqual(current.calls, ['verify', 'leaky-sign', 'journal', 'simulate', 'algo-sign', 'broadcast', 'confirm']);
  const [sponsor, call] = current.group();
  assert.ok(sponsor.lsig);
  assert.equal(call.sig, undefined);
  assert.equal(call.txn.applicationCall.onComplete, algosdk.OnApplicationComplete.DeleteApplicationOC);
  assert.equal(call.txn.fee, action === 'claim' ? 7000n : 5000n);
  assert.equal(result.txId, call.txn.txID());
});

for (const [name, change] of [
  ['wrong party', { wrongParty: true }], ['wrong application', { verifyFailure: true }],
  ['wrong key', { wrongKey: true }], ['wrong network', { wrongNetwork: true }],
  ['escrow shortfall', { balance: 4999999n }], ['sponsor shortfall', { sponsorBalance: 106999n }],
  ['not ready', { ready: 0n }], ['final deadline', { t1: 1 }],
]) test(`local preflight rejects ${name} before generating a revealing signature`, async () => {
  const current = fixture(); Object.assign(current.state, change);
  await assert.rejects(current.run());
  assert.equal(current.calls.includes('leaky-sign'), false);
  assert.equal(current.calls.includes('simulate'), false);
  assert.equal(current.calls.includes('broadcast'), false);
});

for (const field of ['simulationFailure', 'simulationError']) test(`${field} blocks Algorand signing and broadcast without exposing node details`, async () => {
  const current = fixture(); current.state[field] = true;
  await assert.rejects(current.run(), error => /revealing signature/.test(error.message) && !/private node details/.test(error.message));
  assert.equal(current.calls.includes('algo-sign'), false);
  assert.equal(current.calls.includes('broadcast'), false);
});

test('storage failure blocks simulation and broadcasting', async () => {
  const current = fixture(); current.state.journalError = true;
  await assert.rejects(current.run(), /Storage unavailable/);
  assert.equal(current.calls.includes('simulate'), false);
  assert.equal(current.calls.includes('broadcast'), false);
});

test('uncertain relay returns a transaction reference, never signed bytes or signature', async () => {
  const current = fixture(); current.state.submitError = true;
  await assert.rejects(current.run(), /confirmation is uncertain.*[A-Z2-7]{52}/);
});

test('closing approval during simulation prevents signing and broadcast', async () => {
  const current = fixture(); current.state.cancelAfterSimulation = true;
  await assert.rejects(current.run(), /Settlement cancelled/);
  assert.equal(current.calls.includes('algo-sign'), false);
  assert.equal(current.calls.includes('broadcast'), false);
});

for (const change of [{ ready: 1n }, { ready: 0n, t0: 1 }]) test('refund preflight rejects readiness or expiry before key disclosure', async () => {
  const current = fixture('refund'); Object.assign(current.state, change);
  await assert.rejects(current.run(), /readiness or deadline|deadline passed during approval/);
  assert.equal(current.calls.includes('leaky-sign'), false);
});

test('unsolicited escrow dust does not prevent wallet-owned settlement', async () => {
  const current = fixture(); current.state.balance++;
  assert.equal((await current.run()).confirmedRound, '2');
});

test('refund deadline crossing during simulation prevents signing and broadcast', async () => {
  const current = fixture('refund'); current.state.ready = 0n; current.state.expireAfterSimulation = true;
  await assert.rejects(current.run(), /deadline passed during approval/);
  assert.equal(current.calls.includes('algo-sign'), false);
  assert.equal(current.calls.includes('broadcast'), false);
});