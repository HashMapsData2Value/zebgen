import assert from 'node:assert/strict';
import test from 'node:test';
import { swapAttention, refundDecisionMargin, deadlineRemaining } from '../../leakswap-all/leakswap-protocol/leakswap-utils/src/swapAttention.ts';

test('preset margins and custom heuristic match decision guidance', () => {
  assert.equal(refundDecisionMargin(10000, 17200), 1800);
  assert.equal(refundDecisionMargin(10000, 31600), 3600);
  assert.equal(refundDecisionMargin(10000, 96400), 7200);
  assert.equal(refundDecisionMargin(10000, 11200), 300);
});

test('decision and deadline boundaries preserve inclusive refund and exclusive final claim', () => {
  assert.equal(swapAttention('ali', 10000, 17200, 8199, 'awaiting').priority, 1);
  assert.equal(swapAttention('ali', 10000, 17200, 8200, 'awaiting').title, 'Refund decision due');
  assert.equal(swapAttention('ali', 10000, 17200, 10000, 'awaiting').title, 'Refund decision due');
  assert.equal(swapAttention('ali', 10000, 17200, 10001, 'awaiting').title, 'Xin can claim');
  assert.equal(swapAttention('xin', 10000, 17200, 17199, 'ready').title, 'Claim needs attention');
  assert.equal(swapAttention('xin', 10000, 17200, 17200, 'ready').title, 'Claim window may have closed');
});

test('unknown or unavailable apps never assert refund eligibility or confirmed settlement', () => {
  for (const now of [0, 8200, 10000, 20000]) {
    assert.match(swapAttention('ali', 10000, 17200, now, 'unknown').title, /Verify|Check/);
    assert.equal(swapAttention('ali', 10000, 17200, now, 'unavailable').priority, 0);
  }
});

test('ready suppresses premature refund prompts and countdowns handle subminute deadlines', () => {
  assert.equal(swapAttention('ali', 10000, 17200, 9000, 'ready').title, 'Xin can claim');
  assert.equal(swapAttention('xin', 10000, 17200, 9000, 'ready').priority, 3);
  assert.equal(deadlineRemaining(10000, 9999), 'in 1m');
  assert.equal(deadlineRemaining(10000, 10000), '0m ago');
});