import { PROVIDER_PAGE_MATCHES } from '../lib/provider/pageMatches';
import type { ZebgenPageRequest, ZebgenPageResponse, ZebgenRequestType } from '../lib/provider/types';
import type { ZebgenScanCombinedMoneroFundingParams, ZebgenScanCombinedMoneroFundingResult, ZebgenSaveLeakSwapParams, ZebgenSavedLeakSwap } from '../lib/provider/types';

// Runs in the page's own MAIN world (native MV3 `world: "MAIN"` injection, so
// it isn't subject to the page's script-src CSP) and exposes `window.zebgen`.
// All calls are relayed through `window.postMessage` to the isolated-world
// `content` script, which forwards them to the background script.
export default defineContentScript({
  matches: PROVIDER_PAGE_MATCHES,
  world: 'MAIN',
  main() {
    if (window.zebgen) {
      return;
    }

    const pending = new Map<string, { resolve: (value: unknown) => void; reject: (err: Error) => void }>();

    window.addEventListener('message', (event) => {
      if (event.source !== window) {
        return;
      }
      const data = event.data as ZebgenPageResponse | undefined;
      if (!data || data.source !== 'zebgen-content') {
        return;
      }
      const waiter = pending.get(data.id);
      if (!waiter) {
        return;
      }
      pending.delete(data.id);
      if (data.ok) {
        waiter.resolve(data.result);
      } else {
        waiter.reject(new Error(data.error ?? 'Zebgen request failed.'));
      }
    });

    function request<T>(type: ZebgenRequestType, params: unknown = {}): Promise<T> {
      const id = crypto.randomUUID();
      return new Promise<T>((resolve, reject) => {
        pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
        const message: ZebgenPageRequest = { source: 'zebgen-page', id, type, params };
        window.postMessage(message, window.location.origin);
      });
    }

    const provider: ZebgenProvider = {
      isZebgen: true,
      connect: () => request('connect'),
      getAlgorandAddress: (params) => request('getAlgorandAddress', params ?? {}),
      getMoneroShareInfo: (params) => request('getMoneroShareInfo', params ?? {}),
      computeCombinedMoneroAddress: (params) => request('computeCombinedMoneroAddress', params),
      scanCombinedMoneroFunding: (params) => request('scanCombinedMoneroFunding', params),
      saveLeakSwap: (params) => request('saveLeakSwap', params),
      listLeakSwaps: () => request('listLeakSwaps'),
      createSwapInvite: (params) => request('createSwapInvite', params),
      acceptSwapInvite: (params) => request('acceptSwapInvite', params),
      confirmSwapAcceptance: (params) => request('confirmSwapAcceptance', params),
      signAlgorandTransactions: (params) => request('signAlgorandTransactions', params),
      computeMoneroLeakySignature: (params) => request('computeMoneroLeakySignature', params),
    };

    Object.defineProperty(window, 'zebgen', {
      value: provider,
      writable: false,
      configurable: true,
    });

    window.dispatchEvent(new Event('zebgen#initialized'));
  },
});

interface ZebgenProvider {
  isZebgen: true;
  confirmSwapAcceptance: (params: { link: string }) => Promise<{
    offer: import('../../leakswap-all/leakswap-protocol/leakswap-utils/src/swapHandshake').SignedOffer;
    acceptance: import('../../leakswap-all/leakswap-protocol/leakswap-utils/src/swapHandshake').SignedAcceptance;
  }>;
  createSwapInvite: (params: { algoAmount: string; xmrAmount: string; t0: number; t1: number }) => Promise<{
    offer: import('../../leakswap-all/leakswap-protocol/leakswap-utils/src/swapHandshake').SignedOffer;
    offerDigest: string; link: string;
  }>;
  acceptSwapInvite: (params: { link: string }) => Promise<{
    offer: import('../../leakswap-all/leakswap-protocol/leakswap-utils/src/swapHandshake').SignedOffer;
    acceptance: import('../../leakswap-all/leakswap-protocol/leakswap-utils/src/swapHandshake').SignedAcceptance; link: string;
  }>;
  saveLeakSwap: (params: ZebgenSaveLeakSwapParams) => Promise<{ appId: string }>;
  listLeakSwaps: () => Promise<{ swaps: ZebgenSavedLeakSwap[] }>;
  scanCombinedMoneroFunding: (params: ZebgenScanCombinedMoneroFundingParams) => Promise<ZebgenScanCombinedMoneroFundingResult>;
  connect: () => Promise<{ algoAddress: string | null; moneroAddress: string | null }>;
  getAlgorandAddress: (params?: {
    addressIndex?: number;
  }) => Promise<{ algoAddress: string; addressIndex: number }>;
  getMoneroShareInfo: (params?: {
    moneroWalletId?: number;
  }) => Promise<{ address: string; publicSpendKey: string; privateViewKey: string }>;
  computeCombinedMoneroAddress: (params: {
    moneroWalletId?: number;
    counterpartyPrivateViewKey: string;
    counterpartyPublicSpendKey: string;
  }) => Promise<{ combinedAddress: string; combinedPublicSpendKey: string; combinedPublicViewKey: string }>;
  signAlgorandTransactions: (params: {
    agreementDigest?: string;
    agreementAppId?: string;
    addressIndex?: number;
    txns: string[];
    indexesToSign: number[];
  }) => Promise<{ signedTxns: string[] }>;
  computeMoneroLeakySignature: (params: {
    moneroWalletId?: number;
    messageHex: string;
  }) => Promise<{ signatureHex: string }>;
}

declare global {
  interface Window {
    zebgen?: ZebgenProvider;
  }
}
