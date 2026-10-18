import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import algosdk from 'algosdk';
import { bytesToHex } from '@noble/hashes/utils.js';

const artifactPath = '../contracts/';
const moduleUrl = new URL('../lib/wallet/swapAgreementArtifact.ts', import.meta.url);
const canonical = JSON.parse(readFileSync(new URL(`${artifactPath}LeakSwap.arc56.json`, moduleUrl), 'utf8'));
const template = readFileSync(new URL(`${artifactPath}FeeSponsorLSig.teal`, moduleUrl), 'utf8');
const compiled = ts.transpileModule(readFileSync(moduleUrl, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
}).outputText;
const api = {};
const modules = {
  algosdk,
  '@noble/hashes/utils.js': { bytesToHex },
  [`${artifactPath}LeakSwap.arc56.json`]: canonical,
  [`${artifactPath}FeeSponsorLSig.teal?raw`]: template,
  '../provider/base64': {
    bytesToBase64: bytes => Buffer.from(bytes).toString('base64'),
    base64ToBytes: text => new Uint8Array(Buffer.from(text, 'base64'))
  }
};
runInNewContext(compiled, {
  exports: api, Uint8Array, TextEncoder,
  require: name => {
    assert.ok(name in modules, `Unexpected import: ${name}`);
    return modules[name];
  }
});

test('wallet supports only canonical fee-bearing programs, not legacy or modified programs', () => {
  const approval = Buffer.from(canonical.byteCode.approval, 'base64');
  const clear = Buffer.from(canonical.byteCode.clear, 'base64');
  const treasury = algosdk.decodeAddress('KMRBWAK47LNYSDWH2FW3Q7BLZFXKHXURZG3SVUONHBHG5MPBNB2PIZKZBA').publicKey;
  const treasuryOffset = approval.indexOf(treasury);
  assert.ok(treasuryOffset >= 0, 'Canonical approval must contain the fixed platform treasury');
  assert.doesNotThrow(() => api.assertAgreementPrograms(approval, clear));
  const otherTreasury = Buffer.from(approval);
  otherTreasury[treasuryOffset] ^= 1;
  for (const unsupported of [new Uint8Array([10, 129, 1, 67]), approval.subarray(0, treasuryOffset), otherTreasury]) {
    assert.throws(() => api.assertAgreementPrograms(unsupported, clear), /supported LeakSwap protocol/);
  }
  assert.throws(() => api.assertAgreementPrograms(approval, new Uint8Array([10])), /supported LeakSwap protocol/);
});

test('wallet compiles the canonical sponsor template with the agreed parties and application', async () => {
  const ali = algosdk.generateAccount();
  const xin = algosdk.generateAccount();
  const program = new Uint8Array([10, 129, 1, 67]);
  let compiledSource;
  const algod = {
    compile: source => ({
      do: async () => {
        compiledSource = new TextDecoder().decode(source);
        return { result: Buffer.from(program).toString('base64') };
      }
    })
  };
  const address = await api.agreementSponsorAddress(algod, 123n, {
    offer: { payload: { aliAlgoAddress: ali.addr.toString() } },
    acceptance: { payload: { xinAlgoAddress: xin.addr.toString() } }
  });
  assert.equal(address, new algosdk.LogicSigAccount(program).address().toString());
  assert.equal(compiledSource, template.replace(/\bTMPL_APP_ID\b/g, '123')
    .replace(/\bTMPL_ALI_ADDR\b/g, `0x${bytesToHex(ali.addr.publicKey)}`)
    .replace(/\bTMPL_XIN_ADDR\b/g, `0x${bytesToHex(xin.addr.publicKey)}`));
  assert.doesNotMatch(compiledSource, /TMPL_/);
});