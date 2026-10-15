import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { scanMoneroBalanceViaBackground } from '../../lib/network/messages';
import { ensureHostPermissions } from '../../lib/network/hostPermissions';
import type { MoneroNetworkConfig } from '../../lib/network/networks';
import { formatAtomic } from '../../lib/wallet/formatAtomic';

interface MoneroBalanceProps {
  config: MoneroNetworkConfig;
  address: string;
  walletId: number;
  lockSecret: string;
  restoreHeight?: number;
}

export default function MoneroBalance(props: MoneroBalanceProps) {
  const [balance, setBalance] = useState<string | null>(null);
  const [height, setHeight] = useState(String(props.restoreHeight ?? 0));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scannedAt, setScannedAt] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  async function scan() {
    setError(null);
    setBusy(true);
    try {
      await ensureHostPermissions([props.config.daemon.uri]);
      const restoreHeight = Number(height);
      if (!/^\d+$/.test(height) || !Number.isSafeInteger(restoreHeight)) throw new Error('Enter a non-negative restore height.');
      const result = await scanMoneroBalanceViaBackground({ config: props.config,
        primaryAddress: props.address, walletId: props.walletId, lockSecret: props.lockSecret, restoreHeight });
      if (!result.ok || result.balanceAtomic === undefined) throw new Error(result.error ?? 'Unable to scan balance.');
      if (mounted.current) {
        setBalance(result.balanceAtomic);
        setScannedAt(new Date().toLocaleTimeString());
      }
    } catch (failure) {
      console.error('Monero balance scan failed', failure);
      if (mounted.current) setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <div className="monero-balance" aria-busy={busy}>
      <div className="balance-row">
        <span className="balance-amount">{balance === null ? 'Not scanned' : `${formatAtomic(balance, 12)} XMR`}</span>
        <button type="button" className="refresh-btn" title="Scan unlocked balance" aria-label="Scan unlocked balance" onClick={scan} disabled={busy}>
          <RefreshCw size={16} className={busy ? 'is-spinning' : ''} />
        </button>
      </div>
      <p className="hint" role="status">{busy ? `Scanning from block ${height}...` : balance === null ? 'Unlocked balance' : `Unlocked balance · scanned ${scannedAt}`}</p>
      <details className="address-details"><summary>Scan settings</summary>
        <div className="import-form">
          <label htmlFor="balance-restore-height">Restore height</label>
          <input id="balance-restore-height" inputMode="numeric" value={height} disabled={busy}
            onChange={(event) => { setHeight(event.target.value); setBalance(null); setScannedAt(null); }} />
        </div>
      </details>
      {Number(height) === 0 ? <p className="privacy-notice">A scan from block 0 downloads the full chain history and may use substantial data.</p> : null}
      {error ? <p className="error" role="alert">{error}</p> : null}
    </div>
  );
}