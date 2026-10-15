import { QRCodeSVG } from 'qrcode.react';
import { paymentUri } from '../../lib/wallet/paymentUri';
import CopyValue from './CopyValue';
import { networkLabel } from '../../lib/network/networks';

export default function Receive({ address, network, chain }: {
  address: string; network: string; chain: 'algorand' | 'monero';
}) {
  return (
    <section className="receive-view">
      <h2>Receive {chain === 'algorand' ? 'ALGO' : 'XMR'}</h2>
      <p className="receive-network">{networkLabel(network)}</p>
      <div className="receive-qr">
        <QRCodeSVG value={paymentUri(chain, address, network)} size={180} marginSize={4} title="Receiving address" />
      </div>
      <div className="receive-address"><code>{address}</code><CopyValue value={address} label="address" /></div>
    </section>
  );
}