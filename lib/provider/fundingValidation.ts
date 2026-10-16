import type { ZebgenScanCombinedMoneroFundingParams } from './types';

const REQUEST_TYPES = new Set([
  'connect', 'getAlgorandAddress', 'getMoneroShareInfo', 'computeCombinedMoneroAddress',
  'scanCombinedMoneroFunding', 'signAlgorandTransactions', 'computeMoneroLeakySignature',
  'saveLeakSwap', 'listLeakSwaps',
  'createSwapInvite', 'acceptSwapInvite',
  'confirmSwapAcceptance',
]);

export function validateProviderRequest(type: unknown, params: unknown): void {
  if (typeof type !== 'string' || !REQUEST_TYPES.has(type)) {
    throw new Error('Unsupported Zebgen request type.');
  }
  if (type === 'scanCombinedMoneroFunding') validateFundingParams(params);
    if (type === 'signAlgorandTransactions' || type === 'saveLeakSwap') {
      const input = params as { agreementDigest?: unknown; agreementAppId?: unknown } | null;
      if (input?.agreementDigest !== undefined && (typeof input.agreementDigest !== 'string' || !/^[0-9a-f]{64}$/.test(input.agreementDigest))) throw new Error('Invalid agreement digest.');
      if (input?.agreementAppId !== undefined && (!input.agreementDigest || typeof input.agreementAppId !== 'string'
        || !/^[1-9][0-9]*$/.test(input.agreementAppId) || BigInt(input.agreementAppId) > 0xffffffffffffffffn)) throw new Error('Invalid agreement application ID.');
    }
  if (type === 'createSwapInvite') {
    const input = params as Record<string, unknown> | null;
    if (!input || Object.keys(input).sort().join(',') !== 'algoAmount,t0,t1,xmrAmount'
      || ![input.algoAmount, input.xmrAmount].every((amount) => typeof amount === 'string' && /^[1-9][0-9]{0,19}$/.test(amount) && BigInt(amount) <= 0xffffffffffffffffn)
      || !Number.isSafeInteger(input.t0) || (input.t0 as number) <= 0 || !Number.isSafeInteger(input.t1)
      || (input.t1 as number) <= (input.t0 as number) || (input.t1 as number) > 8640000000000) throw new Error('Invalid swap invite terms.');
  }
  if (type === 'acceptSwapInvite' || type === 'confirmSwapAcceptance') {
    const input = params as { link?: unknown } | null;
    if (!input || Object.keys(input).join(',') !== 'link' || typeof input.link !== 'string' || input.link.length > 12512) throw new Error('Invalid swap invite link.');
  }
  if (type === 'saveLeakSwap') {
    const input = params as { appId?: unknown; combinedAddress?: unknown } | null;
    if (!input || typeof input.appId !== 'string' || !/^[1-9][0-9]*$/.test(input.appId)
      || BigInt(input.appId) > 0xffffffffffffffffn || typeof input.combinedAddress !== 'string'
      || !/^[1-9A-HJ-NP-Za-km-z]{95}$/.test(input.combinedAddress)) throw new Error('Invalid swap identity.');
  }
}

export function fundingRestoreHeight(explicit: number | undefined, remembered: number | undefined): number {
  const height = explicit ?? remembered ?? 0;
  if (!Number.isInteger(height) || height < 0 || height > 0xffffffff) {
    throw new Error('Restore height must be a u32 integer.');
  }
  return height;
}

export function validateFundingParams(params: unknown): asserts params is ZebgenScanCombinedMoneroFundingParams {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    throw new Error('Funding scan parameters are required.');
  }
  const input = params as Record<string, unknown>;
  for (const field of ['counterpartyPrivateViewKey', 'counterpartyPublicSpendKey']) {
    if (typeof input[field] !== 'string' || !/^[0-9a-f]{64}$/i.test(input[field])) {
      throw new Error(`${field} must be a 32-byte hex key.`);
    }
  }
  if (input.moneroWalletId !== undefined &&
      (!Number.isSafeInteger(input.moneroWalletId) || (input.moneroWalletId as number) < 0)) {
    throw new Error('Monero wallet ID must be a non-negative safe integer.');
  }
  if (input.restoreHeight !== undefined) {
    if (typeof input.restoreHeight !== 'number') throw new Error('Restore height must be a u32 integer.');
    fundingRestoreHeight(input.restoreHeight, undefined);
  }
}