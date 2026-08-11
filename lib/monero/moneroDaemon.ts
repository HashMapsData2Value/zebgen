import type { MoneroNetworkConfig } from '../network/networks';

// IMPORTANT: This module must only be imported from the background service
// worker. It dynamically imports the heavy `monero-ts` library so it is never
// pulled into the popup bundle (which breaks the MV3 popup).

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
    const monero = await import('monero-ts');
    const daemon = await monero.connectToDaemonRpc({
      uri: config.daemon.uri,
      username: config.daemon.username || undefined,
      password: config.daemon.password || undefined,
      // Run in-thread: nested workers are unavailable in an MV3 service worker.
      proxyToWorker: false,
    });
    const height = await daemon.getHeight();
    return { ok: true, height };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function createMoneroTransaction(
  request: CreateMoneroTransactionRequest
): Promise<CreateMoneroTransactionResult> {
  if (!Number.isInteger(request.restoreHeight) || request.restoreHeight < 0) {
    return { ok: false, error: 'Restore height must be a non-negative integer.' };
  }

  let wallet: Awaited<ReturnType<typeof import('monero-ts')['createWalletFull']>> | undefined;
  try {
    const amountAtomic = BigInt(request.amountAtomic);
    if (amountAtomic <= 0n) {
      return { ok: false, error: 'Amount must be greater than zero.' };
    }
    const monero = await import('monero-ts');
    wallet = await monero.createWalletFull({
      networkType: request.config.networkType,
      primaryAddress: request.primaryAddress,
      privateSpendKey: request.privateSpendKey,
      privateViewKey: request.privateViewKey,
      restoreHeight: request.restoreHeight,
      server: request.config.daemon,
      proxyToWorker: false,
    });
    await wallet.sync(request.restoreHeight);
    const balanceAtomic = await wallet.getUnlockedBalance();
    const transaction = await wallet.createTx({
      accountIndex: 0,
      address: request.recipient,
      amount: amountAtomic,
      relay: request.relay,
    });
    return {
      ok: true,
      hash: transaction.getHash(),
      feeAtomic: transaction.getFee().toString(),
      amountAtomic: transaction.getOutgoingAmount().toString(),
      balanceAtomic: balanceAtomic.toString(),
      relayed: transaction.getIsRelayed(),
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    await wallet?.close(false).catch(() => undefined);
  }
}
