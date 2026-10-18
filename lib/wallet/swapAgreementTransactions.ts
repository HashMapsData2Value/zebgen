import algosdk from 'algosdk';
import { bytesToHex } from '@noble/hashes/utils.js';
import { assertAgreementState, assertAgreementFunding, type SwapAgreement } from 'leakswap-utils/dist/swapAgreement.js';
import { bytesToBase64 } from '../provider/base64.ts';

export function checkAgreementTransaction(txn: algosdk.Transaction, agreement: SwapAgreement, moneroNetwork: string): void {
  if (txn.rekeyTo || txn.payment?.closeRemainderTo) throw new Error('Agreement transactions cannot rekey or close accounts.');
  if (bytesToBase64(txn.genesisHash ?? new Uint8Array()) !== agreement.offer.payload.algoGenesisHash) throw new Error('Agreement transaction network mismatch.');
  const app = txn.applicationCall;
  if (!app || app.appIndex !== 0n) return;
  const args = app.appArgs.map((bytes) => new Uint8Array(bytes));
  const selector = algosdk.ABIMethod.fromSignature('createApplication(byte[],account,byte[],uint64,uint64)void').getSelector();
  if (app.appArgs.length !== 6 || bytesToHex(app.appArgs[0]) !== bytesToHex(selector)) throw new Error('Unexpected agreement deployment method.');
  const accountIndex = Number(algosdk.ABIType.from('uint8').decode(args[2]));
  const xinAddress = accountIndex === 0 ? txn.sender.toString() : app.accounts[accountIndex - 1]?.toString();
  assertAgreementState(agreement, {
    genesisHash: bytesToBase64(txn.genesisHash!), moneroNetwork,
    aliAddress: txn.sender.toString(), xinAddress: xinAddress ?? '',
    aliPublicSpendKey: bytesToHex(Uint8Array.from(algosdk.ABIType.from('byte[]').decode(args[1]) as number[])),
    xinPublicSpendKey: bytesToHex(Uint8Array.from(algosdk.ABIType.from('byte[]').decode(args[3]) as number[])),
    t0: Number(algosdk.ABIType.from('uint64').decode(args[4])), t1: Number(algosdk.ABIType.from('uint64').decode(args[5]))
  });
}

export function checkAgreementEscrowPayment(txn: algosdk.Transaction, agreement: SwapAgreement, appId: bigint): void {
  if (txn.sender.toString() !== agreement.offer.payload.aliAlgoAddress
    || txn.payment?.receiver.toString() !== algosdk.getApplicationAddress(appId).toString()) throw new Error('Agreement escrow payment identity mismatch.');
  assertAgreementFunding(agreement, txn.payment.amount);
}

export function checkAgreementSponsorPayment(txn: algosdk.Transaction, agreement: SwapAgreement, sponsor: string): void {
  if (txn.sender.toString() !== agreement.offer.payload.aliAlgoAddress || txn.payment?.amount !== 209000n
    || txn.payment.receiver.toString() !== sponsor) throw new Error('Unexpected agreement sponsor funding.');
}