import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  probeMoneroDaemonViaBackground,
  scanMoneroBalanceViaBackground,
  isMoneroScanActive,
} from '../../lib/network/messages';
import { ensureHostPermissions } from '../../lib/network/hostPermissions';
import type { MoneroNetworkConfig } from '../../lib/network/networks';
import { formatAtomic } from '../../lib/wallet/formatAtomic';
import ScanActivity from './ScanActivity';
import MoneroChainHeight from './MoneroChainHeight';
import { sanitizeBlockHeight } from '../../lib/monero/scanHeight';
import { balanceCheckpointKey, loadBalanceCheckpoint } from '../../lib/wallet/moneroBalanceCache';

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
  const [refreshNeeded, setRefreshNeeded] = useState<string | null>(null);
  const [scanSettingsOpen, setScanSettingsOpen] = useState(false);
  const scanController = useRef<AbortController | null>(null);
  const pollingPaused = useRef(false);
  const mounted = useRef(true);
  const scanning = useRef(false);
  const lastHeight = useRef<number | undefined>(undefined);
  const pollGeneration = useRef(0);
  const checkpointKey = balanceCheckpointKey(
    props.config.network,
    props.config.daemon.uri,
    props.address,
    Number(height),
  );
  useEffect(() => {
    let active = true;
    setBalance(null);
    setScannedAt(null);
    setRefreshNeeded(null);
    lastHeight.current = undefined;
    void loadBalanceCheckpoint(checkpointKey, props.lockSecret)
      .then(async (checkpoint) => {
        if (!active) return;
        if (checkpoint) {
          setBalance(checkpoint.balanceAtomic);
          setScannedAt(new Date(checkpoint.scannedAt).toLocaleString());
          lastHeight.current = checkpoint.scannedHeight;
        }
        if (await isMoneroScanActive(checkpointKey)) {
          if (active) await scan(false);
          return;
        }
        const tip = await probeMoneroDaemonViaBackground(props.config);
        if (!active) return;
        if (!tip.ok || tip.height === undefined)
          throw new Error(tip.error ?? 'Unable to check daemon height. Showing saved balance.');
        if (!checkpoint || tip.height !== checkpoint.scannedHeight) {
          if (
            tip.height - (checkpoint?.resumable ? checkpoint.scannedHeight : Number(height)) >
            5000
          )
            setRefreshNeeded('Scan required. Refresh to allow the history download.');
          else await scan(false);
        }
      })
      .catch((failure) => {
        console.error('Unable to restore Monero balance', failure);
        if (active) setError(failure instanceof Error ? failure.message : String(failure));
      });
    return () => {
      active = false;
      scanController.current?.abort('detach');
    };
  }, [checkpointKey, props.lockSecret]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      scanController.current?.abort('detach');
    };
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
        if (!result.ok || result.height === undefined)
          throw new Error(result.error ?? 'Unable to check daemon height.');
        if (generation !== pollGeneration.current) return;
        if (lastHeight.current !== result.height) {
          const checkpoint = await loadBalanceCheckpoint(checkpointKey, props.lockSecret);
          if (generation !== pollGeneration.current) return;
          if (
            result.height - (checkpoint?.resumable ? checkpoint.scannedHeight : Number(height)) >
            5000
          ) {
            setRefreshNeeded(
              'New blocks available. Refresh to download the missing history; the saved balance may be stale.',
            );
          } else if (await scan(false)) lastHeight.current = result.height;
        }
      } catch (failure) {
        console.error('Monero balance polling failed', failure);
        if (mounted.current && generation === pollGeneration.current)
          setError(failure instanceof Error ? failure.message : String(failure));
      } finally {
        checking = false;
      }
    }
    const timer = window.setInterval(poll, 5000);
    return () => {
      pollGeneration.current += 1;
      window.clearInterval(timer);
    };
  }, [balance, height]);

  async function scan(requestPermissions = true) {
    if (scanning.current) return;
    const controller = new AbortController();
    scanController.current = controller;
    scanning.current = true;
    pollingPaused.current = false;
    setStopped(false);
    setRefreshNeeded(null);
    setError(null);
    setBusy(true);
    setTargetHeight(undefined);
    setScannedHeight(undefined);
    try {
      if (requestPermissions) await ensureHostPermissions([props.config.daemon.uri]);
      controller.signal.throwIfAborted();
      const restoreHeight = Number(height);
      if (!/^\d+$/.test(height) || !Number.isSafeInteger(restoreHeight))
        throw new Error('Enter a non-negative restore height.');
      const tip = await probeMoneroDaemonViaBackground(props.config);
      controller.signal.throwIfAborted();
      if (!tip.ok || tip.height === undefined)
        throw new Error(tip.error ?? 'Unable to check daemon height.');
      if (mounted.current) setTargetHeight(tip.height);
      const result = await scanMoneroBalanceViaBackground(
        {
          config: props.config,
          primaryAddress: props.address,
          walletId: props.walletId,
          lockSecret: props.lockSecret,
          restoreHeight,
        },
        {
          signal: controller.signal,
          onProgress: (progress) => {
            if (
              mounted.current &&
              scanController.current === controller &&
              !controller.signal.aborted
            ) {
              setScannedHeight(progress.scannedHeight);
              setTargetHeight(progress.targetHeight);
            }
          },
        },
      );
      controller.signal.throwIfAborted();
      if (!result.ok || result.balanceAtomic === undefined)
        throw new Error(result.error ?? 'Unable to scan balance.');
      const scannedAt = Date.now();
      const checkpoint = await loadBalanceCheckpoint(checkpointKey, props.lockSecret);
      controller.signal.throwIfAborted();
      if (mounted.current) {
        setBalance(result.balanceAtomic);
        setScannedAt(new Date(scannedAt).toLocaleString());
      }
      lastHeight.current = checkpoint?.scannedHeight ?? tip.height;
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
        <span className="balance-amount">
          {balance === null
            ? busy
              ? 'Checking balance...'
              : 'Balance not checked'
            : `${formatAtomic(balance, 12)} XMR`}
        </span>
        {!scanSettingsOpen ? (
          <button
            type="button"
            className="refresh-btn"
            title="Scan unlocked balance"
            aria-label="Scan unlocked balance"
            onClick={() => void scan()}
            disabled={busy}
          >
            <RefreshCw size={16} className={busy ? 'is-spinning' : ''} />
          </button>
        ) : null}
      </div>
      {busy ? (
        <ScanActivity
          restoreHeight={Number(height)}
          targetHeight={targetHeight}
          scannedHeight={scannedHeight}
          onStop={stopScan}
        />
      ) : (
        <p className="hint" role="status">
          {stopped
            ? 'Scan stopped'
            : balance === null
              ? 'Unlocked balance not checked'
              : `Last verified unlocked balance · block ${lastHeight.current ?? 'unknown'} · ${scannedAt}`}
        </p>
      )}
      <details
        className="address-details"
        onToggle={(event) => setScanSettingsOpen(event.currentTarget.open)}
      >
        <summary>Scan settings</summary>
        <div className="import-form">
          <label htmlFor="balance-restore-height">Restore height</label>
          <input
            id="balance-restore-height"
            inputMode="numeric"
            value={height}
            disabled={busy}
            onChange={(event) => {
              setHeight(sanitizeBlockHeight(event.target.value));
              setBalance(null);
              setScannedAt(null);
            }}
          />
          <MoneroChainHeight config={props.config} />
          <button type="button" disabled={busy} onClick={() => void scan()}>
            {busy ? 'Scanning...' : 'Scan from this height'}
          </button>
        </div>
      </details>
      {Number(height) === 0 ? (
        <p className="privacy-notice">
          A scan from block 0 downloads the full chain history and may use substantial data.
        </p>
      ) : null}
      {refreshNeeded ? (
        <p className="hint" role="status">
          {refreshNeeded}
        </p>
      ) : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
