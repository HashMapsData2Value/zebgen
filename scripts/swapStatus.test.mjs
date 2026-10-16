import assert from 'node:assert/strict';
import test from 'node:test';
import { swapStatus } from '../lib/wallet/swapStatus.ts';

const snapshot = { role: 'ali', t0: 10000, t1: 17200, state: 'awaiting', funding: 'present', checkedAt: 9000, chainTime: 9000 };

test('funding and verification stages describe both positions without claiming an XMR scan', () => {
  for (const role of ['ali', 'xin']) {
    assert.match(swapStatus({ ...snapshot, role, funding: 'empty' }, 9000).title, /Waiting for ALGO funding/);
    assert.match(swapStatus({ ...snapshot, role }, 9000).title, /Set Ready/);
    assert.match(swapStatus({ ...snapshot, role, funding: 'unknown' }, 9000).title, /not verified/);
  }
});

test('contract deadlines are inclusive for refunds and exclusive for timeout claims', () => {
  assert.match(swapStatus({ ...snapshot, chainTime: 10000 }, 9000).detail, /Leaky refund is allowed/);
  assert.equal(swapStatus({ ...snapshot, role: 'xin', chainTime: 10001 }, 9000).title, 'Leaky claim available');
  assert.equal(swapStatus({ ...snapshot, role: 'xin', state: 'ready', chainTime: 9999 }, 9000).title, 'Leaky claim available');
  assert.equal(swapStatus({ ...snapshot, chainTime: 17200 }, 9000).title, 'Punish refund available');
  assert.equal(swapStatus({ ...snapshot, role: 'xin', state: 'ready', chainTime: 17200 }, 9000).title, 'Claim window closed');
});

test('stale data, missing chain time and absent contracts do not invent settlement outcomes', () => {
  assert.equal(swapStatus(snapshot, 9091).title, 'Status not verified');
  assert.equal(swapStatus({ ...snapshot, chainTime: undefined }, 9000).title, 'Chain time unavailable');
  assert.match(swapStatus({ ...snapshot, state: 'unavailable' }, 9000).detail, /Settlement history is needed/);
  assert.equal(swapStatus({ ...snapshot, state: 'unknown', issue: 'Select the saved network.' }, 9000).detail, 'Select the saved network.');
  assert.equal(swapStatus({ ...snapshot, chainTime: 9999 }, 18000).title, 'Status not verified');
});