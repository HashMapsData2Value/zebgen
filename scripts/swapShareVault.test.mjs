import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';
import algosdk from 'algosdk';
import { ed25519 } from '@noble/curves/ed25519.js';
import * as seedVault from '../lib/wallet/seedVault.ts';
import * as spendKeyValidation from '../lib/wallet/spendKeyValidation.ts';
import * as handshake from 'leakswap-utils/dist/swapHandshake.js';
import * as agreement from 'leakswap-utils/dist/swapAgreement.js';
import * as contexts from '../lib/wallet/combinedAddressContext.ts';

const require = createRequire(import.meta.url);
const secret = 'test-only-password';
function load(name, modules = {}, globals = {}) {
  const source = readFileSync(new URL(`../lib/wallet/${name}.ts`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true
  } }).outputText;
  const api = {};
  runInNewContext(compiled, { exports: api, require: name => modules[name] ?? require(name),
    crypto, Uint8Array, Uint32Array, TextEncoder, TextDecoder, URL, console, ...globals });
  return api;
}

const monero = load('moneroWallet');
const { recoverCombinedWallet } = load('combinedRecovery', { './moneroWallet.ts': monero });

function harness() {
  const data = {};
  let failWrites = false;
  let meta = { activeMoneroKeyId: 1, moneroAddress: 'funding-address' };
  let metaWrites = 0;
  const accounts = [algosdk.generateAccount(), algosdk.generateAccount(), algosdk.generateAccount()];
  let account = accounts[0];
  let network = 'regtest';
  let genesis = new Uint8Array(32).fill(9);
  const funding = monero.generateMoneroKeyMaterial();
  const encryptedFunding = seedVault.encryptSeed(new Uint8Array(Buffer.from(funding.privateSpendKey, 'hex')), secret);
  const storage = {
    get: async key => structuredClone(key === null ? data : { [key]: data[key] }),
    set: async items => { if (failWrites) throw new Error('Storage quota exceeded'); Object.assign(data, structuredClone(items)); }
  };
  const queues = new Map();
  const navigator = { locks: { request: (key, action) => {
    const next = (queues.get(key) ?? Promise.resolve()).then(action);
    queues.set(key, next.catch(() => {}));
    return next;
  } } };
  const algo = {
    unlockWallet: async () => ({}),
    deriveActiveSeedAlgoAddressAtIndex: async () => ({ algoAddress: account.addr.toString() }),
    signSwapHandshake: async (_secret, message) => {
      assert.ok(Object.keys(data).some(key => key.startsWith('leakswapShare:')), 'share must persist before signing');
      return Buffer.from(ed25519.sign(handshake.handshakeSigningBytes(message.kind, message.payload), account.sk.slice(0, 32))).toString('hex');
    }
  };
  const modules = {
    algosdk: { ...algosdk, Algodv2: function () { return { getTransactionParams: () => ({ do: async () => ({ genesisHash: genesis, genesisID: 'mock' }) }) }; } },
    'wxt/browser': { browser: { storage: { local: storage } } },
    './algoWallet': algo,
    '../network/networkStore': { getNetworkSettings: async () => ({ algorand: { network: 'localnet', algod: {} }, monero: { network, networkType: 0 } }) },
    '../network/chainIdentity': { verifyAlgorandGenesis: () => {} },
    '../provider/base64': { bytesToBase64: bytes => Buffer.from(bytes).toString('base64') },
    './seedVault': seedVault,
    './moneroWallet': monero,
    './combinedAddressContext': contexts,
    './db': {
      getWalletMeta: async () => structuredClone(meta),
      setWalletMeta: async next => { metaWrites++; meta = next; },
      getAllMoneroKeyRecords: async () => [{ id: 1, address: funding.address, createdAt: '2026-01-01' }],
      getMoneroKeyRecord: async id => {
        assert.equal(id, 1, 'shares must not use the normal wallet table');
        const encrypted = await encryptedFunding;
        return { encryptedPrivateSpendKey: encrypted.encryptedSeed, salt: encrypted.salt, iv: encrypted.iv };
      },
    },
    'leakswap-utils/dist/swapHandshake.js': handshake,
    'leakswap-utils/dist/swapAgreement.js': agreement,
    './swapKeyUse': { reserveSwapKey: async () => {} },
    './spendKeyValidation': spendKeyValidation,
    '../monero/restoreHeight': { currentRestoreHeight: async () => 123 },
  };
  const globals = { navigator };
  function reload() {
    modules['./swapShareVault'] = load('swapShareVault', modules, globals);
    modules['./moneroVault'] = load('moneroVault', modules, globals);
    return load('swapHandshakeVault', modules, globals);
  }
  let api = reload();
  return {
    data, storage, funding, accounts, modules,
    get api() { return api; },
    get shares() { return modules['./swapShareVault']; },
    get wallets() { return modules['./moneroVault']; },
    get metaWrites() { return metaWrites; },
    reload: () => { api = reload(); },
    select: index => { account = accounts[index]; },
    network: value => { network = value; },
    genesis: value => { genesis = value; },
    failWrites: value => { failWrites = value; },
  };
}

const terms = () => ({ algoAmount: '10000000', xmrAmount: '1000000000000', t0: Math.floor(Date.now() / 1000) + 3600, t1: Math.floor(Date.now() / 1000) + 7200 });

test('approved invite persists encrypted fresh shares without changing normal wallets or exposing spend keys', async () => {
  const vault = harness();
  const before = await vault.wallets.getMoneroWalletState();
  const first = await vault.api.createSwapInvite(terms(), secret);
  const second = await vault.api.createSwapInvite(terms(), secret);
  assert.notEqual(first.offer.payload.aliPublicSpendKey, vault.funding.publicSpendKey);
  assert.notEqual(first.offer.payload.aliPrivateViewKey, vault.funding.privateViewKey);
  assert.notEqual(first.offer.payload.aliPublicSpendKey, second.offer.payload.aliPublicSpendKey);
  assert.deepEqual(await vault.wallets.getMoneroWalletState(), before);
  assert.equal(vault.metaWrites, 0);
  assert.equal(Object.keys(vault.data).filter(key => key.startsWith('leakswapShare:')).length, 2);
  const inventory = await vault.shares.listSwapShares(secret);
  assert.equal(inventory.length, 2);
  assert.ok(inventory.every(share => share.walletId < 0));
  assert.ok(!JSON.stringify(inventory).includes('privateSpendKey'));
  assert.ok(!JSON.stringify(first).includes('privateSpendKey'));
  const id = inventory.find(share => share.digest === first.offerDigest).walletId;
  vault.reload();
  const material = await vault.wallets.unlockMoneroWallet(secret, 0, id);
  assert.equal(material.publicSpendKey, first.offer.payload.aliPublicSpendKey);
  assert.ok(!JSON.stringify(vault.data).includes(material.privateSpendKey));
  assert.equal(vault.metaWrites, 0);
});

test('accept retries and concurrent accepts reuse the persisted share, then confirm and reload resolve exact shares', async () => {
  const vault = harness();
  const invite = await vault.api.createSwapInvite(terms(), secret);
  vault.select(1);
  const accepted = await vault.api.acceptSwapInvite(invite.link, secret);
  vault.reload();
  const retry = await vault.api.acceptSwapInvite(invite.link, secret);
  const concurrent = await Promise.all([vault.api.acceptSwapInvite(invite.link, secret), vault.api.acceptSwapInvite(invite.link, secret)]);
  assert.equal(JSON.stringify(retry.acceptance), JSON.stringify(accepted.acceptance));
  for (const result of concurrent) assert.equal(JSON.stringify(result.acceptance), JSON.stringify(accepted.acceptance));
  assert.equal((await vault.shares.listSwapShares(secret)).length, 2);
  const xinId = await vault.api.resolveSwapWalletId(invite.offerDigest, secret);
  assert.ok(xinId < 0);
  assert.equal((await vault.wallets.unlockMoneroWallet(secret, 0, xinId)).publicSpendKey, accepted.acceptance.payload.xinPublicSpendKey);
  await assert.rejects(vault.api.resolveSwapWalletId(invite.offerDigest, secret, 1), /conflicts/);
  await assert.rejects(vault.api.resolveSwapWalletId(undefined, secret, xinId), /digest is required/);
  vault.select(0);
  await vault.api.confirmSwapAcceptance(accepted.link, secret);
  vault.reload();
  const aliId = await vault.api.resolveSwapWalletId(invite.offerDigest, secret);
  assert.notEqual(aliId, xinId);
  const owner = await vault.wallets.unlockMoneroWallet(secret, 0, aliId);
  const combined = monero.computeCombinedAddressWithPrivateAndPublic(owner.privateSpendKey, owner.privateViewKey,
    accepted.acceptance.payload.xinPrivateViewKey, accepted.acceptance.payload.xinPublicSpendKey, 0);
  const context = { version: 1, walletId: aliId, network: 'regtest', combinedAddress: combined.combinedAddress,
    counterpartyPrivateViewKey: accepted.acceptance.payload.xinPrivateViewKey, counterpartyPublicSpendKey: accepted.acceptance.payload.xinPublicSpendKey, restoreHeight: 123 };
  await vault.wallets.saveMoneroCombinedContext(context, secret);
  const saved = await vault.wallets.loadMoneroCombinedContext(context, secret);
  const ownContexts = await vault.wallets.listMoneroCombinedContexts(1, 'regtest', secret);
  assert.equal(ownContexts.length, 1);
  vault.select(1);
  const xinMaterial = await vault.wallets.unlockMoneroWallet(secret, 0, xinId);
  assert.equal(recoverCombinedWallet(owner, xinMaterial.privateSpendKey, saved, 0).address, combined.combinedAddress);
  assert.equal(vault.metaWrites, 0);
});

test('share unlock rejects other accounts, networks, genesis and passwords; no wrong-account contexts appear', async () => {
  const vault = harness();
  await vault.api.createSwapInvite(terms(), secret);
  const [share] = await vault.shares.listSwapShares(secret);
  vault.select(2);
  await assert.rejects(vault.wallets.unlockMoneroWallet(secret, 0, share.walletId), /identity and networks/);
  assert.equal((await vault.shares.listCurrentSwapShares(secret)).length, 0);
  vault.select(0);
  vault.network('mainnet');
  await assert.rejects(vault.wallets.unlockMoneroWallet(secret, 0, share.walletId), /identity and networks/);
  vault.network('regtest');
  vault.genesis(new Uint8Array(32).fill(8));
  await assert.rejects(vault.wallets.unlockMoneroWallet(secret, 0, share.walletId), /identity and networks/);
  await assert.rejects(vault.shares.unlockSwapShare(share.walletId, 'wrong-password'));
  assert.equal(vault.metaWrites, 0);
});

test('storage failure prevents returning an invite or acceptance link', async () => {
  const vault = harness();
  vault.failWrites(true);
  await assert.rejects(vault.api.createSwapInvite(terms(), secret), /quota/);
  vault.failWrites(false);
  const invite = await vault.api.createSwapInvite(terms(), secret);
  vault.select(1);
  vault.failWrites(true);
  await assert.rejects(vault.api.acceptSwapInvite(invite.link, secret), /quota/);
  vault.failWrites(false);
  assert.equal((await vault.shares.listSwapShares(secret)).length, 1);
});

test('legacy accepted agreements retain their normal-wallet path', async () => {
  const vault = harness();
  const offerPayload = handshake.canonicalOffer({ ...terms(), offerId: '12'.repeat(16), createdAt: Math.floor(Date.now() / 1000),
    algoGenesisHash: Buffer.from(new Uint8Array(32).fill(9)).toString('base64'), moneroNetwork: 'regtest',
    aliAlgoAddress: vault.accounts[0].addr.toString(), aliPublicSpendKey: vault.funding.publicSpendKey, aliPrivateViewKey: vault.funding.privateViewKey });
  const offer = { kind: 'invite', payload: offerPayload, signature: Buffer.from(ed25519.sign(handshake.handshakeSigningBytes('invite', offerPayload), vault.accounts[0].sk.slice(0, 32))).toString('hex') };
  const digest = await handshake.offerDigest(offerPayload);
  const other = monero.generateMoneroKeyMaterial();
  const acceptPayload = { offerDigest: digest, xinAlgoAddress: vault.accounts[1].addr.toString(), xinPublicSpendKey: other.publicSpendKey, xinPrivateViewKey: other.privateViewKey };
  const acceptance = { kind: 'accept', payload: acceptPayload, signature: Buffer.from(ed25519.sign(handshake.handshakeSigningBytes('accept', acceptPayload), vault.accounts[1].sk.slice(0, 32))).toString('hex') };
  const plaintext = new TextEncoder().encode(JSON.stringify({ version: 1, walletId: 1, offer, acceptance }));
  const encrypted = await seedVault.encryptSeed(plaintext, secret);
  await vault.storage.set({ [`leakswapHandshake:${offerPayload.algoGenesisHash}:${offerPayload.aliAlgoAddress}:${offerPayload.offerId}:accepted`]: {
    version: 1, ciphertext: Array.from(new Uint8Array(encrypted.encryptedSeed)), salt: Array.from(encrypted.salt), iv: Array.from(encrypted.iv)
  } });
  assert.equal(await vault.api.resolveSwapWalletId(digest, secret), 1);
  assert.equal((await vault.api.loadAcceptedSwap(digest, secret)).offer.signature, offer.signature);
  assert.equal((await vault.shares.listSwapShares(secret)).length, 0);
  assert.equal(vault.metaWrites, 0);
});

test('share inventory has no receive/send presentation and approval discloses isolated share storage', () => {
  const panel = readFileSync(new URL('../entrypoints/popup/LeakSwapPanel.tsx', import.meta.url), 'utf8');
  const inventory = panel.slice(panel.indexOf('aria-label="LeakSwap key shares"'));
  assert.match(inventory, /Offer digest/);
  assert.doesNotMatch(inventory, /Receive|Send|QRCode|privateSpendKey|privateViewKey/);
  const popup = readFileSync(new URL('../entrypoints/popup/ExternalRequestApp.tsx', import.meta.url), 'utf8');
  assert.match(popup, /creates and stores an encrypted, dedicated LeakSwap key share/);
  assert.match(popup, /normal wallet's private view key and all private spend keys stay private/);
});