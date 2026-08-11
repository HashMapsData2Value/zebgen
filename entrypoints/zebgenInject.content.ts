import type { ZebgenPageRequest, ZebgenPageResponse, ZebgenRequestType } from '../lib/provider/types';

// Runs in the page's own MAIN world (native MV3 `world: "MAIN"` injection, so
// it isn't subject to the page's script-src CSP) and exposes `window.zebgen`.
// All calls are relayed through `window.postMessage` to the isolated-world
// `content` script, which forwards them to the background script.
export default defineContentScript({
  matches: ['http://localhost/*', 'http://127.0.0.1/*'],
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
