# ZebGen Wallet

Zebgen wallet is an Algorand wallet created by HMD2V.

## Installing a release build (testers)

Each push to `main` that contains a release-worthy commit (see
[Conventional Commits](https://www.conventionalcommits.org/)) automatically
publishes a new [GitHub Release](https://github.com/HashMapsData2Value/zebgen/releases)
with a Chrome and a Firefox zip attached. To try a build:

1. Download the `zebgen-wallet-<version>-chrome.zip` (or `-firefox.zip`) asset
   from the latest release.
2. Unzip it.
3. **Chrome/Chromium**: open `chrome://extensions`, enable "Developer mode",
   click "Load unpacked", and select the unzipped folder.
4. **Firefox**: open `about:debugging#/runtime/this-firefox`, click
   "Load Temporary Add-on", and select the `manifest.json` inside the
   unzipped folder.

This extension is not published on the Chrome Web Store or Firefox AMO — it's
distributed this way for testers only. It currently only activates on
`localhost`/`127.0.0.1` pages.

## Monero: why zebgen-monero-wasm instead of monero-ts

zebgen does all Monero cryptography (scanning for your funds, building and
signing transactions) inside the extension using
[`zebgen-monero-wasm`](https://github.com/HashMapsData2Value/zebgen-monero-wasm),
a small Rust wrapper around the [monero-oxide](https://github.com/monero-oxide/monero-oxide)
crates `monero-wallet` and `monero-daemon-rpc` (pinned to exactly `0.2.0`),
compiled to WebAssembly. Earlier versions used
[`monero-ts`](https://github.com/woodser/monero-ts). This section explains why we
switched, and what the new approach does and does not protect you from.

### What went wrong with monero-ts

`monero-ts` wraps Monero's own C++ wallet (`wallet2`), compiled to WebAssembly
with Emscripten. That WebAssembly ships as a **prebuilt file** inside the npm
package; `monero-ts`'s own build doesn't produce it. Using `monero-ts@0.11.10`
inside an MV3 extension, we hit three separate problems:

1. **It needs `eval`, which the extension's security policy forbids.** Bundled
   environment-detection code calls `new Function(...)`. MV3 extensions only
   allow WebAssembly (`'wasm-unsafe-eval'`), not JavaScript `eval`. The only
   ways around it were to loosen zebgen's security policy (unacceptable for a
   wallet) or patch `monero-ts`'s files, which we did with `patch-package`.
   Background: [`docs/monero-csp-eval-issue.md`](docs/monero-csp-eval-issue.md).
2. **Its network code breaks when bundled.** A `typeof require` check left
   `monero-ts`'s internal HTTP client undefined after Vite bundling, so every
   call to a Monero node crashed. Also patched.
3. **Scanning for funds crashes inside the prebuilt WebAssembly.** With both
   patches applied, `wallet.sync()` still failed every time with
   `Exception in thread pool` (sometimes `failed to parse address`). We
   reproduced the identical error in plain Node.js with no browser involved,
   so it isn't caused by the extension environment. Retries and smaller scan
   ranges didn't help, and the same error is reported upstream in
   [woodser/monero-ts#249](https://github.com/woodser/monero-ts/issues/249).
   Because it happens inside the prebuilt binary, we couldn't patch or
   debug it, and moving the code to an offscreen document or an Electron app
   wouldn't have changed anything.

The net result: zebgen could create keys and addresses, but could **not**
send Monero. The only workaround was exporting your private keys into a
separate wallet program, which defeats the point of a self-contained wallet.

### What zebgen does now

```
zebgen extension (keys never leave)              any Monero node you choose
┌─────────────────────────────────────┐         ┌──────────────────────────┐
│ private spend + view keys           │ blocks, │ - your own monerod       │
│ zebgen-monero-wasm (monero-oxide):  │◄────────┤ - a public/3rd-party node│
│   scan, pick coins, sign            │ decoys, │ - a hosted node API      │
│                                     │ fees    │                          │
│                                     ├────────►│ broadcasts the signed tx │
└─────────────────────────────────────┘ signed  └──────────────────────────┘
                                          tx only
```

- **Your keys never leave the extension.** zebgen downloads whole blocks and
  scans them locally, so the node never receives your view key (unlike "light
  wallet" servers). Only the finished, signed transaction is sent.
- **Built from source.** zebgen-monero-wasm is compiled from Rust source by its
  build script, which also fails if the generated JavaScript ever uses `eval`.
  There's no prebuilt binary to trust, no patches, and no Web Workers.
- **Smaller.** About 1.5 MB of WebAssembly, replacing `monero-ts` and its 46
  npm dependencies.
- **Nodes:** any node URL can be configured in Network Settings. zebgen asks
  for browser permission the first time it contacts a host other than
  `localhost`/`127.0.0.1`. Nodes running `--restricted-rpc` (the usual mode
  for public nodes) work, and so do username/password logins.
- **Send entire balance:** the Send XMR form can send everything except the
  fee in one transaction, e.g. to empty a recovered swap wallet.

### Limitations and trade-offs

- **monero-oxide is young.** It's a 0.x Rust reimplementation of Monero, not
  the reference `wallet2` code. The monero-oxide project publishes a
  third-party audit in its repository, but it has far less real-world use than
  `wallet2`.
- **Your node affects your privacy, but can't steal funds.** The node sees
  your IP address and the transaction you broadcast. It also supplies the
  decoy outputs mixed into your transaction; a malicious node could choose
  them badly and weaken your privacy. Use a node you trust, ideally your own.
- **The node may be able to tell you're using monero-oxide** from the way it
  requests data, even though the transactions themselves are built to look
  like ones from Monero's own wallet.
- **Scanning costs bandwidth.** zebgen downloads every block from the restore
  height onward. It records the chain height (minus a 20-block safety margin)
  when it generates a wallet and when it computes a swap's combined address,
  and pre-fills that in Send XMR, so only blocks since then are downloaded.
  Imported wallets have no recorded height: enter one at or before the wallet
  first received funds, because 0 on mainnet means downloading the whole chain.
  If the node can't be reached at creation time, no height is recorded.
- **Node logins:** monerod's built-in login (HTTP Digest) only works if the
  browser reuses the same network connection, which Chrome does. Over the
  internet, use HTTPS.
- Only RingCT outputs can be spent. Older, pre-RingCT outputs aren't
  supported; a new wallet won't have any.

### How it was checked

Against a local Monero regtest network:
- 200 random key sets produce identical public keys and addresses in
  zebgen-monero-wasm and zebgen's own TypeScript code, on all three networks.
- A full send (mine, scan, send 1 XMR, check change) was confirmed
  independently by Monero's own wallet (`monero-wallet-rpc`).
- zebgen's own "Send XMR" button sent and relayed a transaction from the
  extension, including through a `--restricted-rpc` port with a login.
