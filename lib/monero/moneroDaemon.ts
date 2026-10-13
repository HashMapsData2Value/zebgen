import initMoneroWasm, {
  createTransaction,
  daemonHeight,
  primaryAddress,
  publicKeyFromPrivate,
} from 'zebgen-monero-wasm';
import moneroWasmUrl from 'zebgen-monero-wasm/zebgen_monero_wasm_bg.wasm?url';

import type { MoneroNetworkConfig } from '../network/networks';

// Background-service-worker only: scanning, signing and relaying run in the
// zebgen-monero-wasm module (monero-oxide compiled to WebAssembly).

let wasmReady: Promise<unknown> | undefined;
function loadMoneroWasm(): Promise<unknown> {
  // Explicit URL: the bundled service worker has no usable import.meta.url.
  wasmReady ??= initMoneroWasm({ module_or_path: moneroWasmUrl });
  return wasmReady;
}

function daemonConnection(config: MoneroNetworkConfig): [string, string | undefined, string | undefined] {
  return [config.daemon.uri, config.daemon.username || undefined, config.daemon.password || undefined];
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface MoneroDaemonProbeResult {
  ok: boolean;
  height?: number;
  error?: string;
}

export interface CreateMoneroTransactionRequest {
  config: MoneroNetworkConfig;
  primaryAddress: string;
  privateSpendKey: string;
  privateViewKey: string;
  recipient: string;
  amountAtomic: string;
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
}

export async function probeMoneroDaemon(
  config: MoneroNetworkConfig
): Promise<MoneroDaemonProbeResult> {
  try {
    await loadMoneroWasm();
    const height = await daemonHeight(...daemonConnection(config));
    return { ok: true, height };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function createMoneroTransaction(
  request: CreateMoneroTransactionRequest
): Promise<CreateMoneroTransactionResult> {
  if (!Number.isInteger(request.restoreHeight) || request.restoreHeight < 0) {
    return { ok: false, error: 'Restore height must be a non-negative integer.' };
  }

  try {
    const amountAtomic = BigInt(request.amountAtomic);
    if (amountAtomic <= 0n) {
      return { ok: false, error: 'Amount must be greater than zero.' };
    }
    await loadMoneroWasm();

    const derivedAddress = primaryAddress(
      request.config.networkType,
      publicKeyFromPrivate(request.privateSpendKey),
      request.privateViewKey
    );
    if (derivedAddress !== request.primaryAddress) {
      return { ok: false, error: 'Wallet keys do not match the wallet address.' };
    }

    const transaction: {
      hash: string;
      feeAtomic: string;
      amountAtomic: string;
      balanceAtomic: string;
      relayed: boolean;
    } = await createTransaction(
      ...daemonConnection(request.config),
      request.config.networkType,
      request.privateSpendKey,
      request.privateViewKey,
      request.restoreHeight,
      request.recipient,
      amountAtomic.toString(),
      request.relay
    );
    return {
      ok: true,
      hash: transaction.hash,
      feeAtomic: transaction.feeAtomic,
      amountAtomic: transaction.amountAtomic,
      balanceAtomic: transaction.balanceAtomic,
      relayed: transaction.relayed,
    };
  } catch (err) {
    console.error('createMoneroTransaction failed', err);
    return { ok: false, error: errorMessage(err) };
  }
}
