import * as moneroWasm from 'zebgen-monero-wasm';
import { createMoneroTransaction, initializeMoneroWasm, verifyMoneroNetwork } from '../monero/moneroDaemon';
import type { AlgodEndpoint, AlgorandNetworkId, MoneroNetworkConfig } from '../network/networks';
import { prepareAlgoPayment, submitAlgoPayment } from './algoWallet';
import { unlockMoneroWallet } from './moneroVault';

export type PrepareTransactionRequest = {
  primaryAddress: string;
  recipient: string;
  amountAtomic: string;
  lockSecret: string;
} & ({ chain: 'algorand'; addressIndex: number; endpoint: AlgodEndpoint; network: AlgorandNetworkId; note?: string } |
  { chain: 'monero'; walletId: number; config: MoneroNetworkConfig; restoreHeight: number; sweep: boolean });

export interface TransactionReview {
  id: string;
  hash: string;
  amountAtomic: string;
  feeAtomic: string;
  expiresAt: number;
}

export type TransactionResponse = { ok: true; review: TransactionReview } | { ok: false; error: string };

type PreparedTransaction = { review: TransactionReview; owner: string; submitting: boolean } &
  ({ chain: 'algorand'; endpoint: AlgodEndpoint; signed: Uint8Array } |
    { chain: 'monero'; config: MoneroNetworkConfig; txHex: string });

const preparedTransactions = new Map<string, PreparedTransaction>();
const generations = new Map<string, number>();
const EXPIRY_MS = 10 * 60 * 1000;

function pruneExpired() {
  for (const [id, transaction] of preparedTransactions) {
    if (!transaction.submitting && transaction.review.expiresAt <= Date.now()) preparedTransactions.delete(id);
  }
}

export function discardPreparedTransactions(owner: string) {
  generations.set(owner, (generations.get(owner) ?? 0) + 1);
  for (const [id, transaction] of preparedTransactions) {
    if (transaction.owner === owner && !transaction.submitting) preparedTransactions.delete(id);
  }
}

type RelayFunction = (url: string, username: string | undefined, password: string | undefined, txHex: string) => Promise<string>;

function relayFunction(): RelayFunction {
  const relay = (moneroWasm as unknown as { relayTransaction?: RelayFunction }).relayTransaction;
  if (!relay) throw new Error('The installed Monero WASM library needs the relayTransaction update.');
  return relay;
}

export async function prepareTransaction(owner: string, request: PrepareTransactionRequest): Promise<TransactionResponse> {
  pruneExpired();
  if ([...preparedTransactions.values()].some((transaction) => transaction.owner === owner && transaction.submitting)) {
    return { ok: false, error: 'A transaction is already being broadcast.' };
  }
  discardPreparedTransactions(owner);
  const generation = generations.get(owner);
  try {
    let prepared: PreparedTransaction;
    const id = crypto.randomUUID();
    const expiresAt = Date.now() + EXPIRY_MS;
    if (request.chain === 'algorand') {
      const transaction = await prepareAlgoPayment(request.lockSecret, request.addressIndex,
        request.recipient, BigInt(request.amountAtomic), request.endpoint, request.note, request.network);
      if (transaction.sender !== request.primaryAddress) throw new Error('Sender account changed. Prepare the transaction again.');
      prepared = { chain: 'algorand', owner, submitting: false, endpoint: request.endpoint, signed: transaction.signed,
        review: { id, hash: transaction.txId, amountAtomic: request.amountAtomic, feeAtomic: transaction.feeMicroAlgos.toString(), expiresAt } };
    } else {
      relayFunction();
      const material = await unlockMoneroWallet(request.lockSecret, request.config.networkType, request.walletId);
      if (!material || material.address !== request.primaryAddress) throw new Error('Sender wallet changed. Prepare the transaction again.');
      const transaction = await createMoneroTransaction({ ...request, privateSpendKey: material.privateSpendKey,
        privateViewKey: material.privateViewKey, relay: false });
      if (!transaction.ok || !transaction.txHex || !transaction.hash || !transaction.amountAtomic || !transaction.feeAtomic) {
        throw new Error(transaction.error ?? 'Unable to prepare Monero transaction.');
      }
      prepared = { chain: 'monero', owner, submitting: false, config: request.config, txHex: transaction.txHex,
        review: { id, hash: transaction.hash, amountAtomic: transaction.amountAtomic, feeAtomic: transaction.feeAtomic, expiresAt } };
    }
    if (generations.get(owner) !== generation) throw new Error('Transaction preparation was cancelled.');
    prepared.review.expiresAt = Date.now() + EXPIRY_MS;
    preparedTransactions.set(id, prepared);
    return { ok: true, review: prepared.review };
  } catch (error) {
    console.error('Transaction preparation failed', error);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function submitPreparedTransaction(owner: string, id: string): Promise<TransactionResponse> {
  pruneExpired();
  const transaction = preparedTransactions.get(id);
  if (!transaction || transaction.owner !== owner) return { ok: false, error: 'Transaction expired or was cancelled. Review it again.' };
  if (transaction.submitting) return { ok: false, error: 'Transaction is already being broadcast.' };
  transaction.submitting = true;
  try {
    let hash: string;
    if (transaction.chain === 'algorand') {
      hash = await submitAlgoPayment(transaction.endpoint, transaction.signed);
    } else {
      await initializeMoneroWasm();
      await verifyMoneroNetwork(transaction.config);
      const daemon = transaction.config.daemon;
      hash = await relayFunction()(daemon.uri, daemon.username || undefined, daemon.password || undefined, transaction.txHex);
    }
    if (hash !== transaction.review.hash) throw new Error('Daemon returned an unexpected transaction hash. Check the reviewed transaction before retrying.');
    preparedTransactions.delete(id);
    return { ok: true, review: transaction.review };
  } catch (error) {
    console.error('Transaction broadcast failed', error);
    transaction.submitting = false;
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}