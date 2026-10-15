import assert from 'node:assert/strict';
import test from 'node:test';

import { fundingRestoreHeight, validateFundingParams, validateProviderRequest } from '../lib/provider/fundingValidation.ts';

const params = {
  counterpartyPrivateViewKey: '01'.repeat(32),
  counterpartyPublicSpendKey: '02'.repeat(32),
};

test('funding requests accept optional wallet and u32 restore heights', () => {
  for (const restoreHeight of [undefined, 0, 1, 0xffffffff]) {
    assert.doesNotThrow(() => validateProviderRequest('scanCombinedMoneroFunding', {
      ...params, moneroWalletId: 0, restoreHeight,
    }));
  }
});

test('funding requests reject invalid heights before approval or WASM conversion', () => {
  for (const restoreHeight of [-1, 0x100000000, 1.5, NaN, Infinity, '0', null]) {
    assert.throws(() => validateFundingParams({ ...params, restoreHeight }), /u32/);
  }
});

test('funding requests require both 32-byte keys and a valid optional wallet ID', () => {
  for (const value of [undefined, null, [], {}, { ...params, counterpartyPrivateViewKey: 'aa' },
    { ...params, counterpartyPublicSpendKey: 'zz'.repeat(32) }]) {
    assert.throws(() => validateFundingParams(value));
  }
  for (const moneroWalletId of [-1, 1.5, '1', null, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => validateFundingParams({ ...params, moneroWalletId }), /wallet ID/);
  }
});

test('restore height uses explicit input, remembered history, then zero, never a new chain tip', () => {
  assert.equal(fundingRestoreHeight(0, 900), 0);
  assert.equal(fundingRestoreHeight(100, 900), 100);
  assert.equal(fundingRestoreHeight(undefined, 900), 900);
  assert.equal(fundingRestoreHeight(undefined, undefined), 0);
  assert.throws(() => fundingRestoreHeight(undefined, 0x100000000), /u32/);
});

test('provider gate recognizes existing operations and rejects unknown requests', () => {
  for (const type of ['connect', 'getAlgorandAddress', 'getMoneroShareInfo',
    'computeCombinedMoneroAddress', 'signAlgorandTransactions', 'computeMoneroLeakySignature']) {
    assert.doesNotThrow(() => validateProviderRequest(type, {}));
  }
  assert.throws(() => validateProviderRequest('scanFunding', params), /Unsupported/);
});