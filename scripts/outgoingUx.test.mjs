import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as react from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { chromium } from '../../leakswap-all/leakswap-private/e2e-ui/node_modules/playwright/index.mjs';
import * as icons from 'lucide-react';

const hash = 'ab'.repeat(32);
const address = `4${'8'.repeat(94)}`;
const config = { network: 'regtest', daemon: { uri: 'http://localhost:18081' } };
const output = '/tmp/zebgen-outgoing-ux';

function component(name, states = [], dependencies = {}) {
  let index = 0;
  const api = {};
  const compiled = ts.transpileModule(readFileSync(new URL(`../entrypoints/popup/${name}.tsx`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  runInNewContext(compiled, { exports: api, console, require: dependency => {
    if (dependency in dependencies) return dependencies[dependency];
    if (dependency === 'react/jsx-runtime') return jsx;
    if (dependency === 'react') return { ...react, useState: initial => [index < states.length ? states[index++] : (index++, initial), () => {}], useEffect() {}, useRef: value => ({ current: value }) };
    if (dependency === 'lucide-react') return icons;
    if (dependency.endsWith('/formatAtomic')) return { formatAtomic: value => (Number(value) / 1e12).toString() };
    if (dependency.endsWith('/moneroActivity')) return { activityScope: () => ({}) };
    if (dependency.endsWith('/moneroBalanceCache')) return { balanceCheckpointKey: () => '' };
    if (dependency.endsWith('/addressValidation')) return { addressValidationError: () => null };
    if (dependency.endsWith('/networks')) return { networkLabel: value => value };
    if (dependency.startsWith('./')) return { default: () => null };
    return {};
  } });
  return api.default;
}

const Confirmation = component('MoneroConfirmation');
const styles = ['style.css', 'App.css'].map(name => readFileSync(new URL(`../entrypoints/popup/${name}`, import.meta.url), 'utf8')).join('\n');

test('outgoing screens prioritize status and amount, preserve disclosures and fit narrow viewports', async () => {
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const Form = component('TransactionBuilder');
    await page.setContent(`<style>${styles}</style>${renderToStaticMarkup(react.createElement(Form, { chain: 'monero', sender: address, config, walletId: 1, lockSecret: 'synthetic' }))}`);
    assert.equal(await page.getByLabel('Wallet restore height', { exact: true }).isVisible(), false);
    assert.equal(await page.getByText(/substantial data/).isVisible(), true);
    await page.getByText('Scan settings', { exact: true }).click();
    assert.equal(await page.getByLabel('Wallet restore height', { exact: true }).isVisible(), true);
    const scenarios = ['pool', 'confirmed', 'unknown'];
    for (const state of scenarios) {
      const status = { state, confirmations: state === 'confirmed' ? 12 : 0, block: '123' };
      const Activity = component('MoneroActivity', [[{ hash, amountAtomic: '20000000000', feeAtomic: '1000000000', createdAt: 123, state: 'submitted' }], { [hash]: status }, { [hash]: 'Status unavailable; last observation may be stale.' }, null, 0], {
        './MoneroConfirmation': { default: Confirmation },
      });
      const Builder = component('TransactionBuilder', [address, '0.02', '', '100', false, false, false, null,
        `Relayed ${hash} · amount 0.02 XMR · fee 0.001 XMR`, hash, null, null, false, null, '', status, null, 0, '20000000000'], {
        './MoneroConfirmation': { default: Confirmation },
      });
      for (const [name, Component, props] of [
        ['activity', Activity, { address, config, lockSecret: 'synthetic' }],
        ['receipt', Builder, { chain: 'monero', sender: address, config, walletId: 1, lockSecret: 'synthetic' }],
      ]) {
        const html = renderToStaticMarkup(react.createElement(Component, props));
        await page.setContent(`<style>${styles} body{margin:0;min-width:0}.app{box-sizing:border-box;width:100%;max-width:600px;margin:auto;padding:16px}</style><main class="app">${html}</main>`);
        await page.getByText('Transaction details', { exact: true }).waitFor();
        assert.equal(await page.getByText(hash, { exact: false }).first().isVisible(), false);
        assert.equal(await page.getByText('0.02 XMR', { exact: true }).isVisible(), true);
        if (state !== 'confirmed') assert.equal(await page.getByText(/Do not send it again/).isVisible(), true);
        if (name === 'activity') assert.equal(await page.getByText(/Status unavailable/).isVisible(), true);
        for (const width of [360, 1100]) {
          await page.setViewportSize({ width, height: 800 });
          await page.screenshot({ path: `${output}/${name}-${state}-${width}.png`, fullPage: true });
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} ${state} overflows at ${width}`);
        }
        await page.getByText('Transaction details', { exact: true }).click();
        assert.equal(await page.getByText(hash, { exact: false }).first().isVisible(), true);
        await page.getByText('About confirmations', { exact: true }).click();
        assert.equal(await page.getByText(/remains in Monero's Outgoing Activity/).isVisible(), true);
      }
    }
  } finally { await browser.close(); }
});