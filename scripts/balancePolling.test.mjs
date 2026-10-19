import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as react from 'react';
import * as jsx from 'react/jsx-runtime';
import * as scanHeight from '../lib/monero/scanHeight.ts';

test('Monero polls every five seconds, scans only changed heights, and keeps manual refresh', async () => {
  const effects = [];
  const timers = [];
  const values = ['1', '17500', false, null, null];
  let scans = 0;
  let height = 17563;
  let release;
  let blocked = false;
  const compiled = ts.transpileModule(
    readFileSync(new URL('../entrypoints/popup/MoneroBalance.tsx', import.meta.url), 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  ).outputText;
  const api = {};
  runInNewContext(compiled, {
    exports: api,
    console,
    Date,
    AbortController,
    window: {
      setInterval: (callback, delay) => {
        timers.push({ callback, delay });
        return timers.length;
      },
      clearInterval: () => {},
    },
    require: (name) => {
      if (name === 'react')
        return {
          useState: () => [values.shift(), () => {}],
          useRef: (initial) => ({ current: initial }),
          useEffect: (callback) => effects.push(callback),
        };
      if (name === 'react/jsx-runtime') return jsx;
      if (name === 'lucide-react') return { RefreshCw: () => null };
      if (name === './ScanActivity') return { default: () => null };
      if (name.endsWith('/scanHeight')) return scanHeight;
      if (name.endsWith('/formatAtomic')) return { formatAtomic: (value) => value };
      if (name.endsWith('/moneroBalanceCache'))
        return {
          balanceCheckpointKey: () => 'checkpoint',
          loadBalanceCheckpoint: async () => null,
          saveBalanceCheckpoint: async () => {},
        };
      if (name.endsWith('/hostPermissions')) return { ensureHostPermissions: async () => {} };
      if (name.endsWith('/messages'))
        return {
          probeMoneroDaemonViaBackground: async () => ({ ok: true, height }),
          scanMoneroBalanceViaBackground: async () => {
            scans++;
            if (blocked)
              await new Promise((resolve) => {
                release = resolve;
              });
            return { ok: true, balanceAtomic: '1' };
          },
        };
      return {};
    },
  });
  const tree = api.default({
    address: 'address',
    restoreHeight: 17500,
    config: { daemon: { uri: 'http://127.0.0.1:18081' } },
    walletId: 1,
    lockSecret: 'test',
  });
  const cleanup = effects.filter((_, index) => index !== 0).map((effect) => effect());
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 5000);
  await timers[0].callback();
  assert.equal(scans, 1);
  await timers[0].callback();
  assert.equal(scans, 1);
  height++;
  blocked = true;
  const pending = timers[0].callback();
  await new Promise((resolve) => setImmediate(resolve));
  await timers[0].callback();
  assert.equal(scans, 2);
  release();
  await pending;
  blocked = false;
  function findButton(element) {
    if (!react.isValidElement(element)) return null;
    if (element.props['aria-label'] === 'Scan unlocked balance') return element;
    for (const child of react.Children.toArray(element.props.children)) {
      const found = findButton(child);
      if (found) return found;
    }
    return null;
  }
  findButton(tree).props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(scans, 3);
  for (const dispose of cleanup) dispose?.();
});

test('Stop aborts scanning, enables a higher restore height and ignores late results', async () => {
  const states = [];
  const refs = [];
  const requests = [];
  let stateIndex;
  let refIndex;
  const api = {};
  const compiled = ts.transpileModule(
    readFileSync(new URL('../entrypoints/popup/MoneroBalance.tsx', import.meta.url), 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  ).outputText;
  runInNewContext(compiled, {
    exports: api,
    console,
    Date,
    AbortController,
    require: (name) => {
      if (name === 'react')
        return {
          useState(initial) {
            const index = stateIndex++;
            if (!(index in states)) states[index] = initial;
            return [
              states[index],
              (value) => {
                states[index] = value;
              },
            ];
          },
          useRef(initial) {
            const index = refIndex++;
            return (refs[index] ??= { current: initial });
          },
          useEffect() {},
        };
      if (name === 'react/jsx-runtime') return jsx;
      if (name === 'lucide-react') return { RefreshCw: () => null };
      if (name === './ScanActivity') return { default: 'scan-activity' };
      if (name.endsWith('/scanHeight')) return scanHeight;
      if (name.endsWith('/formatAtomic')) return { formatAtomic: (value) => value };
      if (name.endsWith('/moneroBalanceCache'))
        return {
          balanceCheckpointKey: () => 'checkpoint',
          loadBalanceCheckpoint: async () => null,
          saveBalanceCheckpoint: async () => {},
        };
      if (name.endsWith('/hostPermissions')) return { ensureHostPermissions: async () => {} };
      if (name.endsWith('/messages'))
        return {
          probeMoneroDaemonViaBackground: async () => ({ ok: true, height: 17563 }),
          scanMoneroBalanceViaBackground: (request, control) =>
            new Promise((resolve) => {
              requests.push({ request, control, resolve });
            }),
        };
      return {};
    },
  });
  const props = {
    address: 'address',
    restoreHeight: 0,
    config: { daemon: { uri: 'http://127.0.0.1:18081' } },
    walletId: 1,
    lockSecret: 'test',
  };
  const render = () => {
    stateIndex = 0;
    refIndex = 0;
    return api.default(props);
  };
  function find(element, predicate) {
    if (!react.isValidElement(element)) return null;
    if (predicate(element)) return element;
    for (const child of react.Children.toArray(element.props.children)) {
      const match = find(child, predicate);
      if (match) return match;
    }
    return null;
  }
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  find(render(), (element) => element.type === 'details').props.onToggle({
    currentTarget: { open: true },
  });
  assert.equal(
    find(render(), (element) => element.props['aria-label'] === 'Scan unlocked balance'),
    null,
  );
  const explicitScan = find(
    render(),
    (element) => element.type === 'button' && element.props.children === 'Scan from this height',
  );
  assert.equal(explicitScan.props.disabled, false);
  explicitScan.props.onClick();
  await settle();
  assert.equal(requests[0].request.restoreHeight, 0);
  find(render(), (element) => element.type === 'scan-activity').props.onStop();
  assert.equal(requests[0].control.signal.aborted, true);
  const heightInput = find(render(), (element) => element.props.id === 'balance-restore-height');
  assert.equal(heightInput.props.disabled, false);
  heightInput.props.onChange({ target: { value: '17500' } });
  find(
    render(),
    (element) => element.type === 'button' && element.props.children === 'Scan from this height',
  ).props.onClick();
  await settle();
  assert.equal(requests[1].request.restoreHeight, 17500);
  requests[0].resolve({ ok: true, balanceAtomic: '999' });
  await settle();
  assert.equal(
    find(render(), (element) => element.props['aria-busy'] !== undefined).props['aria-busy'],
    true,
  );
  requests[1].resolve({ ok: true, balanceAtomic: '42' });
  await settle();
  assert.equal(states[0], '42');
  assert.equal(
    find(render(), (element) => element.props['aria-busy'] !== undefined).props['aria-busy'],
    false,
  );
});
