import { browser } from 'wxt/browser';

import { probeMoneroDaemon, scanMoneroBalance } from '../lib/monero/moneroDaemon';
import type { BackgroundMessage } from '../lib/network/messages';
import { approveOrigin, isOriginApproved } from '../lib/provider/originApproval';
import { approveConnection, assertConnectionAccounts, connectedAccounts, publicConnectionAccounts, type ConnectionAccounts } from '../lib/provider/connectionApproval';
import { activateConnectionSelection } from '../lib/provider/connectionSelection';
import { validateProviderRequest } from '../lib/provider/fundingValidation';
import type {
  PendingRequestMessage,
  PendingZebgenRequest,
  ZebgenBackgroundRequest,
  ZebgenBackgroundResponse,
  ZebgenDepositLeakSwapMoneroParams,
  ZebgenDepositLeakSwapMoneroResult,
} from '../lib/provider/types';
import { discardPreparedTransactions, prepareTransaction, submitPreparedTransaction, isSubmittedDepositResult } from '../lib/wallet/transactionService';
import { readTransactionStatus } from '../lib/wallet/transactionStatus';

// Requests parked while an approval popup window is open, waiting on the
// user. Module-level state is fine here: an in-flight async onMessage
// listener keeps the MV3 service worker alive until sendResponse fires.
const pendingRequests = new Map<string, PendingZebgenRequest & { connectionAccounts?: ConnectionAccounts }>();
const pendingResolvers = new Map<string, (response: ZebgenBackgroundResponse) => void>();

export default defineBackground(() => {
  browser.runtime.onConnect.addListener(port => {
    if (port.name !== 'monero:balanceScan') return;
    const sender = port.sender;
    if (sender?.id !== browser.runtime.id || !sender.url?.startsWith(browser.runtime.getURL('/'))) {
      port.disconnect();
      return;
    }
    const controller = new AbortController();
    let started = false;
    port.onDisconnect.addListener(() => controller.abort());
    port.onMessage.addListener(message => {
      if (message?.type === 'keepalive') return;
      if (started || controller.signal.aborted) return;
      started = true;
      void scanMoneroBalance(message.request, {
        signal: controller.signal,
        onProgress: progress => { if (!controller.signal.aborted) port.postMessage({ type: 'progress', progress }); },
      }).then(result => {
        if (!controller.signal.aborted) port.postMessage({ type: 'result', result });
      }).catch(error => {
        console.error('Balance scan connection failed', error);
        if (!controller.signal.aborted) port.postMessage({ type: 'result', result: errorResponse(error) });
      });
    });
  });
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const internalSender = sender.id === browser.runtime.id && Boolean(sender.url?.startsWith(browser.runtime.getURL('/')));
    if (isProviderRequest(message)) {
      handleProviderRequest(message).then(sendResponse);
      return true;
    }
    if (isPendingRequestMessage(message)) {
      if (!internalSender) return false;
      handlePendingRequestMessage(message).then(sendResponse);
      return true;
    }

    const backgroundMessage = message as BackgroundMessage;
    if (!internalSender) {
      return false;
    }
    const owner = `${sender.documentId ?? sender.tab?.id ?? 'popup'}:${sender.url}`;
    if (backgroundMessage?.type === 'wallet:transactionStatus') {
      readTransactionStatus(backgroundMessage.request).then(status => sendResponse({ ok: true, status })).catch(error => {
        console.error('Transaction status lookup failed', error);
        sendResponse(errorResponse(error));
      });
      return true;
    }
    if (backgroundMessage?.type === 'wallet:prepareTransaction') {
      prepareTransaction(owner, backgroundMessage.request).then(sendResponse).catch((error) => sendResponse(errorResponse(error)));
      return true;
    }
    if (backgroundMessage?.type === 'wallet:submitTransaction') {
      submitPreparedTransaction(owner, backgroundMessage.id, backgroundMessage.lockSecret).then(sendResponse).catch((error) => sendResponse(errorResponse(error)));
      return true;
    }
    if (backgroundMessage?.type === 'wallet:discardTransactions') {
      discardPreparedTransactions(owner);
      sendResponse({ ok: true });
      return false;
    }
    if (backgroundMessage?.type === 'monero:scanBalance') {
      scanMoneroBalance(backgroundMessage.request)
        .then(sendResponse)
        .catch((error) => sendResponse(errorResponse(error)));
      return true;
    }
    if (backgroundMessage?.type === 'monero:probeDaemon') {
      probeMoneroDaemon(backgroundMessage.config)
        .then(sendResponse)
        .catch((err) => sendResponse(errorResponse(err)));
      // Keep the message channel open for the async response.
      return true;
    }
    return false;
  });
});

function isProviderRequest(message: unknown): message is ZebgenBackgroundRequest {
  return Boolean(message) && (message as ZebgenBackgroundRequest).channel === 'zebgen-provider';
}

function isPendingRequestMessage(message: unknown): message is PendingRequestMessage {
  return Boolean(message) && (message as PendingRequestMessage).channel === 'zebgen-pending';
}

function errorResponse(err: unknown) {
  return { ok: false, error: err instanceof Error ? err.message : String(err) };
}

async function handleProviderRequest(request: ZebgenBackgroundRequest): Promise<ZebgenBackgroundResponse> {
  try {
    validateProviderRequest(request.type, request.params);
  } catch (error) {
    return errorResponse(error);
  }
  try {
    if (request.type !== 'connect') {
      await assertConnectionAccounts(request.origin, request.params);
    }
  } catch (err) {
    return errorResponse(err);
  }

  return openApprovalWindow(request);
}

async function openApprovalWindow(request: ZebgenBackgroundRequest): Promise<ZebgenBackgroundResponse> {
  const pending: PendingZebgenRequest & { connectionAccounts?: ConnectionAccounts } = {
    id: request.id,
    type: request.type,
    params: request.params,
    origin: request.origin,
    createdAt: Date.now(),
    connectionAccounts: request.type === 'connect' ? undefined : await connectedAccounts(request.origin) ?? undefined,
  };
  pendingRequests.set(request.id, pending);

  const responsePromise = new Promise<ZebgenBackgroundResponse>((resolve) => {
    pendingResolvers.set(request.id, resolve);
  });

  const popupUrl = browser.runtime.getURL(`/popup.html?zebgenRequestId=${request.id}`);
  const win = await browser.windows.create({ url: popupUrl, type: 'popup', width: 380, height: 640 });

  const onDepositClosed = (windowId: number) => {
    if (windowId === win?.id) pendingResolvers.get(request.id)?.({ ok: false, error: 'Deposit window closed. Check outgoing activity before retrying if Send was pressed.' });
  };
  if (request.type === 'depositLeakSwapMonero') browser.windows.onRemoved.addListener(onDepositClosed);
  const response = await responsePromise;
  if (request.type === 'depositLeakSwapMonero') browser.windows.onRemoved.removeListener(onDepositClosed);
  pendingRequests.delete(request.id);
  pendingResolvers.delete(request.id);
  if (win?.id !== undefined) {
    browser.windows.remove(win.id).catch(() => undefined);
  }
  return response;
}

async function handlePendingRequestMessage(message: PendingRequestMessage): Promise<unknown> {
  if (message.action === 'get') {
    const pending = pendingRequests.get(message.id);
    if (!pending) {
      return { ok: false, error: 'This request is no longer available.' };
    }
    return { ok: true, request: pending, originApproved: await isOriginApproved(pending.origin) };
  }

  // action === 'resolve'
  const pending = pendingRequests.get(message.id);
  let result = message.result;
  try {
    if (message.ok && pending) {
      if (pending.type === 'connect') {
        const accounts = message.result as ConnectionAccounts;
        await activateConnectionSelection(accounts);
        await approveConnection(pending.origin, accounts);
        result = publicConnectionAccounts(accounts);
        await approveOrigin(pending.origin);
      } else if (pending.type === 'depositLeakSwapMonero') {
        if (!isSubmittedDepositResult(pending.params as ZebgenDepositLeakSwapMoneroParams, result as ZebgenDepositLeakSwapMoneroResult)) {
          throw new Error('No matching submitted deposit receipt is available. Check outgoing activity before depositing again.');
        }
        try { await assertConnectionAccounts(pending.origin, pending.params, pending.connectionAccounts); }
        catch (error) {
          console.error('Accounts changed after deposit relay; preserving receipt', error);
          result = { ...(result as ZebgenDepositLeakSwapMoneroResult), accountStatus: 'changed' };
        }
      } else {
        await assertConnectionAccounts(pending.origin, pending.params, pending.connectionAccounts);
      }
    }
  } catch (error) {
    const failure = errorResponse(error);
    pendingResolvers.get(message.id)?.(failure);
    return failure;
  }
  pendingResolvers.get(message.id)?.({ ok: message.ok, result, error: message.error });
  return { ok: true };
}
