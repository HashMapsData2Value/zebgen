import { ExternalLink } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { MoneroNetworkId } from '../../lib/network/networks';
import { listMoneroCombinedContexts } from '../../lib/wallet/moneroVault';
import { createSwapSharePayload, type MoneroKeyMaterial } from '../../lib/wallet/moneroWallet';
import CopyValue from './CopyValue';

interface LeakSwapPanelProps {
  material?: MoneroKeyMaterial | null;
  walletId?: number | null;
  network?: MoneroNetworkId;
  lockSecret?: string | null;
  onCombine?: () => void;
  onRecover?: () => void;
}

export default function LeakSwapPanel({ material, walletId, network, lockSecret, onCombine, onRecover }: LeakSwapPanelProps) {
  const [saved, setSaved] = useState<{ combinedAddress: string; restoreHeight: number }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setSaved([]);
    setError(null);
    if (walletId == null || !network || !lockSecret) return;
    setLoading(true);
    listMoneroCombinedContexts(walletId, network, lockSecret).then((contexts) => {
      if (!cancelled) setSaved(contexts.map(({ combinedAddress, restoreHeight }) => ({ combinedAddress, restoreHeight })));
    }).catch((failure: unknown) => {
      console.error('Could not load saved combined-address contexts.', failure);
      if (!cancelled) setError(failure instanceof Error ? failure.message : 'Unable to load saved combined addresses.');
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [walletId, network, lockSecret]);
  const share = material ? createSwapSharePayload(material.privateSpendKey) : null;
  return (
    <section className="leakswap-view">
      <h2>LeakSwap</h2>
      <a className="app-link" href="https://app.leakswap.com/swap" target="_blank" rel="noreferrer">
        Open LeakSwap <ExternalLink size={16} />
      </a>
      {share ? (
        <>
          <h3>Swap share payload</h3>
          <p className="privacy-notice">Sharing your private view key exposes incoming transaction details, but does not allow spending.</p>
          <div className="mono-share mono-key-list">
            <div className="mono-key-row"><span className="mono-key-label">Private view key</span>
              <code className="mono-key-value">{share.privateViewKey}</code><CopyValue value={share.privateViewKey} label="private view key" /></div>
            <div className="mono-key-row"><span className="mono-key-label">Public spend key</span>
              <code className="mono-key-value">{share.publicSpendKey}</code><CopyValue value={share.publicSpendKey} label="public spend key" /></div>
          </div>
          <div className="wallet-action-grid">
            <button className="secondary" type="button" onClick={onCombine}>Combine Addresses</button>
            <button className="secondary" type="button" onClick={onRecover}>Recover Combined Wallet</button>
          </div>
          {walletId != null && network && lockSecret ? (
            <>
              <h3>Saved combined addresses</h3>
              <p className="privacy-notice">Encrypted scan context only, not a complete recovery backup. Keep your original Monero wallet and recovery phrase. This context cannot restore a deleted wallet or spend combined funds by itself.</p>
              {loading ? <p className="hint">Loading saved addresses...</p> : null}
              {!loading && !error && saved.length === 0 ? <p className="hint">No saved combined addresses on {network}.</p> : null}
              {saved.map((context) => (
                <div className="mono-share mono-key-list" key={context.combinedAddress}>
                  <div className="mono-key-row"><span className="mono-key-label">Combined address</span>
                    <code className="mono-key-value" style={{ overflowWrap: 'anywhere', minWidth: 0 }}>{context.combinedAddress}</code>
                    <CopyValue value={context.combinedAddress} label="combined address" /></div>
                  <p className="hint">{network} | Restore height: {context.restoreHeight}</p>
                </div>
              ))}
              {error ? <p className="error" role="alert">{error}</p> : null}
            </>
          ) : null}
        </>
      ) : null}
    </section>
  );
}