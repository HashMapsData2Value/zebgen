import { browser } from 'wxt/browser';

import type {
  CreateMoneroTransactionRequest,
  CreateMoneroTransactionResult,
  MoneroDaemonProbeResult,
} from '../monero/moneroDaemon';
import type { MoneroNetworkConfig } from './networks';

// Messages exchanged between the popup and the background service worker. The
// popup uses `import type` only, so no heavy background/monero code leaks into
// the popup bundle.

export interface ProbeMoneroDaemonMessage {
  type: 'monero:probeDaemon';
  config: MoneroNetworkConfig;
}

export interface CreateMoneroTransactionMessage {
  type: 'monero:createTransaction';
  request: CreateMoneroTransactionRequest;
}

export type BackgroundMessage = ProbeMoneroDaemonMessage | CreateMoneroTransactionMessage;

export type ProbeMoneroDaemonResponse = MoneroDaemonProbeResult;

export async function probeMoneroDaemonViaBackground(
  config: MoneroNetworkConfig
): Promise<ProbeMoneroDaemonResponse> {
  const message: ProbeMoneroDaemonMessage = { type: 'monero:probeDaemon', config };
  return browser.runtime.sendMessage(message);
}

export async function createMoneroTransactionViaBackground(
  request: CreateMoneroTransactionRequest
): Promise<CreateMoneroTransactionResult> {
  const message: CreateMoneroTransactionMessage = { type: 'monero:createTransaction', request };
  return browser.runtime.sendMessage(message);
}
