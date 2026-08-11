import algosdk from 'algosdk';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { useEffect, useState, type FormEvent } from 'react';
import { browser } from 'wxt/browser';

import { getNetworkSettings } from '../../lib/network/networkStore';
import { base64ToBytes, bytesToBase64 } from '../../lib/provider/base64';
import type { GetPendingRequestResponse, PendingZebgenRequest } from '../../lib/provider/types';
import {
  deriveActiveSeedAlgoAddressAtIndex,
  getSignedInState,
  signRawTransactions,
  unlockWallet,
} from '../../lib/wallet/algoWallet';
import { leakySign } from '../../lib/wallet/leakySign';
import { getMoneroWalletState, unlockMoneroWallet } from '../../lib/wallet/moneroVault';
import { computeCombinedAddressWithPrivateAndPublic } from '../../lib/wallet/moneroWallet';

interface ExternalRequestAppProps {
  requestId: string;
}

type Stage = 'loading' | 'consent' | 'unlock' | 'error';

function ExternalRequestApp({ requestId }: ExternalRequestAppProps) {
  const [pending, setPending] = useState<PendingZebgenRequest | null>(null);
  const [originApproved, setOriginApproved] = useState(false);
  const [stage, setStage] = useState<Stage>('loading');
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    let isMounted = true;
    (async () => {
      const response = (await browser.runtime.sendMessage({
        channel: 'zebgen-pending',
        action: 'get',
        id: requestId,
      })) as GetPendingRequestResponse;
      if (!isMounted) {
        return;
      }
      if (!response.ok || !response.request) {
        setError(response.error ?? 'This request is no longer available.');
        setStage('error');
        return;
      }
      setPending(response.request);
      setOriginApproved(Boolean(response.originApproved));
      setStage(response.request.type === 'connect' ? 'consent' : 'unlock');
    })();
    return () => {
      isMounted = false;
    };
  }, [requestId]);

  async function respond(ok: boolean, result?: unknown, errMessage?: string) {
    await browser.runtime.sendMessage({
      channel: 'zebgen-pending',
      action: 'resolve',
      id: requestId,
      ok,
      result,
      error: errMessage,
    });
    window.close();
  }

  async function onApproveConnect() {
    setIsBusy(true);
    setError(null);
    try {
      const [signedIn, moneroState] = await Promise.all([getSignedInState(), getMoneroWalletState()]);
      const activeMonero = moneroState.wallets.find((wallet) => wallet.id === moneroState.activeWalletId);
      await respond(true, {
        algoAddress: signedIn.algoAddress ?? null,
        moneroAddress: activeMonero?.address ?? null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to connect.');
      setIsBusy(false);
    }
  }

  async function onUnlockAndApprove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pending) {
      return;
    }
    setIsBusy(true);
    setError(null);
    try {
      await unlockWallet(secret);
      const result = await computeResult(pending, secret);
      await respond(true, result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to complete request.');
      setIsBusy(false);
    }
  }

  async function onReject() {
    await respond(false, undefined, 'User rejected the request.');
  }

  if (stage === 'loading') {
    return (
      <main className="popup-root">
        <p>Loading request...</p>
      </main>
    );
  }

  if (stage === 'error' || !pending) {
    return (
      <main className="popup-root">
        <section className="card">
          <h2>Zebgen Wallet</h2>
          <p className="error">{error}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="popup-root">
      <div className="app-header">
        <h1>Zebgen Wallet</h1>
      </div>
      <section className="card">
        <h2>{describeRequest(pending)}</h2>
        <p className="hint">
          Requested by <strong>{pending.origin}</strong>
          {originApproved ? ' (previously approved)' : ''}
        </p>

        {pending.type === 'signAlgorandTransactions' ? (
          <ul className="hint">
            {summarizeTransactions(pending.params).map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        ) : null}

        {pending.type === 'computeMoneroLeakySignature' ? (
          <p className="error">
            Warning: signing this will permanently reveal your Monero private spend key on the Algorand blockchain.
            Only do this if you intend to claim or refund this swap right now.
          </p>
        ) : null}

        {stage === 'consent' ? (
          <div className="seed-reveal-actions">
            <button type="button" className="secondary" onClick={onReject} disabled={isBusy}>
              Deny
            </button>
            <button type="button" onClick={onApproveConnect} disabled={isBusy}>
              {isBusy ? 'Connecting...' : 'Allow'}
            </button>
          </div>
        ) : (
          <form className="import-form" onSubmit={onUnlockAndApprove}>
            <label htmlFor="external-secret">Password or PIN</label>
            <input
              id="external-secret"
              type="password"
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              placeholder="Enter your password or PIN"
              autoFocus
              required
            />
            <div className="seed-reveal-actions">
              <button type="button" className="secondary" onClick={onReject} disabled={isBusy}>
                Deny
              </button>
              <button type="submit" disabled={isBusy || !secret}>
                {isBusy ? 'Approving...' : 'Unlock and Approve'}
              </button>
            </div>
          </form>
        )}

        {error ? <p className="error">{error}</p> : null}
      </section>
    </main>
  );
}

async function computeResult(pending: PendingZebgenRequest, secret: string): Promise<unknown> {
  const networkSettings = await getNetworkSettings();

  if (pending.type === 'getAlgorandAddress') {
    const params = pending.params as { addressIndex?: number };
    const derived = await deriveActiveSeedAlgoAddressAtIndex(secret, params.addressIndex ?? 0);
    return { algoAddress: derived.algoAddress, addressIndex: derived.addressIndex };
  }

  if (pending.type === 'getMoneroShareInfo') {
    const params = pending.params as { moneroWalletId?: number };
    const material = await unlockMoneroWallet(secret, networkSettings.monero.networkType, params.moneroWalletId);
    if (!material) {
      throw new Error('No Monero wallet found. Create one in the wallet first.');
    }
    return {
      address: material.address,
      publicSpendKey: material.publicSpendKey,
      privateViewKey: material.privateViewKey,
    };
  }

  if (pending.type === 'computeCombinedMoneroAddress') {
    const params = pending.params as {
      moneroWalletId?: number;
      counterpartyPrivateViewKey: string;
      counterpartyPublicSpendKey: string;
    };
    const material = await unlockMoneroWallet(secret, networkSettings.monero.networkType, params.moneroWalletId);
    if (!material) {
      throw new Error('No Monero wallet found. Create one in the wallet first.');
    }
    return computeCombinedAddressWithPrivateAndPublic(
      material.privateSpendKey,
      material.privateViewKey,
      params.counterpartyPrivateViewKey,
      params.counterpartyPublicSpendKey,
      networkSettings.monero.networkType
    );
  }

  if (pending.type === 'signAlgorandTransactions') {
    const params = pending.params as { addressIndex?: number; txns: string[]; indexesToSign: number[] };
    const unsignedTxns = params.indexesToSign.map((index) => base64ToBytes(params.txns[index]));
    const signed = await signRawTransactions(secret, params.addressIndex ?? 0, unsignedTxns);
    return { signedTxns: signed.map((bytes) => bytesToBase64(bytes)) };
  }

  if (pending.type === 'computeMoneroLeakySignature') {
    const params = pending.params as { moneroWalletId?: number; messageHex: string };
    const material = await unlockMoneroWallet(secret, networkSettings.monero.networkType, params.moneroWalletId);
    if (!material) {
      throw new Error('No Monero wallet found. Create one in the wallet first.');
    }
    const signature = leakySign(hexToBytes(params.messageHex), hexToBytes(material.privateSpendKey));
    return { signatureHex: bytesToHex(signature) };
  }

  throw new Error(`Unsupported request type: ${pending.type}`);
}

function summarizeTransactions(params: unknown): string[] {
  const { txns, indexesToSign } = params as { txns: string[]; indexesToSign: number[] };
  return indexesToSign.map((index) => {
    try {
      const txn = algosdk.decodeUnsignedTransaction(base64ToBytes(txns[index]));
      return `#${index + 1}: ${describeDecodedTransaction(txn)}`;
    } catch {
      return `#${index + 1}: Unable to decode transaction for preview.`;
    }
  });
}

function describeDecodedTransaction(txn: algosdk.Transaction): string {
  const type = txn.type;
  if (type === algosdk.TransactionType.pay && txn.payment) {
    return `Payment of ${txn.payment.amount} microAlgos to ${txn.payment.receiver.toString()}`;
  }
  if (type === algosdk.TransactionType.appl && txn.applicationCall) {
    const appId = txn.applicationCall.appIndex;
    const args = txn.applicationCall.appArgs ?? [];
    const methodSelector = args[0] ? Buffer.from(args[0]).toString('hex') : undefined;
    return appId === 0n
      ? `Create application (method selector 0x${methodSelector ?? ''})`
      : `App call to application ${appId} (method selector 0x${methodSelector ?? ''})`;
  }
  return `${type} transaction`;
}

function describeRequest(pending: PendingZebgenRequest): string {
  switch (pending.type) {
    case 'connect':
      return 'Connect to Zebgen Wallet';
    case 'getAlgorandAddress':
      return 'Share Algorand Address';
    case 'getMoneroShareInfo':
      return 'Share Monero Key Material';
    case 'computeCombinedMoneroAddress':
      return 'Compute Combined Monero Address';
    case 'signAlgorandTransactions':
      return 'Sign Algorand Transaction';
    case 'computeMoneroLeakySignature':
      return 'Sign LeakSwap Claim/Refund (reveals Monero key)';
    default:
      return 'Zebgen Wallet Request';
  }
}

export default ExternalRequestApp;
