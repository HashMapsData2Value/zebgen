import { useState } from 'react';

import {
  MONERO_NETWORK_IDS,
  networkColor,
  type MoneroNetworkId,
  type NetworkSettings,
} from '../../lib/network/networks';
import { createSwapSharePayload, type MoneroKeyMaterial } from '../../lib/wallet/moneroWallet';
import { privateKeyToMoneroMnemonic } from '../../lib/wallet/moneroMnemonic';
import MoneroKeyList from './MoneroKeyList';
import NetworkBadge from './NetworkBadge';

interface MoneroAddressCardProps {
  material: MoneroKeyMaterial;
  settings: NetworkSettings;
  onChangeNetwork: (network: MoneroNetworkId) => void;
  onOpenSettings: () => void;
  addressPosition: number;
  addressCount: number;
  onPrev: () => void;
  onNext: () => void;
}

function MoneroAddressCard({
  material,
  settings,
  onChangeNetwork,
  onOpenSettings,
  addressPosition,
  addressCount,
  onPrev,
  onNext,
}: MoneroAddressCardProps) {
  const [showMnemonic, setShowMnemonic] = useState(false);
  const network = settings.monero.network;
  const color = networkColor(network);
  const share = createSwapSharePayload(material.privateSpendKey);
  const mnemonic = privateKeyToMoneroMnemonic(material.privateSpendKey);

  return (
    <>
      <div
        className="address-frame"
        style={{ borderColor: color, boxShadow: `0 0 0 1px ${color}, 0 0 18px ${color}44` }}
      >
        <div className="address-frame-header">
          <div className="address-nav" aria-label="Monero address navigation">
            <button
              type="button"
              className="icon-btn"
              onClick={onPrev}
              disabled={addressPosition <= 0}
              title="Previous address"
              aria-label="Previous address"
            >
              ←
            </button>
            <span className="index-label">{addressPosition + 1} of {addressCount}</span>
            <button
              type="button"
              className="icon-btn"
              onClick={onNext}
              disabled={addressPosition < 0 || addressPosition >= addressCount - 1}
              title="Next address"
              aria-label="Next address"
            >
              →
            </button>
          </div>
          <div className="address-frame-actions">
            <NetworkBadge
              network={network}
              options={MONERO_NETWORK_IDS}
              onSelect={(id) => onChangeNetwork(id as MoneroNetworkId)}
            />
            <button
              type="button"
              className="icon-btn"
              onClick={onOpenSettings}
              title="Network settings"
              aria-label="Network settings"
            >
              ⚙
            </button>
          </div>
        </div>

        <MoneroKeyList material={material} />

        <div className="seed-reveal">
          <button
            type="button"
            className={showMnemonic ? 'danger' : 'secondary'}
            onClick={() => setShowMnemonic((current) => !current)}
          >
            {showMnemonic ? 'Hide Recovery Mnemonic' : 'Reveal Recovery Mnemonic'}
          </button>
          {showMnemonic ? (
            <>
              <div className="seed-warning">
                <strong>Keep this phrase private</strong>
                <p>Anyone with these 25 words has full control of this Monero address.</p>
              </div>
              <div className="seed-reveal-words">
                {mnemonic.split(' ').map((word, index) => (
                  <span className="seed-word" key={`${word}-${index}`}>
                    <span className="seed-word-index">{index + 1}</span>
                    {word}
                  </span>
                ))}
              </div>
            </>
          ) : null}
        </div>

        <div className="mono-share">
          <p className="net-subheading">Swap share payload</p>
          <p className="hint">Send these values to the counterparty.</p>
          <div className="mono-key-list">
            <div className="mono-key-row">
              <span className="mono-key-label">Private view key</span>
              <code className="mono-key-value">{share.privateViewKey}</code>
            </div>
            <div className="mono-key-row">
              <span className="mono-key-label">Public spend key</span>
              <code className="mono-key-value">{share.publicSpendKey}</code>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export default MoneroAddressCard;