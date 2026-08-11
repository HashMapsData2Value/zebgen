import { hexToBytes } from '@noble/hashes/utils.js';

import {
  addMoneroKeyRecord,
  getAllMoneroKeyRecords,
  getMoneroKeyRecord,
  getWalletMeta,
  setWalletMeta,
} from './db';
import { unlockWallet } from './algoWallet';
import {
  getMoneroKeyMaterialFromPrivateSpendKey,
  type MoneroKeyMaterial,
  type MoneroNetworkType,
} from './moneroWallet';
import { decryptSeed, encryptSeed } from './seedVault';

export interface MoneroWalletSummary {
  id: number;
  address: string;
  createdAt: string;
}

export interface MoneroWalletState {
  wallets: MoneroWalletSummary[];
  activeWalletId: number | null;
}

export async function getMoneroWalletState(): Promise<MoneroWalletState> {
  const meta = await getWalletMeta();
  const records = await getAllMoneroKeyRecords();
  const wallets = records.flatMap((record) =>
    record.id === undefined
      ? []
      : [{ id: record.id, address: record.address, createdAt: record.createdAt }]
  );
  const activeWalletId = wallets.some((wallet) => wallet.id === meta?.activeMoneroKeyId)
    ? meta?.activeMoneroKeyId ?? null
    : wallets[0]?.id ?? null;

  return {
    wallets,
    activeWalletId,
  };
}

export async function saveMoneroWallet(
  material: MoneroKeyMaterial,
  lockSecret: string
): Promise<number> {
  await unlockWallet(lockSecret);
  const privateSpendKeyBytes = hexToBytes(material.privateSpendKey);

  try {
    const vault = await encryptSeed(privateSpendKeyBytes, lockSecret);
    const activeMoneroKeyId = await addMoneroKeyRecord({
      encryptedPrivateSpendKey: vault.encryptedSeed,
      salt: vault.salt,
      iv: vault.iv,
      address: material.address,
      createdAt: new Date().toISOString(),
    });
    const meta = await getWalletMeta();
    if (!meta) {
      throw new Error('Wallet metadata is unavailable.');
    }
    await setWalletMeta({
      ...meta,
      activeMoneroKeyId,
      moneroAddress: material.address,
    });
    return activeMoneroKeyId;
  } finally {
    privateSpendKeyBytes.fill(0);
  }
}

export async function unlockMoneroWallet(
  lockSecret: string,
  networkType: MoneroNetworkType,
  walletId?: number
): Promise<MoneroKeyMaterial | null> {
  await unlockWallet(lockSecret);
  const meta = await getWalletMeta();
  const activeMoneroKeyId = walletId ?? meta?.activeMoneroKeyId;
  if (!activeMoneroKeyId) {
    return null;
  }

  const record = await getMoneroKeyRecord(activeMoneroKeyId);
  if (!record) {
    throw new Error('Active Monero key record not found.');
  }

  const decrypted = await decryptSeed(
    record.encryptedPrivateSpendKey,
    lockSecret,
    record.salt,
    record.iv
  );
  try {
    const material = getMoneroKeyMaterialFromPrivateSpendKey(
      Array.from(decrypted, (byte) => byte.toString(16).padStart(2, '0')).join(''),
      networkType
    );
    if (meta && meta.activeMoneroKeyId !== activeMoneroKeyId) {
      await setWalletMeta({
        ...meta,
        activeMoneroKeyId,
        moneroAddress: material.address,
      });
    }
    return material;
  } finally {
    decrypted.fill(0);
  }
}