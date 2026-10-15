import { FormEvent, useEffect, useState } from 'react';

import { discardTransactionsViaBackground, prepareTransactionViaBackground, submitTransactionViaBackground } from '../../lib/network/messages';
import { ensureHostPermissions } from '../../lib/network/hostPermissions';
import type { AlgodEndpoint, AlgorandNetworkId, MoneroNetworkConfig } from '../../lib/network/networks';
import { networkLabel } from '../../lib/network/networks';
import type { TransactionReview } from '../../lib/wallet/transactionService';
import { formatAtomic } from '../../lib/wallet/formatAtomic';
import CopyValue from './CopyValue';

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
  network: AlgorandNetworkId;
}

interface MoneroTransactionBuilderProps {
  chain: 'monero';
  sender: string;
  config: MoneroNetworkConfig;
  walletId: number;
  lockSecret: string;
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
  const [transactionId, setTransactionId] = useState('');
  const [prepared, setPrepared] = useState<TransactionReview | null>(null);

  useEffect(() => () => {
    discardTransactionsViaBackground().catch((failure) => console.error('Unable to discard prepared transaction', failure));
  }, []);

  const decimals = props.chain === 'algorand' ? 6 : 12;
  const symbol = props.chain === 'algorand' ? 'ALGO' : 'XMR';
  const sender = props.sender;
  const network = props.chain === 'algorand' ? props.network : props.config.network;
  const isSweep = props.chain === 'monero' && sendAll;

  function resetReview() {
    discardTransactionsViaBackground().catch((failure) => console.error('Unable to discard prepared transaction', failure));
    setPrepared(null);
    setIsReviewing(false);
    setResult(null);
    setTransactionId('');
  }

  async function onReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await ensureHostPermissions([props.chain === 'algorand' ? props.endpoint.server : props.config.daemon.uri]);
      if (!isSweep) {
        parseUnits(amount, decimals);
      }
      if (!recipient.trim()) {
        throw new Error('Recipient address is required.');
      }
      if (props.chain === 'monero') {
        const height = Number(restoreHeight);
        if (!/^\d+$/.test(restoreHeight) || !Number.isSafeInteger(height) || height < 0) {
          throw new Error('Restore height must be a non-negative integer.');
        }
      }
      const common = { primaryAddress: sender, recipient: recipient.trim(),
        amountAtomic: isSweep ? '0' : parseUnits(amount, decimals).toString(), lockSecret: props.lockSecret };
      const response = await prepareTransactionViaBackground(props.chain === 'algorand' ?
        { ...common, chain: 'algorand', addressIndex: props.addressIndex, endpoint: props.endpoint, network: props.network, note } :
        { ...common, chain: 'monero', walletId: props.walletId, config: props.config, restoreHeight: Number(restoreHeight), sweep: sendAll });
      if (!response.ok) throw new Error(response.error);
      setPrepared(response.review);
      setIsReviewing(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to review transaction.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function onConfirm() {
    setError(null);
    setResult(null);
    setTransactionId('');
    setIsSubmitting(true);
    try {
      await ensureHostPermissions([
        props.chain === 'algorand' ? props.endpoint.server : props.config.daemon.uri,
      ]);
      if (!prepared) throw new Error('Prepare the transaction again.');
      const sent = await submitTransactionViaBackground(prepared.id);
      if (!sent.ok) throw new Error(sent.error);
      setResult(`${props.chain === 'algorand' ? 'Submitted' : 'Relayed'} ${sent.review.hash} · amount ${formatAtomic(sent.review.amountAtomic, decimals)} ${symbol} · fee ${formatAtomic(sent.review.feeAtomic, decimals)} ${symbol}`);
      setTransactionId(sent.review.hash);
      setPrepared(null);
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
        <span>{networkLabel(network)}</span>
        <code title={sender}>{sender.slice(0, 10)}...{sender.slice(-8)}</code>
      </div>

      {!isReviewing ? (
        <form className="import-form" onSubmit={onReview}>
          <fieldset className="transaction-fields" disabled={isSubmitting}>
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
              {Number(restoreHeight) === 0 ? <p className="privacy-notice">Preparing from block 0 scans the full chain history and may use substantial data.</p> : null}
            </>
          )}
          <button type="submit">{isSubmitting ? (props.chain === 'monero' ? 'Scanning and Preparing...' : 'Preparing...') : 'Review Transaction'}</button>
          </fieldset>
        </form>
      ) : (
        <div className="transaction-review">
          <p><span>From</span><code>{sender}</code></p>
          <p><span>To</span><code>{recipient.trim()}</code></p>
          <p><span>Amount{isSweep ? ' (entire unlocked balance minus fee)' : ''}</span><strong>{prepared ? formatAtomic(prepared.amountAtomic, decimals) : amount} {symbol}</strong></p>
          {prepared ? <>
            <p><span>Fee</span><strong>{formatAtomic(prepared.feeAtomic, decimals)} {symbol}</strong></p>
            <p><span>Total debit</span><strong>{formatAtomic((BigInt(prepared.amountAtomic) + BigInt(prepared.feeAtomic)).toString(), decimals)} {symbol}</strong></p>
          </> : null}
          <p><span>Network</span><strong>{networkLabel(network)}</strong></p>
          {props.chain === 'algorand' && note ? <p><span>Note</span><code>{note}</code></p> : null}
          {props.chain === 'monero' ? <p><span>Restore height</span><strong>{restoreHeight}</strong></p> : null}
          <div className="transaction-actions">
            <button type="button" className="secondary" onClick={resetReview} disabled={isSubmitting}>Edit</button>
            <button type="button" onClick={onConfirm} disabled={isSubmitting}>
              {isSubmitting ? 'Broadcasting...' : 'Confirm and Send'}
            </button>
          </div>
        </div>
      )}

      {error ? <p className="error" role="alert">{error}</p> : null}
      {result ? <div className="transaction-result" role="status"><p className="probe-ok result-value">{result}</p>
        {transactionId ? <CopyValue value={transactionId} label="transaction ID" /> : null}
      </div> : null}
    </div>
  );
}

export default TransactionBuilder;