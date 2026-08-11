import { browser } from 'wxt/browser';

import { createMoneroTransaction, probeMoneroDaemon } from '../lib/monero/moneroDaemon';
import type { BackgroundMessage } from '../lib/network/messages';
import { approveOrigin, isOriginApproved } from '../lib/provider/originApproval';
import type {
  PendingRequestMessage,
  PendingZebgenRequest,
  ZebgenBackgroundRequest,
  ZebgenBackgroundResponse,
} from '../lib/provider/types';
import { getSignedInState } from '../lib/wallet/algoWallet';
import { getMoneroWalletState } from '../lib/wallet/moneroVault';

// Request types answerable straight from cached wallet-meta (public
// addresses only) once the origin has already been approved once.
const FAST_PATH_TYPES = new Set(['connect']);

// Requests parked while an approval popup window is open, waiting on the
// user. Module-level state is fine here: an in-flight async onMessage
// listener keeps the MV3 service worker alive until sendResponse fires.
const pendingRequests = new Map<string, PendingZebgenRequest>();
const pendingResolvers = new Map<string, (response: ZebgenBackgroundResponse) => void>();

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (isProviderRequest(message)) {
      handleProviderRequest(message).then(sendResponse);
      return true;
    }
    if (isPendingRequestMessage(message)) {
      handlePendingRequestMessage(message).then(sendResponse);
      return true;
    }

    const backgroundMessage = message as BackgroundMessage;
    if (backgroundMessage?.type === 'monero:probeDaemon') {
      probeMoneroDaemon(backgroundMessage.config)
        .then(sendResponse)
        .catch((err) => sendResponse(errorResponse(err)));
      // Keep the message channel open for the async response.
      return true;
    }
    if (backgroundMessage?.type === 'monero:createTransaction') {
      createMoneroTransaction(backgroundMessage.request)
        .then(sendResponse)
        .catch((err) => sendResponse(errorResponse(err)));
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
  const approved = await isOriginApproved(request.origin);

  if (approved && FAST_PATH_TYPES.has(request.type)) {
    try {
      return { ok: true, result: await resolveFastPath(request) };
    } catch (err) {
      return errorResponse(err);
    }
  }

  return openApprovalWindow(request);
}

async function resolveFastPath(request: ZebgenBackgroundRequest): Promise<unknown> {
  if (request.type === 'connect') {
    const [signedIn, moneroState] = await Promise.all([getSignedInState(), getMoneroWalletState()]);
    const activeMonero = moneroState.wallets.find((wallet) => wallet.id === moneroState.activeWalletId);
    return { algoAddress: signedIn.algoAddress ?? null, moneroAddress: activeMonero?.address ?? null };
  }
  throw new Error(`Unsupported fast-path request type: ${request.type}`);
}

async function openApprovalWindow(request: ZebgenBackgroundRequest): Promise<ZebgenBackgroundResponse> {
  const pending: PendingZebgenRequest = {
    id: request.id,
    type: request.type,
    params: request.params,
    origin: request.origin,
    createdAt: Date.now(),
  };
  pendingRequests.set(request.id, pending);

  const responsePromise = new Promise<ZebgenBackgroundResponse>((resolve) => {
    pendingResolvers.set(request.id, resolve);
  });

  const popupUrl = browser.runtime.getURL(`/popup.html?zebgenRequestId=${request.id}`);
  const win = await browser.windows.create({ url: popupUrl, type: 'popup', width: 380, height: 640 });

  const response = await responsePromise;
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
  if (message.ok && pending) {
    await approveOrigin(pending.origin);
  }
  pendingResolvers.get(message.id)?.({ ok: message.ok, result: message.result, error: message.error });
  return { ok: true };
}
