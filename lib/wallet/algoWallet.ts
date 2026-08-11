import { fromSeed, KeyContext, XHDWalletAPI } from '@algorandfoundation/xhd-wallet-api';
import * as bip39 from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import algosdk from 'algosdk';

import {
  addSeedRecord,
  getAllSeedRecords,
  getSeedRecord,
  getWalletMeta,
  setWalletMeta,
  type WalletMeta,
} from './db';
import { constantTimeEqual, decryptSeed, deriveLockVerifier, encryptSeed } from './seedVault';
import { createAlgodClient } from '../algorand/algodClient';
import type { AlgodEndpoint } from '../network/networks';

export interface SignedInState {
  isSignedIn: boolean;
  algoAddress: string | null;
}

export const ALGO_DERIVATION_PATH_PREFIX = "m/44'/283'/0'/0";

const EMPTY_META: WalletMeta = {
  activeSeedId: null,
  algoAddress: null,
};

export async function derivePrimaryAlgoAddressFromMnemonic(mnemonic: string) {
  return deriveAlgoAddressFromMnemonicAtIndex(mnemonic, 0);
}

export async function deriveAlgoAddressFromMnemonicAtIndex(
  mnemonic: string,
  addressIndex: number
) {
  if (!Number.isInteger(addressIndex) || addressIndex < 0) {
    throw new Error('Address index must be a non-negative integer.');
  }

  const normalized = normalizeMnemonic(mnemonic);
  const isValid = bip39.validateMnemonic(normalized, wordlist);
  if (!isValid) {
    throw new Error('Invalid BIP39 mnemonic.');
  }

  const seed = asSeedBytes(bip39.mnemonicToSeedSync(normalized));
  const rootKey = fromSeed(seed as unknown as Buffer);
  const xhd = new XHDWalletAPI();

  try {
    const publicKey = await xhd.keyGen(rootKey, KeyContext.Address, 0, addressIndex);
    return new algosdk.Address(publicKey).toString();
  } finally {
    seed.fill(0);
    rootKey.fill(0);
  }
}

export function getAlgoDerivationPath(addressIndex: number) {
  return `${ALGO_DERIVATION_PATH_PREFIX}/${addressIndex}`;
}

export async function importAlgoMnemonic(mnemonic: string, lockSecret: string) {
  if (!lockSecret.trim()) {
    throw new Error('Unlock with your password or PIN first.');
  }

  const lockMeta = await getWalletMeta();
  if (!lockMeta?.lockSalt || !lockMeta.lockVerifier) {
    throw new Error('Set a wallet password or PIN first.');
  }

  const isValid = await verifyWalletLock(lockSecret, lockMeta.lockSalt, lockMeta.lockVerifier);
  if (!isValid) {
    throw new Error('Invalid wallet password or PIN.');
  }

  const normalized = normalizeMnemonic(mnemonic);
  const seed = asSeedBytes(bip39.mnemonicToSeedSync(normalized));
  const algoAddress = await derivePrimaryAlgoAddressFromMnemonic(normalized);

  const mnemonicBytes = new TextEncoder().encode(normalized);
  try {
    const seedVault = await encryptSeed(seed, lockSecret);
    const mnemonicVault = await encryptSeed(mnemonicBytes, lockSecret);
    const activeSeedId = await addSeedRecord({
      encryptedSeed: seedVault.encryptedSeed,
      salt: seedVault.salt,
      iv: seedVault.iv,
      encryptedMnemonic: mnemonicVault.encryptedSeed,
      mnemonicSalt: mnemonicVault.salt,
      mnemonicIv: mnemonicVault.iv,
      algoAddress,
      createdAt: new Date().toISOString(),
    });

    const meta: WalletMeta = {
      ...(lockMeta ?? EMPTY_META),
      activeSeedId,
      algoAddress,
    };

    await setWalletMeta(meta);
    return { activeSeedId, algoAddress };
  } finally {
    seed.fill(0);
    mnemonicBytes.fill(0);
  }
}

export async function getSignedInState(): Promise<SignedInState> {
  const meta = await getWalletMeta();
  if (meta?.activeSeedId && meta.algoAddress) {
    return { isSignedIn: true, algoAddress: meta.algoAddress };
  }

  const seeds = await getAllSeedRecords();
  if (seeds.length === 0) {
    return { isSignedIn: false, algoAddress: null };
  }

  const firstSeed = seeds[0];
  await setWalletMeta({
    ...(meta ?? EMPTY_META),
    activeSeedId: firstSeed.id ?? 1,
    algoAddress: firstSeed.algoAddress,
  });

  return {
    isSignedIn: true,
    algoAddress: firstSeed.algoAddress,
  };
}

export async function getWalletLockState(): Promise<{ isConfigured: boolean }> {
  const meta = await getWalletMeta();
  return {
    isConfigured: Boolean(meta?.lockSalt && meta.lockVerifier),
  };
}

export async function createWalletLock(lockSecret: string): Promise<void> {
  if (lockSecret.trim().length < 4) {
    throw new Error('Use at least 4 characters for your password or PIN.');
  }

  const meta = (await getWalletMeta()) ?? EMPTY_META;
  if (meta.lockSalt && meta.lockVerifier) {
    throw new Error('Wallet password or PIN is already configured.');
  }

  const lockSalt = crypto.getRandomValues(new Uint8Array(16));
  const lockVerifier = await deriveLockVerifier(lockSecret, lockSalt);

  await setWalletMeta({
    ...meta,
    lockSalt,
    lockVerifier,
  });
}

export async function unlockWallet(lockSecret: string): Promise<{ algoAddress: string | null }> {
  if (!lockSecret.trim()) {
    throw new Error('Password or PIN is required.');
  }

  const meta = await getWalletMeta();
  if (!meta?.lockSalt || !meta.lockVerifier) {
    throw new Error('Set a wallet password or PIN first.');
  }

  const isValid = await verifyWalletLock(lockSecret, meta.lockSalt, meta.lockVerifier);
  if (!isValid) {
    throw new Error('Invalid wallet password or PIN.');
  }

  return { algoAddress: meta.algoAddress ?? null };
}

export async function deriveActiveSeedAlgoAddressAtIndex(
  lockSecret: string,
  addressIndex: number
) {
  if (!Number.isInteger(addressIndex) || addressIndex < 0) {
    throw new Error('Address index must be a non-negative integer.');
  }

  if (!lockSecret.trim()) {
    throw new Error('Unlock with your password or PIN first.');
  }

  const meta = await getWalletMeta();
  if (!meta?.activeSeedId) {
    throw new Error('No active seed found.');
  }

  const seedRecord = await getSeedRecord(meta.activeSeedId);
  if (!seedRecord) {
    throw new Error('Active seed record not found.');
  }

  const decryptedSeed = await decryptSeed(
    seedRecord.encryptedSeed,
    lockSecret,
    seedRecord.salt,
    seedRecord.iv
  );

  try {
    const rootKey = fromSeed(decryptedSeed as unknown as Buffer);
    const xhd = new XHDWalletAPI();
    const publicKey = await xhd.keyGen(rootKey, KeyContext.Address, 0, addressIndex);
    const algoAddress = new algosdk.Address(publicKey).toString();
    rootKey.fill(0);

    return {
      algoAddress,
      addressIndex,
      derivationPath: getAlgoDerivationPath(addressIndex),
    };
  } finally {
    decryptedSeed.fill(0);
  }
}

export async function sendAlgoPayment(
  lockSecret: string,
  addressIndex: number,
  receiver: string,
  amountMicroAlgos: bigint,
  endpoint: AlgodEndpoint,
  note?: string
): Promise<{ txId: string; feeMicroAlgos: bigint }> {
  if (!algosdk.isValidAddress(receiver)) {
    throw new Error('Enter a valid Algorand recipient address.');
  }
  if (amountMicroAlgos <= 0n) {
    throw new Error('Amount must be greater than zero.');
  }
  if (!Number.isInteger(addressIndex) || addressIndex < 0) {
    throw new Error('Address index must be a non-negative integer.');
  }

  await unlockWallet(lockSecret);
  const meta = await getWalletMeta();
  if (!meta?.activeSeedId) {
    throw new Error('No active seed found.');
  }
  const seedRecord = await getSeedRecord(meta.activeSeedId);
  if (!seedRecord) {
    throw new Error('Active seed record not found.');
  }

  const decryptedSeed = await decryptSeed(
    seedRecord.encryptedSeed,
    lockSecret,
    seedRecord.salt,
    seedRecord.iv
  );
  try {
    const rootKey = fromSeed(decryptedSeed as unknown as Buffer);
    try {
      const xhd = new XHDWalletAPI();
      const senderPublicKey = await xhd.keyGen(rootKey, KeyContext.Address, 0, addressIndex);
      const sender = new algosdk.Address(senderPublicKey).toString();
      const algod = createAlgodClient(endpoint);
      const suggestedParams = await algod.getTransactionParams().do();
      const transaction = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        sender,
        receiver,
        amount: amountMicroAlgos,
        note: note?.trim() ? new TextEncoder().encode(note.trim()) : undefined,
        suggestedParams,
      });
      const signature = await xhd.signAlgoTransaction(
        rootKey,
        KeyContext.Address,
        0,
        addressIndex,
        transaction.bytesToSign()
      );
      const signed = transaction.attachSignature(sender, signature);
      const submitted = await algod.sendRawTransaction(signed).do();
      return { txId: submitted.txid, feeMicroAlgos: transaction.fee };
    } finally {
      rootKey.fill(0);
    }
  } finally {
    decryptedSeed.fill(0);
  }
}

// Generic Algorand transaction signing primitive: decodes each unsigned
// transaction, signs it for the active seed's account at `addressIndex`, and
// returns the fully signed transaction bytes in the same order. Used by the
// Zebgen provider bridge's `signAlgorandTransactions` request so that pages
// can drive arbitrary contract calls (e.g. LeakSwap) without zebgen needing
// any knowledge of a particular contract's ABI - it only ever signs bytes it
// is explicitly asked to sign, behind the popup-approval flow.
export async function signRawTransactions(
  lockSecret: string,
  addressIndex: number,
  unsignedTxns: Uint8Array[]
): Promise<Uint8Array[]> {
  if (!Number.isInteger(addressIndex) || addressIndex < 0) {
    throw new Error('Address index must be a non-negative integer.');
  }
  if (unsignedTxns.length === 0) {
    return [];
  }

  await unlockWallet(lockSecret);
  const meta = await getWalletMeta();
  if (!meta?.activeSeedId) {
    throw new Error('No active seed found.');
  }
  const seedRecord = await getSeedRecord(meta.activeSeedId);
  if (!seedRecord) {
    throw new Error('Active seed record not found.');
  }

  const decryptedSeed = await decryptSeed(
    seedRecord.encryptedSeed,
    lockSecret,
    seedRecord.salt,
    seedRecord.iv
  );
  try {
    const rootKey = fromSeed(decryptedSeed as unknown as Buffer);
    try {
      const xhd = new XHDWalletAPI();
      const senderPublicKey = await xhd.keyGen(rootKey, KeyContext.Address, 0, addressIndex);
      const sender = new algosdk.Address(senderPublicKey).toString();

      const signed: Uint8Array[] = [];
      for (const unsignedTxnBytes of unsignedTxns) {
        const transaction = algosdk.decodeUnsignedTransaction(unsignedTxnBytes);
        const signature = await xhd.signAlgoTransaction(
          rootKey,
          KeyContext.Address,
          0,
          addressIndex,
          transaction.bytesToSign()
        );
        signed.push(transaction.attachSignature(sender, signature));
      }
      return signed;
    } finally {
      rootKey.fill(0);
    }
  } finally {
    decryptedSeed.fill(0);
  }
}

export async function revealActiveSeedMnemonic(lockSecret: string): Promise<string> {
  if (!lockSecret.trim()) {
    throw new Error('Password or PIN is required.');
  }

  const meta = await getWalletMeta();
  if (!meta?.lockSalt || !meta.lockVerifier) {
    throw new Error('Set a wallet password or PIN first.');
  }

  const isValid = await verifyWalletLock(lockSecret, meta.lockSalt, meta.lockVerifier);
  if (!isValid) {
    throw new Error('Invalid wallet password or PIN.');
  }

  if (!meta.activeSeedId) {
    throw new Error('No active seed found.');
  }

  const seedRecord = await getSeedRecord(meta.activeSeedId);
  if (!seedRecord) {
    throw new Error('Active seed record not found.');
  }

  if (!seedRecord.encryptedMnemonic || !seedRecord.mnemonicSalt || !seedRecord.mnemonicIv) {
    throw new Error('Recovery phrase is unavailable. Reinstall the wallet to generate a new one.');
  }

  const decrypted = await decryptSeed(
    seedRecord.encryptedMnemonic,
    lockSecret,
    seedRecord.mnemonicSalt,
    seedRecord.mnemonicIv
  );

  try {
    return new TextDecoder().decode(decrypted);
  } finally {
    decrypted.fill(0);
  }
}

function normalizeMnemonic(mnemonic: string) {
  return mnemonic.trim().toLowerCase().split(/\s+/).join(' ');
}

function asSeedBytes(seed: Uint8Array): Uint8Array {
  return new Uint8Array(
    seed.buffer.slice(seed.byteOffset, seed.byteOffset + seed.byteLength)
  );
}

async function verifyWalletLock(
  lockSecret: string,
  lockSalt: Uint8Array,
  lockVerifier: Uint8Array
) {
  const candidate = await deriveLockVerifier(lockSecret, lockSalt);
  return constantTimeEqual(candidate, lockVerifier);
}