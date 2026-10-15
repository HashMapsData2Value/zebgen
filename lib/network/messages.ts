import { browser } from 'wxt/browser';

import type {
  MoneroDaemonProbeResult,
  ScanMoneroBalanceRequest,
  ScanMoneroBalanceResult,
} from '../monero/moneroDaemon';
import type { MoneroNetworkConfig } from './networks';
import type { PrepareTransactionRequest, TransactionResponse } from '../wallet/transactionService';

// Messages exchanged between the popup and the background service worker. The
// popup uses `import type` only, so no heavy background/monero code leaks into
// the popup bundle.

export interface ProbeMoneroDaemonMessage {
  type: 'monero:probeDaemon';
  config: MoneroNetworkConfig;
}

export interface ScanMoneroBalanceMessage {
  type: 'monero:scanBalance';
  request: ScanMoneroBalanceRequest;
}

export type BackgroundMessage = ProbeMoneroDaemonMessage | ScanMoneroBalanceMessage |
  { type: 'wallet:prepareTransaction'; request: PrepareTransactionRequest } |
  { type: 'wallet:submitTransaction'; id: string } |
  { type: 'wallet:discardTransactions' };

export function prepareTransactionViaBackground(request: PrepareTransactionRequest): Promise<TransactionResponse> {
  return browser.runtime.sendMessage({ type: 'wallet:prepareTransaction', request });
}

export function submitTransactionViaBackground(id: string): Promise<TransactionResponse> {
  return browser.runtime.sendMessage({ type: 'wallet:submitTransaction', id });
}

export function discardTransactionsViaBackground(): Promise<unknown> {
  return browser.runtime.sendMessage({ type: 'wallet:discardTransactions' });
}

export async function scanMoneroBalanceViaBackground(request: ScanMoneroBalanceRequest): Promise<ScanMoneroBalanceResult> {
  const message: ScanMoneroBalanceMessage = { type: 'monero:scanBalance', request };
  return browser.runtime.sendMessage(message);
}
export type ProbeMoneroDaemonResponse = MoneroDaemonProbeResult;

export async function probeMoneroDaemonViaBackground(
  config: MoneroNetworkConfig
): Promise<ProbeMoneroDaemonResponse> {
  const message: ProbeMoneroDaemonMessage = { type: 'monero:probeDaemon', config };
  return browser.runtime.sendMessage(message);
}

