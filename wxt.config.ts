import { defineConfig } from 'wxt';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: ({ manifestVersion }) => ({
    name: 'Zebgen Wallet',
    permissions: ['storage'],
    // Built-in node hosts. Any other node (your own, a 3rd party, a public API) is granted at
    // runtime via optional host permissions when the user tests or uses it.
    host_permissions: [
      'http://localhost/*',
      'http://127.0.0.1/*',
      'https://*.algonode.cloud/*',
    ],
    // MV2 (WXT's Firefox default) has no optional_host_permissions; origins go in optional_permissions.
    ...(manifestVersion === 2
      ? { optional_permissions: ['http://*/*', 'https://*/*'] }
      : { optional_host_permissions: ['http://*/*', 'https://*/*'] }),
    // zebgen-monero-wasm instantiates WebAssembly, which MV3 blocks unless the
    // extension pages/service worker CSP allows 'wasm-unsafe-eval'.
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
  }),
  vite: () => ({
    plugins: [nodePolyfills()],
    optimizeDeps: {
      include: ['@algorandfoundation/xhd-wallet-api'],
    },
  }),
});
