import type { ZebgenScanCombinedMoneroFundingParams } from './types';

const REQUEST_TYPES = new Set([
  'connect', 'getAlgorandAddress', 'getMoneroShareInfo', 'computeCombinedMoneroAddress',
  'scanCombinedMoneroFunding', 'signAlgorandTransactions', 'computeMoneroLeakySignature',
]);

export function validateProviderRequest(type: unknown, params: unknown): void {
  if (typeof type !== 'string' || !REQUEST_TYPES.has(type)) {
    throw new Error('Unsupported Zebgen request type.');
  }
  if (type === 'scanCombinedMoneroFunding') validateFundingParams(params);
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