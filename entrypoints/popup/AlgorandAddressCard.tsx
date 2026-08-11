import { useCallback, useEffect, useRef, useState } from 'react';

import { getAlgoBalance } from '../../lib/algorand/algodClient';
import {
  ALGORAND_NETWORK_IDS,
  networkColor,
  type AlgorandNetworkId,
  type NetworkSettings,
} from '../../lib/network/networks';
import NetworkBadge from './NetworkBadge';
import NetworkSettingsPanel from './NetworkSettings';

const POLL_INTERVAL_MS = 15000;

type DisplayBalance = { algos: number } | { error: string } | null;

interface AlgorandAddressCardProps {
  address: string | null;
  addressPreview: string;
  addressIndex: number;
  derivationPath: string;
  settings: NetworkSettings;
  onChangeNetwork: (network: AlgorandNetworkId) => void;
  onChangeSettings: (next: NetworkSettings) => void;
  onPrev: () => void;
  onNext: () => void;
  isDeriving: boolean;
}

function formatAlgos(algos: number): string {
  return algos.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function AlgorandAddressCard({
  address,
  addressPreview,
  addressIndex,
  derivationPath,
  settings,
  onChangeNetwork,
  onChangeSettings,
  onPrev,
  onNext,
  isDeriving,
}: AlgorandAddressCardProps) {
  const network = settings.algorand.network;
  const color = networkColor(network);
  const algod = settings.algorand.algod;

  const [showSettings, setShowSettings] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<number | null>(null);

  // Balances are cached per `network:address` so revisiting an address (prev/next
  // or switching networks and back) shows the last known amount instantly, and
  // the value only refreshes in the background instead of flickering.
  const cacheRef = useRef<Map<string, number>>(new Map());
  const currentKeyRef = useRef<string | null>(null);
  const [displayed, setDisplayed] = useState<DisplayBalance>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const cacheKey = address ? `${network}:${address}` : null;

  const fetchBalance = useCallback(async () => {
    if (!address) {
      return;
    }
    const key = `${network}:${address}`;
    setIsRefreshing(true);
    const result = await getAlgoBalance(algod, address);
    if (currentKeyRef.current !== key) {
      // A newer address/network was selected before this resolved; discard it.
      return;
    }
    if (result.ok && result.algos !== undefined) {
      cacheRef.current.set(key, result.algos);
      setDisplayed({ algos: result.algos });
    } else {
      setDisplayed({ error: result.error ?? 'Unavailable' });
    }
    setIsRefreshing(false);
  }, [address, network, algod]);

  useEffect(() => {
    currentKeyRef.current = cacheKey;
    if (!cacheKey) {
      setDisplayed(null);
      return;
    }
    // Show a cached amount immediately (no flicker); only truly new addresses
    // fall back to the loading skeleton. Then refresh in the background and
    // poll so incoming funds appear without user action.
    const cached = cacheRef.current.get(cacheKey);
    setDisplayed(cached !== undefined ? { algos: cached } : null);
    fetchBalance();
    const timer = window.setInterval(fetchBalance, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [cacheKey, fetchBalance]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  async function onCopyAddress() {
    if (!address) {
      return;
    }
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be unavailable; ignore.
    }
  }

  return (
    <>
      <div
        className="address-frame"
        style={{ borderColor: color, boxShadow: `0 0 0 1px ${color}, 0 0 18px ${color}44` }}
      >
        <div className="address-frame-header">
          <div className="address-nav" aria-label="Algorand address navigation">
            <button
              type="button"
              className="icon-btn"
              onClick={onPrev}
              disabled={isDeriving || addressIndex === 0}
              title="Previous address"
              aria-label="Previous address"
            >
              ←
            </button>
            <span className="index-label">Address {addressIndex + 1}</span>
            <button
              type="button"
              className="icon-btn"
              onClick={onNext}
              disabled={isDeriving}
              title="Next address"
              aria-label="Next address"
            >
              →
            </button>
          </div>
          <div className="address-frame-actions">
            <NetworkBadge
              network={network}
              options={ALGORAND_NETWORK_IDS}
              onSelect={(id) => onChangeNetwork(id as AlgorandNetworkId)}
            />
            <button
              type="button"
              className={`icon-btn${showSettings ? ' icon-btn-active' : ''}`}
              onClick={() => setShowSettings((current) => !current)}
              title="Network settings"
              aria-label="Network settings"
              aria-expanded={showSettings}
            >
              ⚙
            </button>
          </div>
        </div>

        <div className="address-row">
          <p className="address" title={address ?? ''}>
            {addressPreview}
          </p>
          <button
            type="button"
            className="icon-btn"
            onClick={onCopyAddress}
            disabled={!address}
            title={copied ? 'Copied' : 'Copy address'}
            aria-label="Copy address"
          >
            {copied ? '✓' : '⧉'}
          </button>
        </div>

        <div className="balance-row">
          {displayed === null ? (
            <span className="balance-amount balance-skeleton" aria-hidden="true">
              &nbsp;
            </span>
          ) : 'error' in displayed ? (
            <span className="balance-amount balance-unavailable">Unavailable</span>
          ) : (
            <span className="balance-amount" data-refreshing={isRefreshing}>
              {formatAlgos(displayed.algos)} ALGO
            </span>
          )}
          <button
            type="button"
            className="refresh-btn"
            onClick={fetchBalance}
            disabled={isRefreshing || !address}
            title="Refresh balance"
            aria-label="Refresh balance"
          >
            {isRefreshing ? '…' : '⟳'}
          </button>
        </div>
        {displayed && 'error' in displayed ? (
          <p className="probe-error">{displayed.error}</p>
        ) : null}

        <p className="hint">Derivation path: {derivationPath}</p>
      </div>

      {showSettings ? (
        <NetworkSettingsPanel chain="algorand" settings={settings} onChange={onChangeSettings} />
      ) : null}
    </>
  );
}

export default AlgorandAddressCard;
