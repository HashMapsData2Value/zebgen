import monerojs from 'monero-ts';
import { privateKeyToMoneroMnemonic, moneroMnemonicToPrivateKey } from '../lib/wallet/moneroMnemonic.ts';

const testKeys = [
  '0000000000000000000000000000000000000000000000000000000000000000',
  'e6c5a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d00',
];

for (const spendKey of testKeys) {
  const wallet = await monerojs.createWalletKeys({
    networkType: monerojs.MoneroNetworkType.MAINNET,
    privateSpendKey: spendKey,
    language: 'English',
  });
  const referenceSeed = await wallet.getSeed();
  const referenceSpend = await wallet.getPrivateSpendKey();

  // Validate our DECODE: reference 25-word seed -> spend key bytes.
  const decodedSpend = moneroMnemonicToPrivateKey(referenceSeed);
  // Validate our ENCODE: spend key bytes -> 25-word seed.
  const encodedSeed = privateKeyToMoneroMnemonic(decodedSpend);

  console.log('monero-ts spend  :', referenceSpend);
  console.log('our decode spend :', decodedSpend);
  console.log('decode matches   :', decodedSpend === referenceSpend);
  console.log('reference seed   :', referenceSeed);
  console.log('our re-encode    :', encodedSeed);
  console.log('encode matches   :', encodedSeed === referenceSeed);
  console.log('---');
}
