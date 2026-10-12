import { defineConfig } from 'wxt';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Zebgen Wallet',
    permissions: ['storage'],
    // Required so extension fetches (algod/indexer and the Monero daemon RPC)
    // bypass CORS. Add any custom remote daemon/indexer hosts you configure.
    host_permissions: [
      'http://localhost/*',
      'http://127.0.0.1/*',
      'https://*.algonode.cloud/*',
    ],
    // monero-ts instantiates WebAssembly, which MV3 blocks unless the extension
    // pages/service worker CSP allows 'wasm-unsafe-eval'.
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
  },
  vite: () => ({
    plugins: [nodePolyfills()],
    optimizeDeps: {
      include: ['@algorandfoundation/xhd-wallet-api'],
    },
  }),
});
