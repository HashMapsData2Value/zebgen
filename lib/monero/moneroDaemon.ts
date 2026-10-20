import initMoneroWasm, {
  createTransaction,
  daemonHeight,
  primaryAddress,
  publicKeyFromPrivate,
  scanBalanceBatch,
  sweepTransaction,
} from 'zebgen-monero-wasm';
import moneroWasmUrl from 'zebgen-monero-wasm/zebgen_monero_wasm_bg.wasm?url&no-inline';
import * as moneroWasm from 'zebgen-monero-wasm';

import { networkLabel, type MoneroNetworkConfig } from '../network/networks';
import { unlockMoneroWallet } from '../wallet/moneroVault';
import { balanceCheckpointKey, saveBalanceCheckpoint } from '../wallet/moneroBalanceCache';
import { loadScanCheckpoint, saveScanCheckpoint } from '../wallet/moneroScanCheckpoint';
import { setMoneroScanRestoreHeight } from '../wallet/db';

let wasmReady: Promise<unknown> | undefined;
let diagnosticMemory: WebAssembly.Memory | undefined;
function loadMoneroWasm(): Promise<unknown> {
  // Explicit URL: the bundled service worker has no usable import.meta.url.
  wasmReady ??= initMoneroWasm({ module_or_path: moneroWasmUrl }).then((module) => {
    if (import.meta.env.MODE === 'e2e') {
      (
        moneroWasm as unknown as { setDiagnosticsEnabled?: (enabled: boolean) => void }
      ).setDiagnosticsEnabled?.(true);
      diagnosticMemory = module.memory;
    }
    return module;
  });
  return wasmReady;
}

export const initializeMoneroWasm = loadMoneroWasm;

export interface MoneroFundingResult {
  receivedAtomic: string;
  matureAtomic: string;
  lockedAtomic: string;
  scannedHeight: number;
  spentStatusKnown: false;
}

export interface MoneroFundingControl {
  signal?: AbortSignal;
  onProgress?: (progress: { scannedHeight: number; targetHeight: number; startHeight?: number }) => void;
}

export async function scanMoneroFunding(
  config: MoneroNetworkConfig,
  publicSpendKey: string,
  privateViewKey: string,
  restoreHeight: number,
  control?: MoneroFundingControl,
): Promise<MoneroFundingResult> {
  if (!Number.isInteger(restoreHeight) || restoreHeight < 0 || restoreHeight > 0xffffffff) {
    throw new Error('Restore height must be a u32 integer.');
  }
  await verifyMoneroNetwork(config);
  control?.signal?.throwIfAborted();
  const scan = (
    moneroWasm as unknown as {
      scanFunding?: (
        url: string,
        user: string | undefined,
        pass: string | undefined,
        publicSpendKey: string,
        privateViewKey: string,
        restoreHeight: number,
        control?: MoneroFundingControl,
      ) => Promise<MoneroFundingResult>;
    }
  ).scanFunding;
  if (!scan)
    throw new Error('The Monero WASM library needs the scanFunding update to check funding.');
  control?.signal?.throwIfAborted();
  if (control?.onProgress) {
    const targetHeight = await daemonHeight(...daemonConnection(config));
    control.signal?.throwIfAborted();
    control.onProgress({ scannedHeight: restoreHeight, targetHeight, startHeight: restoreHeight });
  }
  const result = await scan(
    ...daemonConnection(config),
    publicSpendKey,
    privateViewKey,
    restoreHeight,
    control ? {
      ...control,
      onProgress: (progress) => control.onProgress?.({ ...progress, startHeight: restoreHeight }),
    } : undefined,
  );
  return {
    receivedAtomic: result.receivedAtomic,
    matureAtomic: result.matureAtomic,
    lockedAtomic: result.lockedAtomic,
    scannedHeight: result.scannedHeight,
    spentStatusKnown: false,
  };
}

export async function verifyMoneroNetwork(config: MoneroNetworkConfig): Promise<string> {
  await loadMoneroWasm();
  const detect = (
    moneroWasm as unknown as {
      daemonNetwork?: (url: string, username?: string, password?: string) => Promise<string>;
    }
  ).daemonNetwork;
  if (!detect)
    throw new Error(
      'The Monero WASM library needs the daemonNetwork update to verify the connected chain.',
    );
  const actual = await detect(...daemonConnection(config));
  if (actual !== config.network)
    throw new Error(
      `Network mismatch: selected ${networkLabel(config.network)}, daemon reports ${networkLabel(actual)}. Select the matching network in Settings.`,
    );
  if (
    actual === 'regtest' &&
    !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(config.daemon.uri).hostname)
  ) {
    throw new Error('Local Regtest requires a loopback daemon endpoint.');
  }
  return actual;
}

function daemonConnection(
  config: MoneroNetworkConfig,
): [string, string | undefined, string | undefined] {
  return [
    config.daemon.uri,
    config.daemon.username || undefined,
    config.daemon.password || undefined,
  ];
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface MoneroDaemonProbeResult {
  ok: boolean;
  height?: number;
  error?: string;
  network?: string;
}

export interface ScanMoneroBalanceRequest {
  config: MoneroNetworkConfig;
  walletId: number;
  lockSecret: string;
  primaryAddress: string;
  restoreHeight: number;
}

export interface ScanMoneroBalanceResult {
  ok: boolean;
  balanceAtomic?: string;
  error?: string;
}

export async function scanMoneroBalance(
  request: ScanMoneroBalanceRequest,
  control?: MoneroFundingControl,
): Promise<ScanMoneroBalanceResult> {
  try {
    control?.signal?.throwIfAborted();
    await verifyMoneroNetwork(request.config);
    control?.signal?.throwIfAborted();
    if (diagnosticMemory)
      console.log('[monero-wasm] balance memory before scan:', diagnosticMemory.buffer.byteLength);
    if (
      !Number.isSafeInteger(request.restoreHeight) ||
      request.restoreHeight < 0 ||
      request.restoreHeight > 0xffffffff
    ) {
      throw new Error('Restore height must be a non-negative integer.');
    }
    const material = await unlockMoneroWallet(
      request.lockSecret,
      request.config.networkType,
      request.walletId,
    );
    control?.signal?.throwIfAborted();
    if (!material || material.address !== request.primaryAddress)
      throw new Error('Wallet address changed. Refresh the wallet and try again.');
    const currentHeight = await daemonHeight(...daemonConnection(request.config));
    if (request.restoreHeight > currentHeight)
      throw new Error('Restore height is beyond the daemon height.');
    if (request.walletId >= 0)
      await setMoneroScanRestoreHeight(
        request.walletId,
        request.config.network,
        request.restoreHeight,
      );
    await loadMoneroWasm();
    const identity = balanceCheckpointKey(
      request.config.network,
      request.config.daemon.uri,
      request.primaryAddress,
      request.restoreHeight,
    );
    let checkpoint = await loadScanCheckpoint(identity, request.lockSecret);
    let balanceAtomic = '0';
    for (;;) {
      control?.signal?.throwIfAborted();
      const result = JSON.parse(
        await scanBalanceBatch(
          ...daemonConnection(request.config),
          material.privateSpendKey,
          material.privateViewKey,
          request.restoreHeight,
          checkpoint === undefined ? undefined : JSON.stringify(checkpoint),
          { signal: control?.signal },
        ),
      );
      if (
        !Number.isSafeInteger(result.scannedHeight) ||
        !Number.isSafeInteger(result.targetHeight) ||
        typeof result.done !== 'boolean' ||
        typeof result.balanceAtomic !== 'string' ||
        !/^\d+$/.test(result.balanceAtomic)
      )
        throw new Error('Invalid Monero scan batch result.');
      await saveScanCheckpoint(identity, result.checkpoint, request.lockSecret);
      checkpoint = result.checkpoint;
      control?.onProgress?.({
        scannedHeight: result.scannedHeight,
        targetHeight: result.targetHeight,
      });
      if (result.done) {
        balanceAtomic = result.balanceAtomic;
        await saveBalanceCheckpoint(
          identity,
          {
            balanceAtomic,
            scannedHeight: result.scannedHeight,
            scannedAt: Date.now(),
            resumable: true,
          },
          request.lockSecret,
        );
        break;
      }
    }
    control?.signal?.throwIfAborted();
    if (diagnosticMemory)
      console.log('[monero-wasm] balance memory after scan:', diagnosticMemory.buffer.byteLength);
    return { ok: true, balanceAtomic };
  } catch (error) {
    console.error('scanMoneroBalance failed', error);
    return { ok: false, error: errorMessage(error) };
  }
}

export interface CreateMoneroTransactionRequest {
  config: MoneroNetworkConfig;
  primaryAddress: string;
  privateSpendKey: string;
  privateViewKey: string;
  recipient: string;
  // Ignored when `sweep` is true.
  amountAtomic: string;
  // Send the whole unlocked balance minus the fee.
  sweep?: boolean;
  restoreHeight: number;
  relay: boolean;
}

export interface CreateMoneroTransactionResult {
  ok: boolean;
  hash?: string;
  feeAtomic?: string;
  amountAtomic?: string;
  balanceAtomic?: string;
  relayed?: boolean;
  error?: string;
  txHex?: string;
}

export async function probeMoneroDaemon(
  config: MoneroNetworkConfig,
): Promise<MoneroDaemonProbeResult> {
  try {
    const network = await verifyMoneroNetwork(config);
    const height = await daemonHeight(...daemonConnection(config));
    return { ok: true, height, network };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function createMoneroTransaction(
  request: CreateMoneroTransactionRequest,
): Promise<CreateMoneroTransactionResult> {
  if (!Number.isInteger(request.restoreHeight) || request.restoreHeight < 0) {
    return { ok: false, error: 'Restore height must be a non-negative integer.' };
  }

  try {
    await verifyMoneroNetwork(request.config);
    const amountAtomic = request.sweep ? 0n : BigInt(request.amountAtomic);
    if (!request.sweep && amountAtomic <= 0n) {
      return { ok: false, error: 'Amount must be greater than zero.' };
    }
    await loadMoneroWasm();

    const derivedAddress = primaryAddress(
      request.config.networkType,
      publicKeyFromPrivate(request.privateSpendKey),
      request.privateViewKey,
    );
    if (derivedAddress !== request.primaryAddress) {
      return { ok: false, error: 'Wallet keys do not match the wallet address.' };
    }

    const wallet = [
      ...daemonConnection(request.config),
      request.config.networkType,
      request.privateSpendKey,
      request.privateViewKey,
      request.restoreHeight,
      request.recipient,
    ] as const;
    const transaction: {
      hash: string;
      feeAtomic: string;
      amountAtomic: string;
      balanceAtomic: string;
      relayed: boolean;
      txHex: string;
    } = request.sweep
      ? await sweepTransaction(...wallet, request.relay)
      : await createTransaction(...wallet, amountAtomic.toString(), request.relay);
    return {
      ok: true,
      hash: transaction.hash,
      feeAtomic: transaction.feeAtomic,
      amountAtomic: transaction.amountAtomic,
      balanceAtomic: transaction.balanceAtomic,
      relayed: transaction.relayed,
      txHex: transaction.txHex,
    };
  } catch (err) {
    console.error('createMoneroTransaction failed', err);
    return { ok: false, error: errorMessage(err) };
  }
}
