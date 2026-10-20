import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

function load(path, dependencies, globals = {}) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(source, {
    exports,
    require: (name) => {
      assert.ok(name in dependencies, `Unexpected dependency ${name}`);
      return dependencies[name];
    },
    AbortController,
    console,
    ...globals,
  });
  return exports;
}

test('scan tab clears completed status on restart and tracks concurrent addresses separately', async () => {
  const elements = new Map();
  function element() {
    return {
      textContent: '',
      disabled: false,
      children: [],
      append(...children) {
        this.children.push(...children);
      },
      replaceChildren(...children) {
        this.children = children;
      },
      addEventListener(_type, handler) {
        this.click = handler;
      },
    };
  }
  for (const selector of ['#status', '#stop', 'main']) elements.set(selector, element());
  const controls = new Map();
  const finishes = new Map();
  let listener;
  const jobs = load('../lib/monero/scanJobs.ts', {
    '../wallet/moneroBalanceCache': { balanceCheckpointKey: (...parts) => JSON.stringify(parts) },
  });
  load(
    '../entrypoints/scan/main.ts',
    {
      'wxt/browser': {
        browser: {
          runtime: {
            id: 'test',
            getURL: () => 'chrome-extension://test/',
            sendMessage: async () => {},
            onMessage: {
              addListener: (handler) => {
                listener = handler;
              },
            },
          },
        },
      },
      '../../lib/monero/moneroDaemon': {
        scanMoneroBalance: (request, control) => {
          controls.set(request.primaryAddress, control);
          return new Promise((resolve) => finishes.set(request.primaryAddress, resolve));
        },
      },
      '../../lib/monero/scanJobs': jobs,
      './style.css': {},
    },
    {
      document: { querySelector: (selector) => elements.get(selector), createElement: element },
      navigator: { locks: { request: async (_name, _options, handler) => handler({}) } },
      setInterval: () => 0,
    },
  );
  const request = {
    config: { network: 'mainnet', daemon: { uri: 'https://node.invalid' } },
    primaryAddress: 'first',
    restoreHeight: 0,
  };
  const start = (address) =>
    listener(
      {
        type: 'monero:hostRequest',
        action: 'start',
        request: { ...request, primaryAddress: address },
      },
      { id: 'test', url: 'chrome-extension://test/popup.html' },
      () => {},
    );
  const status = elements.get('#status');
  start('first');
  assert.equal(status.textContent, '1 active scan');
  finishes.get('first')({ ok: true, balanceAtomic: '0' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(status.textContent, 'All scans finished');
  start('first');
  assert.equal(status.textContent, '1 active scan');
  start('second');
  assert.equal(status.textContent, '2 active scans');
  finishes.get('first')({ ok: true, balanceAtomic: '0' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(status.textContent, '1 active scan');
  const rows = elements.get('main').children[0].children;
  assert.equal(rows[0].children[1].textContent, 'Scan complete');
  assert.equal(rows[1].children[1].textContent, 'Starting scan...');
  rows[1].children[2].click();
  assert.equal(controls.get('second').signal.aborted, true);
  finishes.get('second')({ ok: false, error: 'stopped' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(elements.get('#stop').disabled, true);
});
