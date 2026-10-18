import { journalSignedAlgorandTransactions, saveVerifiedLeakSwap, listVerifiedLeakSwaps, validateAgreementSigning } from '../../lib/wallet/swapRecordVault';
import algosdk from 'algosdk';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { browser } from 'wxt/browser';

import { currentRestoreHeight, rememberSwapAddressHeight, swapAddressHeight } from '../../lib/monero/restoreHeight';
import { scanMoneroFunding, type MoneroFundingControl } from '../../lib/monero/moneroDaemon';
import { fundingRestoreHeight, validateFundingParams } from '../../lib/provider/fundingValidation';
import { getNetworkSettings } from '../../lib/network/networkStore';
import { base64ToBytes, bytesToBase64 } from '../../lib/provider/base64';
import { requestsSwapReady } from '../../lib/provider/transactionPreview';
import type { GetPendingRequestResponse, PendingZebgenRequest } from '../../lib/provider/types';
import {
  deriveActiveSeedAlgoAddressAtIndex,
  getSignedInState,
  signRawTransactions,
  unlockWallet,
} from '../../lib/wallet/algoWallet';
import { leakySign } from '../../lib/wallet/leakySign';
import { getMoneroWalletState, loadMoneroCombinedContext, saveMoneroCombinedContext, unlockMoneroWallet } from '../../lib/wallet/moneroVault';
import { combinePrivateSpendKeys, computeCombinedAddressWithPrivateAndPublic } from '../../lib/wallet/moneroWallet';
import type { ZebgenSaveLeakSwapParams } from '../../lib/provider/types';
import { createSwapInvite, acceptSwapInvite, confirmSwapAcceptance, type SwapInviteTerms } from '../../lib/wallet/swapHandshakeVault';
import { parseHandshakeLink, verifyHandshake, type SignedOffer } from 'leakswap-utils/dist/swapHandshake.js';

interface ExternalRequestAppProps {
  requestId: string;
}

type Stage = 'loading' | 'consent' | 'unlock' | 'error';
type ApprovalPhase = 'unlocking' | 'validating' | 'monero' | 'signing';

const APPROVAL_PHASE_LABELS: Record<ApprovalPhase, string> = {
  unlocking: 'Unlocking wallet...',
  validating: 'Validating Algorand transaction...',
  monero: 'Checking Monero deposit...',
  signing: 'Signing Algorand transaction...',
};

function ExternalRequestApp({ requestId }: ExternalRequestAppProps) {
  const [pending, setPending] = useState<PendingZebgenRequest | null>(null);
  const [originApproved, setOriginApproved] = useState(false);
  const [stage, setStage] = useState<Stage>('loading');
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [approvalPhase, setApprovalPhase] = useState<ApprovalPhase>('unlocking');
  const scanController = useRef<AbortController | null>(null);
  const [scanProgress, setScanProgress] = useState<{ scannedHeight: number; targetHeight: number } | null>(null);
  const [reviewOffer, setReviewOffer] = useState<SignedOffer | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (pending?.type !== 'acceptSwapInvite') return;
    const link = (pending.params as { link: string }).link;
    parseHandshakeLink(link).then(async (message) => {
      if (message.kind !== 'invite') throw new Error('Expected an invite.');
      await verifyHandshake(message, algosdk.decodeAddress(message.payload.aliAlgoAddress).publicKey);
      if (!cancelled) setReviewOffer(message);
    }).catch((failure) => { if (!cancelled) setReviewError(failure instanceof Error ? failure.message : 'Invalid invite.'); });
    return () => { cancelled = true; };
  }, [pending]);

  useEffect(() => {
    const cancel = () => scanController.current?.abort();
    window.addEventListener('pagehide', cancel);
    return () => {
      cancel();
      window.removeEventListener('pagehide', cancel);
    };
  }, []);

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
    setApprovalPhase('unlocking');
    setScanProgress(null);
    try {
      await unlockWallet(secret);
      const controller = new AbortController();
      scanController.current = controller;
      setScanProgress(null);
      const result = await computeResult(pending, secret, {
        signal: controller.signal,
        onProgress: (progress) => {
          setApprovalPhase('monero');
          setScanProgress(progress);
        },
      }, setApprovalPhase);
      await respond(true, result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to complete request.');
      setIsBusy(false);
    }
  }

  async function onReject() {
    scanController.current?.abort();
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
        {pending.type === 'signAlgorandTransactions' && requestsSwapReady(pending.params as import('../../lib/provider/types').ZebgenSignAlgorandTransactionsParams) ? (
          <p className="hint">Marks the swap ready for Xin to claim ALGO. For a saved agreement, Zebgen verifies the Monero deposit and its confirmations before signing this Algorand transaction.</p>
        ) : null}

        {pending.type === 'computeMoneroLeakySignature' ? (
          <p className="error">
            Warning: signing this will permanently reveal your Monero private spend key on the Algorand blockchain.
            Only do this if you intend to claim or refund this swap right now.
          </p>
        ) : null}

        {pending.type === 'saveLeakSwap' ? <p>Application {(pending.params as ZebgenSaveLeakSwapParams).appId}</p> : null}
        {pending.type === 'createSwapInvite' || pending.type === 'acceptSwapInvite' ? (
          <div>
            <p>Authentication only. This does not authorize a transaction or transfer funds.</p>
            <p className="privacy-notice">The link shares this wallet’s private view key. Use dedicated swap keys to avoid exposing unrelated incoming transactions.</p>
            {(() => {
              const terms = pending.type === 'createSwapInvite' ? pending.params as SwapInviteTerms : reviewOffer?.payload;
              if (!terms) return <p>{reviewError ?? 'Verifying invite...'}</p>;
              return <dl>
                <dt>ALGO</dt><dd>{(BigInt(terms.algoAmount) / 1000000n).toString()}.{(BigInt(terms.algoAmount) % 1000000n).toString().padStart(6, '0')}</dd>
                <dt>XMR</dt><dd>{(BigInt(terms.xmrAmount) / 1000000000000n).toString()}.{(BigInt(terms.xmrAmount) % 1000000000000n).toString().padStart(12, '0')}</dd>
                <dt>Deposit deadline</dt><dd>{new Date(terms.t0 * 1000).toISOString()}</dd>
                <dt>Final expiry</dt><dd>{new Date(terms.t1 * 1000).toISOString()}</dd>
                {reviewOffer ? <><dt>Ali</dt><dd style={{ overflowWrap: 'anywhere' }}>{reviewOffer.payload.aliAlgoAddress}</dd>
                  <dt>Algorand genesis</dt><dd style={{ overflowWrap: 'anywhere' }}>{reviewOffer.payload.algoGenesisHash}</dd>
                  <dt>Monero network</dt><dd>{reviewOffer.payload.moneroNetwork}</dd></> : null}
              </dl>;
            })()}
          </div>
        ) : null}
        {pending.type === 'listLeakSwaps' ? <p className="privacy-notice">Shares saved swap identities and private view keys with this page. Private spend keys are not shared.</p> : null}

        {pending.type === 'scanCombinedMoneroFunding' ? (
          <p className="hint">
            View-only scan of combined-address received outputs. Spent status is unknown; these totals
            cannot prove funds remain available. Private spend keys and the combined private view key
            are not returned by this request.
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
              <button type="button" className="secondary" onClick={onReject} disabled={isBusy && pending.type !== 'scanCombinedMoneroFunding' && approvalPhase !== 'monero'}>
                {isBusy && (pending.type === 'scanCombinedMoneroFunding' || approvalPhase === 'monero') ? 'Cancel scan' : 'Deny'}
              </button>
              <button type="submit" disabled={isBusy || !secret || (pending.type === 'acceptSwapInvite' && !reviewOffer)}>
                {isBusy ? pending.type === 'signAlgorandTransactions' ? APPROVAL_PHASE_LABELS[approvalPhase] : 'Approving...' : 'Unlock and Approve'}
              </button>
            </div>
          </form>
        )}

        {error ? <p className="error">{error}</p> : null}
        {isBusy && pending.type === 'signAlgorandTransactions' ? <p role="status">
          {approvalPhase === 'monero' && scanProgress
            ? `Checking Monero deposit: block ${scanProgress.scannedHeight.toLocaleString()} of ${scanProgress.targetHeight.toLocaleString()}`
            : APPROVAL_PHASE_LABELS[approvalPhase]}
        </p> : isBusy && scanProgress ? <p role="status">Scanning Monero: block {scanProgress.scannedHeight.toLocaleString()} of {scanProgress.targetHeight.toLocaleString()}</p> : null}
      </section>
    </main>
  );
}

async function computeResult(pending: PendingZebgenRequest, secret: string, control?: MoneroFundingControl, onPhase?: (phase: ApprovalPhase) => void): Promise<unknown> {
  const networkSettings = await getNetworkSettings();
  if (pending.type === 'createSwapInvite') return createSwapInvite(pending.params as SwapInviteTerms, secret);
  if (pending.type === 'acceptSwapInvite') return acceptSwapInvite((pending.params as { link: string }).link, secret);
  if (pending.type === 'confirmSwapAcceptance') return confirmSwapAcceptance((pending.params as { link: string }).link, secret);

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
    const walletId = params.moneroWalletId ?? (await getMoneroWalletState()).activeWalletId;
    if (walletId === null) throw new Error('No Monero wallet found. Create one in the wallet first.');
    const material = await unlockMoneroWallet(secret, networkSettings.monero.networkType, walletId);
    if (!material) {
      throw new Error('No Monero wallet found. Create one in the wallet first.');
    }
    const combined = computeCombinedAddressWithPrivateAndPublic(
      material.privateSpendKey,
      material.privateViewKey,
      params.counterpartyPrivateViewKey,
      params.counterpartyPublicSpendKey,
      networkSettings.monero.networkType
    );
    const saved = await loadMoneroCombinedContext({ walletId, network: networkSettings.monero.network,
      combinedAddress: combined.combinedAddress }, secret);
    const height = saved?.restoreHeight ?? await currentRestoreHeight(networkSettings.monero);
    const legacyHeight = await swapAddressHeight(combined.combinedAddress);
    const restoreHeight = Math.min(height ?? 0, fundingRestoreHeight(undefined, legacyHeight ?? height));
    await saveMoneroCombinedContext({
      version: 1,
      walletId,
      network: networkSettings.monero.network,
      combinedAddress: combined.combinedAddress,
      counterpartyPublicSpendKey: params.counterpartyPublicSpendKey,
      counterpartyPrivateViewKey: params.counterpartyPrivateViewKey,
      restoreHeight,
    }, secret);
    await rememberSwapAddressHeight(combined.combinedAddress, restoreHeight);
    return combined;
  }

  if (pending.type === 'scanCombinedMoneroFunding') {
    const params = pending.params;
    validateFundingParams(params);
    const walletId = params.moneroWalletId ?? (await getMoneroWalletState()).activeWalletId;
    if (walletId === null) throw new Error('No Monero wallet found. Create one in the wallet first.');
    const material = await unlockMoneroWallet(secret, networkSettings.monero.networkType, walletId);
    if (!material) throw new Error('No Monero wallet found. Create one in the wallet first.');
    const combined = computeCombinedAddressWithPrivateAndPublic(
      material.privateSpendKey,
      material.privateViewKey,
      params.counterpartyPrivateViewKey,
      params.counterpartyPublicSpendKey,
      networkSettings.monero.networkType
    );
    const saved = await loadMoneroCombinedContext({ walletId, network: networkSettings.monero.network,
      combinedAddress: combined.combinedAddress }, secret);
    const restoreHeight = fundingRestoreHeight(params.restoreHeight,
      saved?.restoreHeight ?? await swapAddressHeight(combined.combinedAddress));
    const funding = await scanMoneroFunding(
      networkSettings.monero,
      combined.combinedPublicSpendKey,
      combinePrivateSpendKeys(material.privateViewKey, params.counterpartyPrivateViewKey),
      restoreHeight,
      control
    );
    return { ...funding, combinedAddress: combined.combinedAddress };
  }

  if (pending.type === 'signAlgorandTransactions') {
    const params = pending.params as import('../../lib/provider/types').ZebgenSignAlgorandTransactionsParams;
    onPhase?.('validating');
    await validateAgreementSigning(params, secret, control);
    control?.signal?.throwIfAborted();
    onPhase?.('signing');
    const unsignedTxns = params.indexesToSign.map((index) => base64ToBytes(params.txns[index]));
    const signed = await signRawTransactions(secret, params.addressIndex ?? 0, unsignedTxns);
    await journalSignedAlgorandTransactions(unsignedTxns, pending.origin, secret);
    return { signedTxns: signed.map((bytes) => bytesToBase64(bytes)) };
  }

  if (pending.type === 'saveLeakSwap') return saveVerifiedLeakSwap(pending.params as ZebgenSaveLeakSwapParams, secret);
  if (pending.type === 'listLeakSwaps') return listVerifiedLeakSwaps(secret);

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
    case 'scanCombinedMoneroFunding':
      return 'Check Combined Monero Funding (View Only)';
    case 'saveLeakSwap':
      return 'Save LeakSwap Recovery Record';
    case 'listLeakSwaps':
      return 'Share Saved LeakSwaps';
    case 'createSwapInvite':
      return 'Authenticate LeakSwap Offer';
    case 'acceptSwapInvite':
      return 'Authenticate LeakSwap Acceptance';
    case 'confirmSwapAcceptance':
      return 'Verify Acceptance Against Saved Offer';
    case 'signAlgorandTransactions':
      return requestsSwapReady(pending.params as import('../../lib/provider/types').ZebgenSignAlgorandTransactionsParams)
        ? 'Confirm Swap Ready' : 'Sign Algorand Transaction';
    case 'computeMoneroLeakySignature':
      return 'Sign LeakSwap Claim/Refund (reveals Monero key)';
    default:
      return 'Zebgen Wallet Request';
  }
}

export default ExternalRequestApp;
