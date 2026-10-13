import { FormEvent, useState } from 'react';

import { createMoneroTransactionViaBackground } from '../../lib/network/messages';
import { ensureHostPermissions } from '../../lib/network/hostPermissions';
import type { AlgodEndpoint, MoneroNetworkConfig } from '../../lib/network/networks';
import { sendAlgoPayment } from '../../lib/wallet/algoWallet';
import type { MoneroKeyMaterial } from '../../lib/wallet/moneroWallet';

function parseUnits(value: string, decimals: number): bigint {
  const normalized = value.trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new Error('Enter a valid positive amount.');
  }
  const [whole, fraction = ''] = normalized.split('.');
  if (fraction.length > decimals) {
    throw new Error(`Amount supports at most ${decimals} decimal places.`);
  }
  const units = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0'));
  if (units <= 0n) {
    throw new Error('Amount must be greater than zero.');
  }
  return units;
}

interface AlgorandTransactionBuilderProps {
  chain: 'algorand';
  sender: string;
  addressIndex: number;
  lockSecret: string;
  endpoint: AlgodEndpoint;
  network: string;
}

interface MoneroTransactionBuilderProps {
  chain: 'monero';
  material: MoneroKeyMaterial;
  config: MoneroNetworkConfig;
  defaultRestoreHeight?: number;
}

type TransactionBuilderProps = AlgorandTransactionBuilderProps | MoneroTransactionBuilderProps;

function TransactionBuilder(props: TransactionBuilderProps) {
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [restoreHeight, setRestoreHeight] = useState(
    String((props.chain === 'monero' && props.defaultRestoreHeight) || 0)
  );
  const [sendAll, setSendAll] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const decimals = props.chain === 'algorand' ? 6 : 12;
  const symbol = props.chain === 'algorand' ? 'ALGO' : 'XMR';
  const sender = props.chain === 'algorand' ? props.sender : props.material.address;
  const network = props.chain === 'algorand' ? props.network : props.config.network;
  const isSweep = props.chain === 'monero' && sendAll;

  function resetReview() {
    setIsReviewing(false);
    setResult(null);
  }

  function onReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      if (!isSweep) {
        parseUnits(amount, decimals);
      }
      if (!recipient.trim()) {
        throw new Error('Recipient address is required.');
      }
      if (props.chain === 'monero') {
        const height = Number(restoreHeight);
        if (!Number.isInteger(height) || height < 0) {
          throw new Error('Restore height must be a non-negative integer.');
        }
      }
      setIsReviewing(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to review transaction.');
    }
  }

  async function onConfirm() {
    setError(null);
    setResult(null);
    setIsSubmitting(true);
    try {
      await ensureHostPermissions([
        props.chain === 'algorand' ? props.endpoint.server : props.config.daemon.uri,
      ]);
      if (props.chain === 'algorand') {
        const sent = await sendAlgoPayment(
          props.lockSecret,
          props.addressIndex,
          recipient.trim(),
          parseUnits(amount, decimals),
          props.endpoint,
          note
        );
        setResult(`Submitted ${sent.txId} · fee ${sent.feeMicroAlgos.toString()} µALGO`);
      } else {
        const sent = await createMoneroTransactionViaBackground({
          config: props.config,
          primaryAddress: props.material.address,
          privateSpendKey: props.material.privateSpendKey,
          privateViewKey: props.material.privateViewKey,
          recipient: recipient.trim(),
          amountAtomic: isSweep ? '0' : parseUnits(amount, decimals).toString(),
          sweep: isSweep,
          restoreHeight: Number(restoreHeight),
          relay: true,
        });
        if (!sent.ok) {
          throw new Error(sent.error ?? 'Unable to create Monero transaction.');
        }
        setResult(
          `Relayed ${sent.hash ?? 'transaction'} · amount ${sent.amountAtomic ?? 'unknown'} · fee ${sent.feeAtomic ?? 'unknown'} piconero`
        );
      }
      setIsReviewing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to submit transaction.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="transaction-builder">
      <div className="transaction-context">
        <span>{network}</span>
        <code title={sender}>{sender.slice(0, 10)}...{sender.slice(-8)}</code>
      </div>

      {!isReviewing ? (
        <form className="import-form" onSubmit={onReview}>
          <label htmlFor={`${props.chain}-tx-recipient`}>Recipient</label>
          <input
            id={`${props.chain}-tx-recipient`}
            value={recipient}
            onChange={(event) => {
              setRecipient(event.target.value);
              resetReview();
            }}
            placeholder={`${symbol} address`}
            autoComplete="off"
            required
          />
          <label htmlFor={`${props.chain}-tx-amount`}>Amount ({symbol})</label>
          <input
            id={`${props.chain}-tx-amount`}
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
              resetReview();
            }}
            placeholder="0.0"
            inputMode="decimal"
            required={!isSweep}
            disabled={isSweep}
          />
          {props.chain === 'algorand' ? (
            <>
              <label htmlFor="algorand-tx-note">Note (optional)</label>
              <input id="algorand-tx-note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={1024} />
            </>
          ) : (
            <>
              <label className="checkbox-label" htmlFor="monero-tx-send-all">
                <input
                  id="monero-tx-send-all"
                  type="checkbox"
                  checked={sendAll}
                  onChange={(event) => {
                    setSendAll(event.target.checked);
                    resetReview();
                  }}
                />
                Send entire balance (minus fee)
              </label>
              <label htmlFor="monero-restore-height">Wallet restore height</label>
              <input
                id="monero-restore-height"
                value={restoreHeight}
                onChange={(event) => setRestoreHeight(event.target.value)}
                inputMode="numeric"
                required
              />
              <p className="hint">
                Scanning starts at this block. It's filled in from when this wallet (or swap) was
                created; for an imported wallet, use a height at or before it first received funds.
              </p>
            </>
          )}
          <button type="submit">Review Transaction</button>
        </form>
      ) : (
        <div className="transaction-review">
          <p><span>From</span><code>{sender}</code></p>
          <p><span>To</span><code>{recipient.trim()}</code></p>
          <p><span>Amount</span><strong>{isSweep ? 'Entire balance minus fee' : `${amount} ${symbol}`}</strong></p>
          <p><span>Network</span><strong>{network}</strong></p>
          {props.chain === 'monero' ? <p><span>Restore height</span><strong>{restoreHeight}</strong></p> : null}
          <div className="transaction-actions">
            <button type="button" className="secondary" onClick={() => setIsReviewing(false)} disabled={isSubmitting}>Edit</button>
            <button type="button" onClick={onConfirm} disabled={isSubmitting}>
              {isSubmitting ? (props.chain === 'monero' ? 'Syncing and Sending...' : 'Signing and Sending...') : 'Confirm and Send'}
            </button>
          </div>
        </div>
      )}

      {error ? <p className="error">{error}</p> : null}
      {result ? <p className="probe-ok result-value">{result}</p> : null}
    </div>
  );
}

export default TransactionBuilder;