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
`localhost`/`127.0.0.1` pages, and real Monero transaction sending from the
extension's background worker is blocked by MV3's content security policy
(see [`docs/monero-csp-eval-issue.md`](docs/monero-csp-eval-issue.md)).
