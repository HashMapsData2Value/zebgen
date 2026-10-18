import { cp, mkdir, rm } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const output = new URL('site-dist/', root);
await rm(output, { recursive: true, force: true });
await mkdir(new URL('assets/', output), { recursive: true });
for (const file of ['index.html', 'style.css', 'wallet-theme.css', 'main.js']) {
  await cp(new URL(`site/${file}`, root), new URL(file, output));
}
for (const [source, destination] of [
  ['assets/brand/zebgen-mark-violet-128.png', 'zebgen.png'],
  ['assets/brand/zebgen-mark-luminous.svg', 'zebgen-luminous.svg'],
  ['assets/algorand_logo.png', 'algorand.png'],
  ['assets/monero_logo.png', 'monero.png'],
  ['site/assets/wallet-preview.png', 'wallet-preview.png'],
]) {
  await cp(new URL(source, root), new URL(`assets/${destination}`, output));
}
console.log('Zebgen website built in site-dist/');