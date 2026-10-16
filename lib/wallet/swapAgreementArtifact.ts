import algosdk from 'algosdk';
import { bytesToHex } from '@noble/hashes/utils.js';
import artifact from '../../../leakswap-all/leakswap-protocol/algorand/projects/algorand/smart_contracts/artifacts/leak_swap/LeakSwap.arc56.json';
import sponsorTemplate from '../../../leakswap-all/leakswap-protocol/algorand/projects/algorand/smart_contracts/artifacts/leak_swap/FeeSponsorLSig.teal?raw';
import type { SwapAgreement } from '../../../leakswap-all/leakswap-protocol/leakswap-utils/src/swapAgreement';
import { bytesToBase64, base64ToBytes } from '../provider/base64';

export function assertAgreementPrograms(approval: Uint8Array, clear: Uint8Array): void {
  if (bytesToBase64(approval) !== artifact.byteCode.approval || bytesToBase64(clear) !== artifact.byteCode.clear) throw new Error('Application bytecode does not match the supported LeakSwap protocol.');
}

export async function agreementSponsorAddress(algod: algosdk.Algodv2, appId: bigint, agreement: SwapAgreement): Promise<string> {
  const values: Record<string, string> = { TMPL_APP_ID: appId.toString(),
    TMPL_ALI_ADDR: `0x${bytesToHex(algosdk.decodeAddress(agreement.offer.payload.aliAlgoAddress).publicKey)}`,
    TMPL_XIN_ADDR: `0x${bytesToHex(algosdk.decodeAddress(agreement.acceptance.payload.xinAlgoAddress).publicKey)}` };
  const source = sponsorTemplate.replace(/\bTMPL_(?:APP_ID|ALI_ADDR|XIN_ADDR)\b/g, (token) => values[token]);
  const result = await algod.compile(new TextEncoder().encode(source)).do();
  return new algosdk.LogicSigAccount(base64ToBytes(result.result)).address().toString();
}