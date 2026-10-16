import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { probeMoneroDaemonViaBackground, scanMoneroBalanceViaBackground } from '../../lib/network/messages';
import { ensureHostPermissions } from '../../lib/network/hostPermissions';
import type { MoneroNetworkConfig } from '../../lib/network/networks';
import { formatAtomic } from '../../lib/wallet/formatAtomic';
import ScanActivity from './ScanActivity';

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
  const [targetHeight, setTargetHeight] = useState<number | undefined>();
  const [scannedHeight, setScannedHeight] = useState<number | undefined>();
  const [stopped, setStopped] = useState(false);
  const scanController = useRef<AbortController | null>(null);
  const pollingPaused = useRef(false);
  const mounted = useRef(true);
  const scanning = useRef(false);
  const lastHeight = useRef<number | undefined>(undefined);
  const pollGeneration = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; scanController.current?.abort(); };
  }, []);

  useEffect(() => {
    if (balance === null) return;
    const generation = ++pollGeneration.current;
    let checking = false;
    async function poll() {
      if (checking || scanning.current || pollingPaused.current) return;
      checking = true;
      try {
        const result = await probeMoneroDaemonViaBackground(props.config);
        if (!result.ok || result.height === undefined) throw new Error(result.error ?? 'Unable to check daemon height.');
        if (generation !== pollGeneration.current) return;
        if (lastHeight.current !== result.height) {
          if (await scan(false)) lastHeight.current = result.height;
        }
      } catch (failure) {
        console.error('Monero balance polling failed', failure);
        if (mounted.current && generation === pollGeneration.current) setError(failure instanceof Error ? failure.message : String(failure));
      } finally { checking = false; }
    }
    const timer = window.setInterval(poll, 5000);
    return () => { pollGeneration.current += 1; window.clearInterval(timer); };
  }, [balance, height]);

  async function scan(requestPermissions = true) {
    if (scanning.current) return;
    const controller = new AbortController();
    scanController.current = controller;
    scanning.current = true;
    pollingPaused.current = false;
    setStopped(false);
    setError(null);
    setBusy(true);
    setTargetHeight(undefined);
    setScannedHeight(undefined);
    try {
      if (requestPermissions) await ensureHostPermissions([props.config.daemon.uri]);
      controller.signal.throwIfAborted();
      const restoreHeight = Number(height);
      if (!/^\d+$/.test(height) || !Number.isSafeInteger(restoreHeight)) throw new Error('Enter a non-negative restore height.');
      const tip = await probeMoneroDaemonViaBackground(props.config);
      controller.signal.throwIfAborted();
      if (!tip.ok || tip.height === undefined) throw new Error(tip.error ?? 'Unable to check daemon height.');
      if (mounted.current) setTargetHeight(tip.height);
      const result = await scanMoneroBalanceViaBackground({ config: props.config,
        primaryAddress: props.address, walletId: props.walletId, lockSecret: props.lockSecret, restoreHeight }, {
        signal: controller.signal,
        onProgress: progress => {
          if (mounted.current && scanController.current === controller && !controller.signal.aborted) {
            setScannedHeight(progress.scannedHeight);
            setTargetHeight(progress.targetHeight);
          }
        },
      });
      controller.signal.throwIfAborted();
      if (!result.ok || result.balanceAtomic === undefined) throw new Error(result.error ?? 'Unable to scan balance.');
      if (mounted.current) {
        setBalance(result.balanceAtomic);
        setScannedAt(new Date().toLocaleTimeString());
      }
      lastHeight.current = tip.height;
      return true;
    } catch (failure) {
      if (controller.signal.aborted) return false;
      console.error('Monero balance scan failed', failure);
      if (mounted.current) setError(failure instanceof Error ? failure.message : String(failure));
      return false;
    } finally {
      if (scanController.current === controller) {
        scanController.current = null;
        scanning.current = false;
        if (mounted.current) setBusy(false);
      }
    }
  }

  function stopScan() {
    pollingPaused.current = true;
    scanController.current?.abort();
    scanController.current = null;
    scanning.current = false;
    setBusy(false);
    setStopped(true);
  }

  return (
    <div className="monero-balance" aria-busy={busy}>
      <div className="balance-row">
        <span className="balance-amount">{balance === null ? 'Not scanned' : `${formatAtomic(balance, 12)} XMR`}</span>
        <button type="button" className="refresh-btn" title="Scan unlocked balance" aria-label="Scan unlocked balance" onClick={() => void scan()} disabled={busy}>
          <RefreshCw size={16} className={busy ? 'is-spinning' : ''} />
        </button>
      </div>
      {busy ? <ScanActivity restoreHeight={Number(height)} targetHeight={targetHeight} scannedHeight={scannedHeight} onStop={stopScan} />
        : <p className="hint" role="status">{stopped ? 'Scan stopped' : balance === null ? 'Unlocked balance' : `Unlocked balance · scanned ${scannedAt}`}</p>}
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