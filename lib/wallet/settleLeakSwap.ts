import algosdk from 'algosdk';
import { hexToBytes } from '@noble/hashes/utils.js';
import { getNetworkSettings } from '../network/networkStore';
import { verifyAlgorandGenesis } from '../network/chainIdentity';
import { bytesToBase64 } from '../provider/base64';
import { validateProviderRequest } from '../provider/fundingValidation';
import { assertConnectionAccounts } from '../provider/connectionApproval';
import { deriveActiveSeedAlgoAddressAtIndex, signRawTransactions } from './algoWallet';
import { resolveSwapWalletId } from './swapHandshakeVault';
import { unlockMoneroWallet } from './moneroVault';
import { verifyAgreementApplication, journalSignedAlgorandTransactions } from './swapRecordVault';
import { agreementSponsorLogicSig } from './swapAgreementArtifact';
import { assertSafeSigningRequest, checkAgreementTransaction } from './swapAgreementTransactions';
import { leakySign } from './leakySign';

export interface SettleLeakSwapParams {
  agreementDigest: string;
  appId: string;
  action: 'claim' | 'refund';
}

export interface SettleLeakSwapResult {
  txId: string;
  confirmedRound: string;
}

const TREASURY = 'KMRBWAK47LNYSDWH2FW3Q7BLZFXKHXURZG3SVUONHBHG5MPBNB2PIZKZBA';

export async function settleLeakSwap(params: SettleLeakSwapParams, secret: string, origin: string, signal?: AbortSignal): Promise<SettleLeakSwapResult> {
  validateProviderRequest('settleLeakSwap', params);
  return navigator.locks.request(`leakswap-settle:${params.agreementDigest}`, async () => {
    const settings = await getNetworkSettings();
    const endpoint = settings.algorand.algod;
    const algod = new algosdk.Algodv2(endpoint.token, endpoint.server, endpoint.port);
    const appId = BigInt(params.appId);
    const agreement = await verifyAgreementApplication(params.agreementDigest, appId, secret);
    const offer = agreement.offer.payload;
    const acceptance = agreement.acceptance.payload;
    const claim = params.action === 'claim';
    const sender = claim ? acceptance.xinAlgoAddress : offer.aliAlgoAddress;
    const publicSpendKey = claim ? acceptance.xinPublicSpendKey : offer.aliPublicSpendKey;
    const assertActive = async () => {
      if (signal?.aborted) throw new Error('Settlement cancelled. If simulation started, treat the swap key share as disclosed to the node.');
      await assertConnectionAccounts(origin, params);
      if ((await deriveActiveSeedAlgoAddressAtIndex(secret, 0)).algoAddress !== sender) throw new Error('Only the agreed settlement party may continue.');
      if (JSON.stringify(await getNetworkSettings()) !== JSON.stringify(settings)) throw new Error('Network settings changed during settlement.');
      const currentTime = Math.floor(Date.now() / 1000);
      if (claim ? currentTime >= offer.t1 : currentTime > offer.t0) {
        throw new Error('Settlement deadline passed during approval. If simulation started, treat the swap key share as disclosed to the node.');
      }
    };
    await assertActive();
    const suggestedParams = await algod.getTransactionParams().do();
    verifyAlgorandGenesis(settings.algorand.network, suggestedParams.genesisID ?? '', endpoint.server);
    if (!suggestedParams.genesisHash || bytesToBase64(suggestedParams.genesisHash) !== offer.algoGenesisHash) throw new Error('Settlement network does not match the agreement.');
    const app = await algod.getApplicationByID(appId).do();
    const ready = app.params?.globalState?.find(entry => new TextDecoder().decode(entry.key) === 'aliReady')?.value.uint;
    if (ready === undefined) throw new Error('Swap readiness is unavailable.');
    const status = await algod.status().do();
    const block = await algod.block(status.lastRound).do();
    const timestamp = Number(block.block.header.timestamp);
    const now = Math.max(timestamp, Math.floor(Date.now() / 1000));
    if (!Number.isSafeInteger(timestamp) || timestamp <= 0) throw new Error('Chain timestamp is unavailable.');
    if (claim ? now >= offer.t1 || (ready === 0n && timestamp <= offer.t0) : ready !== 0n || now > offer.t0) {
      throw new Error('The requested settlement is not available at the current readiness or deadline.');
    }
    const escrow = await algod.accountInformation(algosdk.getApplicationAddress(appId)).do();
    if (escrow.amount < BigInt(offer.algoAmount)) throw new Error('Escrow balance is below the authenticated ALGO amount.');
    const sponsor = agreementSponsorLogicSig(appId, agreement);
    const sponsorBalance = await algod.accountInformation(sponsor.address()).do();
    const fee = claim ? 7000n : 5000n;
    if (sponsorBalance.amount < 100000n + fee) throw new Error('Settlement fee sponsor is underfunded.');
    if ((suggestedParams.minFee ?? 1000n) > 1000n) throw new Error('Network minimum fee exceeds the supported settlement fee.');
    const walletId = await resolveSwapWalletId(params.agreementDigest, secret);
    if (walletId === null) throw new Error('Swap key share is unavailable.');
    const material = await unlockMoneroWallet(secret, settings.monero.networkType, walletId);
    if (!material || material.publicSpendKey !== publicSpendKey) throw new Error('Swap spend key does not match the agreement.');
    const buildGroup = (signature: Uint8Array) => {
      const composer = new algosdk.AtomicTransactionComposer();
      const sponsorPayment = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        sender: sponsor.address(), receiver: sender, amount: 0n, closeRemainderTo: sender,
        suggestedParams: { ...suggestedParams, flatFee: true, fee: 0n },
      });
      composer.addMethodCall({
        appID: appId, sender, onComplete: algosdk.OnApplicationComplete.DeleteApplicationOC,
        method: algosdk.ABIMethod.fromSignature(claim ? 'leakyClaim(byte[],pay)void' : 'leakyRefund(byte[],pay)void'),
        methodArgs: [signature, { txn: sponsorPayment, signer: async () => [] }],
        appAccounts: claim ? [TREASURY] : undefined,
        suggestedParams: { ...suggestedParams, flatFee: true, fee }, signer: async () => [],
      });
      return composer.buildGroup().map(entry => entry.txn);
    };
    const preview = buildGroup(new Uint8Array(64));
    assertSafeSigningRequest(preview, [1]);
    checkAgreementTransaction(preview[1], agreement, settings.monero.network);
    await assertActive();
    const scalar = hexToBytes(material.privateSpendKey);
    let signature: Uint8Array;
    try { signature = leakySign(algosdk.getApplicationAddress(appId).publicKey, scalar); }
    finally { scalar.fill(0); }
    try {
      const group = buildGroup(signature);
      const txId = group[1].txID();
      const unsigned = algosdk.encodeUnsignedTransaction(group[1]);
      await journalSignedAlgorandTransactions([unsigned], origin, secret);
      await assertActive();
      const sponsorBlob = algosdk.signLogicSigTransactionObject(group[0], sponsor).blob;
      const simulation = new algosdk.modelsv2.SimulateRequest({
        txnGroups: [new algosdk.modelsv2.SimulateRequestTransactionGroup({ txns: [
          algosdk.decodeSignedTransaction(sponsorBlob), new algosdk.SignedTransaction({ txn: group[1] }),
        ] })], allowEmptySignatures: true,
      });
      let simulated;
      try { simulated = (await algod.simulateTransactions(simulation).do()).txnGroups[0]; }
      catch { throw new Error(`Settlement simulation unavailable. No Algorand transaction was signed. The node may have received the revealing signature. Reference: ${txId}`); }
      if (!simulated || simulated.failureMessage) throw new Error(`Settlement simulation rejected the group. No Algorand transaction was signed. The node received the revealing signature. Reference: ${txId}`);
      await assertActive();
      const signed = await signRawTransactions(secret, 0, [unsigned]);
      await assertActive();
      try {
        await algod.sendRawTransaction([sponsorBlob, signed[0]]).do();
        const confirmed = await algosdk.waitForConfirmation(algod, txId, 4);
        if (!confirmed.confirmedRound) throw new Error('Unconfirmed');
        return { txId, confirmedRound: confirmed.confirmedRound.toString() };
      } catch {
        throw new Error(`Settlement submission or confirmation is uncertain. Check this transaction before retrying: ${txId}. The swap key share has been disclosed to the node.`);
      }
    } finally { signature.fill(0); }
  });
}