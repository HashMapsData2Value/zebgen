import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSwapFundingTime, MIN_DEPOSIT_WINDOW_SECONDS, MIN_CLAIM_WINDOW_SECONDS } from '../lib/wallet/swapTimingPolicy.ts';

const now = 1900000000;
const terms = { t0: now + MIN_DEPOSIT_WINDOW_SECONDS, t1: now + MIN_DEPOSIT_WINDOW_SECONDS + MIN_CLAIM_WINDOW_SECONDS };

test('funding permits exactly the minimum windows and longer windows', () => {
  assert.equal(MIN_DEPOSIT_WINDOW_SECONDS, 3600);
  assert.equal(MIN_CLAIM_WINDOW_SECONDS, 3600);
  assert.doesNotThrow(() => assertSwapFundingTime(terms, now));
  assert.doesNotThrow(() => assertSwapFundingTime({ t0: terms.t0 + 1, t1: terms.t1 + 2 }, now));
});

test('funding rejects short, expired and elapsed deposit windows', () => {
  for (const t0 of [now - 1, now, now + 1, terms.t0 - 1]) {
    assert.throws(() => assertSwapFundingTime({ ...terms, t0 }, now), /60 minutes.*deposit deadline/);
  }
  assert.throws(() => assertSwapFundingTime(terms, now + 1), /60 minutes.*deposit deadline/);
});

test('funding rejects short, reversed and equal claim windows', () => {
  for (const t1 of [terms.t0 - 1, terms.t0, terms.t1 - 1]) {
    assert.throws(() => assertSwapFundingTime({ ...terms, t1 }, now), /claim window.*60 minutes/);
  }
});

test('funding fails closed on malformed timestamps', () => {
  for (const value of [NaN, Infinity, 0, -1, 1.5, '1900000000', undefined]) {
    assert.throws(() => assertSwapFundingTime({ ...terms, t0: value }, now), /valid Unix seconds/);
    assert.throws(() => assertSwapFundingTime({ ...terms, t1: value }, now), /valid Unix seconds/);
    assert.throws(() => assertSwapFundingTime(terms, value === undefined ? NaN : value), /valid Unix seconds/);
  }
});