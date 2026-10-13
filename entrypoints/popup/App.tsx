import './App.css';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import * as bip39 from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { browser } from 'wxt/browser';

import algorandLogo from '../../assets/algorand_logo.png';
import moneroLogo from '../../assets/monero_logo.png';

import {
  createWalletLock,
  deriveActiveSeedAlgoAddressAtIndex,
  getAlgoDerivationPath,
  getSignedInState,
  getWalletLockState,
  importAlgoMnemonic,
  unlockWallet,
} from '../../lib/wallet/algoWallet';
import {
  combineMoneroKeyMaterialFromPrivateSpendKeys,
  computeCombinedAddressFromPublicKeys,
  computeCombinedAddressWithPrivateAndPublic,
  generateMoneroKeyMaterial,
  getMoneroKeyMaterialFromPrivateSpendKey,
  type MoneroKeyMaterial,
} from '../../lib/wallet/moneroWallet';
import {
  getMoneroWalletState,
  saveMoneroWallet,
  unlockMoneroWallet,
  type MoneroWalletSummary,
} from '../../lib/wallet/moneroVault';
import {
  moneroMnemonicToPrivateKey,
  privateKeyToMoneroMnemonic,
} from '../../lib/wallet/moneroMnemonic';
import {
  cloneAlgorandPreset,
  cloneMoneroPreset,
  type AlgorandNetworkId,
  type MoneroNetworkId,
  type NetworkSettings,
} from '../../lib/network/networks';
import { getNetworkSettings, saveNetworkSettings } from '../../lib/network/networkStore';
import { currentRestoreHeight, swapAddressHeight } from '../../lib/monero/restoreHeight';
import AlgorandAddressCard from './AlgorandAddressCard';
import MoneroAddressCard from './MoneroAddressCard';
import MoneroKeyList from './MoneroKeyList';
import NetworkSettingsPanel from './NetworkSettings';
import RevealSeedPhrase from './RevealSeedPhrase';
import TransactionBuilder from './TransactionBuilder';

interface AppProps {
  variant?: 'popup' | 'full';
}

function App({ variant = 'popup' }: AppProps) {
  const [selectedWalletType, setSelectedWalletType] = useState<'algorand' | 'monero' | null>(
    null
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isLockConfigured, setIsLockConfigured] = useState(false);
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [algoAddress, setAlgoAddress] = useState<string | null>(null);
  const [addressIndex, setAddressIndex] = useState(0);
  const [mnemonicMode, setMnemonicMode] = useState<'generate' | 'existing' | null>(null);
  const [generatedMnemonic, setGeneratedMnemonic] = useState('');
  const [mnemonic, setMnemonic] = useState('');
  const [setupSecret, setSetupSecret] = useState('');
  const [setupSecretConfirm, setSetupSecretConfirm] = useState('');
  const [unlockSecret, setUnlockSecret] = useState('');
  const [sessionLockSecret, setSessionLockSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSettingLock, setIsSettingLock] = useState(false);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [isDerivingAddress, setIsDerivingAddress] = useState(false);
  const [algorandView, setAlgorandView] = useState<'wallet' | 'transaction'>('wallet');
  const [moneroWallets, setMoneroWallets] = useState<MoneroWalletSummary[]>([]);
  const [activeMoneroWalletId, setActiveMoneroWalletId] = useState<number | null>(null);
  const [moneroMaterial, setMoneroMaterial] = useState<MoneroKeyMaterial | null>(null);
  const [moneroSetupMode, setMoneroSetupMode] = useState<'generate' | 'import' | null>(null);
  const [moneroView, setMoneroView] = useState<'wallet' | 'add' | 'combine' | 'recover' | 'settings' | 'transaction'>('wallet');
  const [importedPrivateSpendKey, setImportedPrivateSpendKey] = useState('');
  const [counterpartyPrivateSpendKey, setCounterpartyPrivateSpendKey] = useState('');
  const [recoveredMaterial, setRecoveredMaterial] = useState<MoneroKeyMaterial | null>(null);
  const [counterpartyPrivateViewKey, setCounterpartyPrivateViewKey] = useState('');
  const [counterpartyPublicSpendKey, setCounterpartyPublicSpendKey] = useState('');
  const [publicSpendKeyA, setPublicSpendKeyA] = useState('');
  const [publicViewKeyA, setPublicViewKeyA] = useState('');
  const [publicSpendKeyB, setPublicSpendKeyB] = useState('');
  const [publicViewKeyB, setPublicViewKeyB] = useState('');
  const [combinedAddressFromPriv, setCombinedAddressFromPriv] = useState('');
  const [combinedAddressFromPublic, setCombinedAddressFromPublic] = useState('');
  const [networkSettings, setNetworkSettings] = useState<NetworkSettings | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadState() {
      try {
        const lockState = await getWalletLockState();
        const [state, moneroState] = await Promise.all([
          getSignedInState(),
          getMoneroWalletState(),
        ]);
        if (!isMounted) {
          return;
        }
        setIsLockConfigured(lockState.isConfigured);
        setIsSignedIn(state.isSignedIn);
        setMoneroWallets(moneroState.wallets);
        setActiveMoneroWalletId(moneroState.activeWalletId);
        setAlgoAddress(state.algoAddress);
        setAddressIndex(0);
        setIsUnlocked(false);
        setSelectedWalletType(null);
        setSessionLockSecret(null);
      } catch (err) {
        if (!isMounted) {
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to load wallet state.');
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadState();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    getNetworkSettings().then((loaded) => {
      if (isMounted) {
        setNetworkSettings(loaded);
      }
    });
    return () => {
      isMounted = false;
    };
  }, []);

  async function updateNetworkSettings(next: NetworkSettings) {
    setNetworkSettings(next);
    await saveNetworkSettings(next);
  }

  async function switchAlgorandNetwork(network: AlgorandNetworkId) {
    if (!networkSettings) {
      return;
    }
    await updateNetworkSettings({
      ...networkSettings,
      algorand: cloneAlgorandPreset(network),
    });
  }

  async function switchMoneroNetwork(network: MoneroNetworkId) {
    if (!networkSettings) {
      return;
    }
    const next = {
      ...networkSettings,
      monero: cloneMoneroPreset(network),
    };
    await updateNetworkSettings(next);
    if (moneroMaterial) {
      setMoneroMaterial(
        getMoneroKeyMaterialFromPrivateSpendKey(
          moneroMaterial.privateSpendKey,
          next.monero.networkType
        )
      );
    }
  }

  const addressPreview = useMemo(() => {
    if (!algoAddress) {
      return '';
    }
    return `${algoAddress.slice(0, 10)}...${algoAddress.slice(-8)}`;
  }, [algoAddress]);

  const normalizedMnemonic = useMemo(() => {
    const sourceMnemonic = mnemonicMode === 'generate' ? generatedMnemonic : mnemonic;
    return sourceMnemonic.trim().toLowerCase().split(/\s+/).join(' ');
  }, [generatedMnemonic, mnemonic, mnemonicMode]);

  const mnemonicValidationState = useMemo(() => {
    if (mnemonicMode === 'existing' && !normalizedMnemonic) {
      return 'invalid' as const;
    }
    if (!normalizedMnemonic) {
      return 'empty' as const;
    }
    return bip39.validateMnemonic(normalizedMnemonic, wordlist)
      ? ('valid' as const)
      : ('invalid' as const);
  }, [normalizedMnemonic]);

  const generatedMoneroMnemonic = useMemo(
    () => moneroMaterial ? privateKeyToMoneroMnemonic(moneroMaterial.privateSpendKey) : '',
    [moneroMaterial]
  );

  const activeMoneroWalletIndex = moneroWallets.findIndex(
    (wallet) => wallet.id === activeMoneroWalletId
  );

  async function onImportMnemonic(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      if (!sessionLockSecret) {
        throw new Error('Unlock with your password or PIN first.');
      }
      if (!normalizedMnemonic) {
        throw new Error('Choose or enter a mnemonic first.');
      }
      const imported = await importAlgoMnemonic(normalizedMnemonic, sessionLockSecret);
      setIsSignedIn(true);
      setIsUnlocked(true);
      setAlgoAddress(imported.algoAddress);
      setAddressIndex(0);
      setMnemonic('');
      setGeneratedMnemonic('');
      setMnemonicMode(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to import mnemonic.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function onCreateLock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSettingLock(true);

    try {
      if (setupSecret !== setupSecretConfirm) {
        throw new Error('Password or PIN confirmation does not match.');
      }

      await createWalletLock(setupSecret);
      setIsLockConfigured(true);
      setIsUnlocked(true);
      setSessionLockSecret(setupSecret);
      setSetupSecret('');
      setSetupSecretConfirm('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create wallet lock.');
    } finally {
      setIsSettingLock(false);
    }
  }

  async function onUnlockWallet(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsUnlocking(true);

    try {
      const unlocked = await unlockWallet(unlockSecret);
      setAlgoAddress(unlocked.algoAddress);
      setAddressIndex(0);
      setIsUnlocked(true);
      setSelectedWalletType(null);
      setSessionLockSecret(unlockSecret);
      setUnlockSecret('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to unlock wallet.');
    } finally {
      setIsUnlocking(false);
    }
  }

  function onLockWallet() {
    setIsUnlocked(false);
    setUnlockSecret('');
    setSessionLockSecret(null);
    setAddressIndex(0);
    setSelectedWalletType(null);
    setMoneroMaterial(null);
    setRecoveredMaterial(null);
  }

  async function onSelectMonero() {
    setError(null);
    try {
      if (!sessionLockSecret || !networkSettings) {
        throw new Error('Wallet or network settings are not ready.');
      }
      const material = await unlockMoneroWallet(
        sessionLockSecret,
        networkSettings.monero.networkType,
        activeMoneroWalletId ?? undefined
      );
      setMoneroMaterial(material);
      setMoneroView(material ? 'wallet' : 'add');
      setMoneroSetupMode(null);
      setSelectedWalletType('monero');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to open Monero wallet.');
    }
  }

  function onSelectMoneroSetupMode(mode: 'generate' | 'import') {
    setError(null);
    setMoneroSetupMode(mode);
    setImportedPrivateSpendKey('');
    setMoneroMaterial(
      mode === 'generate'
        ? generateMoneroKeyMaterial(networkSettings?.monero.networkType)
        : null
    );
  }

  async function onSaveMoneroWallet(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      if (!sessionLockSecret || !networkSettings) {
        throw new Error('Unlock with your password or PIN first.');
      }
      const importedValue = importedPrivateSpendKey.trim();
      const material = moneroSetupMode === 'import'
        ? getMoneroKeyMaterialFromPrivateSpendKey(
            importedValue.includes(' ')
              ? moneroMnemonicToPrivateKey(importedValue)
              : importedValue,
            networkSettings.monero.networkType
          )
        : moneroMaterial;
      if (!material) {
        throw new Error('Generate or import Monero key material first.');
      }
      // A freshly generated wallet can't have funds from before now; an imported one might.
      const restoreHeight = moneroSetupMode === 'import'
        ? undefined
        : await currentRestoreHeight(networkSettings.monero);
      const activeWalletId = await saveMoneroWallet(material, sessionLockSecret, restoreHeight);
      const moneroState = await getMoneroWalletState();
      setMoneroMaterial(material);
      setMoneroWallets(moneroState.wallets);
      setActiveMoneroWalletId(activeWalletId);
      setMoneroView('wallet');
      setMoneroSetupMode(null);
      setImportedPrivateSpendKey('');
      setCombinedAddressFromPriv('');
      setCombinedAddressFromPublic('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to encrypt and save Monero wallet.');
    } finally {
      setIsSubmitting(false);
    }
  }

  function onComputeCombinedFromPrivateAndPublic(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!moneroMaterial) {
      setError('Generate Monero key material first.');
      return;
    }

    try {
      const combined = computeCombinedAddressWithPrivateAndPublic(
        moneroMaterial.privateSpendKey,
        moneroMaterial.privateViewKey,
        counterpartyPrivateViewKey.trim(),
        counterpartyPublicSpendKey.trim()
      );
      setCombinedAddressFromPriv(combined.combinedAddress);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to compute combined Monero address.');
    }
  }

  function onComputeCombinedFromPublic(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    try {
      const combined = computeCombinedAddressFromPublicKeys(
        publicSpendKeyA.trim(),
        publicViewKeyA.trim(),
        publicSpendKeyB.trim(),
        publicViewKeyB.trim()
      );
      setCombinedAddressFromPublic(combined.combinedAddress);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to compute combined Monero address from public keys.'
      );
    }
  }

  function onRecoverCombinedWallet(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!moneroMaterial || !networkSettings) {
      setError('Open your Monero wallet first.');
      return;
    }
    try {
      setRecoveredMaterial(
        combineMoneroKeyMaterialFromPrivateSpendKeys(
          moneroMaterial.privateSpendKey,
          counterpartyPrivateSpendKey.trim(),
          networkSettings.monero.networkType
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to recover the combined wallet.');
    }
  }

  async function onSaveRecoveredWallet() {
    if (!recoveredMaterial || !sessionLockSecret) {
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      const restoreHeight = await swapAddressHeight(recoveredMaterial.address);
      const activeWalletId = await saveMoneroWallet(recoveredMaterial, sessionLockSecret, restoreHeight);
      const moneroState = await getMoneroWalletState();
      setMoneroMaterial(recoveredMaterial);
      setMoneroWallets(moneroState.wallets);
      setActiveMoneroWalletId(activeWalletId);
      setRecoveredMaterial(null);
      setCounterpartyPrivateSpendKey('');
      setMoneroView('wallet');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to encrypt and save recovered wallet.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function onSelectMoneroWallet(walletId: number) {
    if (!sessionLockSecret || !networkSettings) {
      return;
    }
    setError(null);
    try {
      const material = await unlockMoneroWallet(
        sessionLockSecret,
        networkSettings.monero.networkType,
        walletId
      );
      setMoneroMaterial(material);
      setActiveMoneroWalletId(walletId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to open Monero address.');
    }
  }

  async function onBack() {
    setError(null);
    if (selectedWalletType === 'algorand' && algorandView !== 'wallet') {
      setAlgorandView('wallet');
      return;
    }
    if (selectedWalletType === 'monero' && moneroView === 'add' && moneroSetupMode !== null) {
      setMoneroSetupMode(null);
      setMoneroMaterial(null);
      return;
    }
    if (selectedWalletType === 'monero' && moneroView === 'add' && moneroWallets.length > 0) {
      setMoneroView('wallet');
      await onSelectMoneroWallet(activeMoneroWalletId ?? moneroWallets[0].id);
      return;
    }
    if (selectedWalletType === 'monero' && moneroView === 'add') {
      setSelectedWalletType(null);
      return;
    }
    if (selectedWalletType === 'monero' && moneroView !== 'wallet') {
      setMoneroView('wallet');
      setRecoveredMaterial(null);
      return;
    }
    if (selectedWalletType === 'algorand' && mnemonicMode !== null) {
      setMnemonicMode(null);
      return;
    }
    setSelectedWalletType(null);
  }

  async function onSelectAddressIndex(nextIndex: number) {
    if (!sessionLockSecret) {
      setError('Unlock with your password or PIN first.');
      return;
    }

    if (nextIndex < 0) {
      return;
    }

    setError(null);
    setIsDerivingAddress(true);
    try {
      const derived = await deriveActiveSeedAlgoAddressAtIndex(sessionLockSecret, nextIndex);
      setAlgoAddress(derived.algoAddress);
      setAddressIndex(derived.addressIndex);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to derive address at index.');
    } finally {
      setIsDerivingAddress(false);
    }
  }

  function onSelectMnemonicMode(mode: 'generate' | 'existing') {
    setError(null);
    setMnemonicMode(mode);
    if (mode === 'generate') {
      setMnemonic('');
      setGeneratedMnemonic((current) => current || bip39.generateMnemonic(wordlist, 256));
    } else {
      setGeneratedMnemonic('');
    }
  }

  function onGenerateNewMnemonic() {
    setError(null);
    setGeneratedMnemonic(bip39.generateMnemonic(wordlist, 256));
  }

  return (
    <main className={variant === 'full' ? 'popup-root full-root' : 'popup-root'}>
      <div className="app-header">
        <div className="app-header-leading">
          {isUnlocked && selectedWalletType !== null ? (
            <button type="button" className="icon-btn" onClick={onBack} title="Back" aria-label="Back">
              ←
            </button>
          ) : null}
          <h1>Zebgen Wallet</h1>
        </div>
        {variant === 'popup' ? (
          <button
            type="button"
            className="icon-btn"
            title="Open in full window"
            onClick={() => {
              browser.tabs.create({ url: browser.runtime.getURL('/dashboard.html') });
              window.close();
            }}
          >
            ⛶
          </button>
        ) : null}
      </div>

      {isLoading ? <p>Loading wallet state...</p> : null}

      {!isLoading && !isLockConfigured ? (
        <section className="card">
          <h2>Create Wallet Password or PIN</h2>
          <p className="hint">This one credential unlocks access to all mnemonic operations.</p>

          <form className="import-form" onSubmit={onCreateLock}>
            <label htmlFor="setup-secret">Password or PIN</label>
            <input
              id="setup-secret"
              type="password"
              value={setupSecret}
              onChange={(event) => setSetupSecret(event.target.value)}
              placeholder="Create wallet password or PIN"
              required
            />

            <label htmlFor="setup-secret-confirm">Confirm</label>
            <input
              id="setup-secret-confirm"
              type="password"
              value={setupSecretConfirm}
              onChange={(event) => setSetupSecretConfirm(event.target.value)}
              placeholder="Confirm password or PIN"
              required
            />

            <button type="submit" disabled={isSettingLock}>
              {isSettingLock ? 'Saving...' : 'Set Wallet Lock'}
            </button>
          </form>
        </section>
      ) : null}

      {!isLoading && isLockConfigured && !isUnlocked ? (
        <section className="card">
          <h2>Unlock Wallet</h2>
          <p className="hint">Enter your password or PIN to access mnemonic and wallet data.</p>

          <form className="import-form" onSubmit={onUnlockWallet}>
            <label htmlFor="unlock-secret">Password or PIN</label>
            <input
              id="unlock-secret"
              type="password"
              value={unlockSecret}
              onChange={(event) => setUnlockSecret(event.target.value)}
              placeholder="Enter your password or PIN"
              required
            />

            <button type="submit" disabled={isUnlocking}>
              {isUnlocking ? 'Unlocking...' : 'Unlock'}
            </button>
          </form>
        </section>
      ) : null}

      {!isLoading && isLockConfigured && isUnlocked && selectedWalletType === null ? (
        <section className="card">
          <h2>Select Wallet Type</h2>
          <p className="hint">Choose the ecosystem wallet you want to open.</p>

          <div className="wallet-type-grid" role="group" aria-label="Wallet type">
            <button
              type="button"
              className="choice-button wallet-type-button"
              onClick={() => setSelectedWalletType('algorand')}
            >
              <img className="wallet-type-logo" src={algorandLogo} alt="" />
              Algorand
            </button>
            <button
              type="button"
              className="choice-button wallet-type-button"
              onClick={onSelectMonero}
            >
              <img className="wallet-type-logo" src={moneroLogo} alt="" />
              Monero
            </button>
          </div>
        </section>
      ) : null}

      {!isLoading &&
        isLockConfigured &&
        isUnlocked &&
        selectedWalletType === 'algorand' &&
        isSignedIn &&
        algorandView === 'wallet' ? (
        <section className="card">
          <h2 className="chain-title">
            <img className="chain-logo" src={algorandLogo} alt="" />
            Algorand Address
          </h2>
          {networkSettings ? (
            <>
              <AlgorandAddressCard
                address={algoAddress}
                addressPreview={addressPreview}
                addressIndex={addressIndex}
                derivationPath={getAlgoDerivationPath(addressIndex)}
                settings={networkSettings}
                onChangeNetwork={switchAlgorandNetwork}
                onChangeSettings={updateNetworkSettings}
                onPrev={() => onSelectAddressIndex(addressIndex - 1)}
                onNext={() => onSelectAddressIndex(addressIndex + 1)}
                isDeriving={isDerivingAddress}
              />
              <p className="hint">Wallet initialized and encrypted seed is stored locally.</p>
            </>
          ) : (
            <p className="hint">Loading network...</p>
          )}
          <button className="secondary" type="button" onClick={() => setAlgorandView('transaction')}>
            Send ALGO
          </button>
          <RevealSeedPhrase />
          <button className="secondary" type="button" onClick={onLockWallet}>
            Lock
          </button>
        </section>
      ) : null}

      {!isLoading &&
        isUnlocked &&
        selectedWalletType === 'algorand' &&
        isSignedIn &&
        algorandView === 'transaction' ? (
        <section className="card">
          <h2 className="chain-title">
            <img className="chain-logo" src={algorandLogo} alt="" />
            Send ALGO
          </h2>
          {networkSettings && sessionLockSecret && algoAddress ? (
            <TransactionBuilder
              chain="algorand"
              sender={algoAddress}
              addressIndex={addressIndex}
              lockSecret={sessionLockSecret}
              endpoint={networkSettings.algorand.algod}
              network={networkSettings.algorand.network}
            />
          ) : (
            <p className="hint">Loading transaction builder...</p>
          )}
        </section>
      ) : null}

      {!isLoading &&
        isLockConfigured &&
        isUnlocked &&
        selectedWalletType === 'algorand' &&
        !isSignedIn ? (
        <section className="card">
          <h2 className="chain-title">
            <img className="chain-logo" src={algorandLogo} alt="" />
            Add Algorand address?
          </h2>
          <p className="hint">Import a BIP39 mnemonic encrypted by your wallet password or PIN.</p>

          <form className="import-form" onSubmit={onImportMnemonic}>
            {mnemonicMode === null ? (
              <div className="seed-choice-group" role="group" aria-label="Mnemonic source">
                <button
                  type="button"
                  className="choice-button"
                  onClick={() => onSelectMnemonicMode('generate')}
                >
                  Generate new mnemonic
                </button>
                <button
                  type="button"
                  className="choice-button"
                  onClick={() => onSelectMnemonicMode('existing')}
                >
                  Input existing seedphrase
                </button>
              </div>
            ) : null}

            {mnemonicMode === 'existing' ? (
              <>
                <label htmlFor="mnemonic">Mnemonic</label>
                <textarea
                  id="mnemonic"
                  className={`mnemonic-input mnemonic-${mnemonicValidationState}`}
                  value={mnemonic}
                  onChange={(event) => setMnemonic(event.target.value)}
                  placeholder="Enter your 24 word mnemonic"
                  rows={4}
                  required
                />
              </>
            ) : null}

            {mnemonicMode === 'generate' ? (
              <>
                <label htmlFor="generated-mnemonic">Generated Mnemonic</label>
                <textarea
                  id="generated-mnemonic"
                  className="mnemonic-input mnemonic-valid"
                  value={generatedMnemonic}
                  rows={4}
                  readOnly
                />
                <button type="button" className="secondary" onClick={onGenerateNewMnemonic}>
                  Regenerate 24 words
                </button>
              </>
            ) : null}

            {mnemonicMode !== null ? (
              <button
                type="submit"
                disabled={isSubmitting || mnemonicValidationState !== 'valid'}
              >
                {isSubmitting ? 'Importing...' : 'Import and Encrypt'}
              </button>
            ) : null}
          </form>
        </section>
      ) : null}

      {!isLoading &&
      isLockConfigured &&
      isUnlocked &&
      selectedWalletType === 'monero' &&
      moneroView === 'add' ? (
        <section className="card">
          <h2 className="chain-title">
            <img className="chain-logo" src={moneroLogo} alt="" />
            Add Monero address?
          </h2>
          <p className="hint">Generate a new 25-word Monero mnemonic or import an existing mnemonic or private spend key.</p>
          {moneroSetupMode === null ? (
            <div className="seed-choice-group" role="group" aria-label="Monero key source">
              <button type="button" className="choice-button" onClick={() => onSelectMoneroSetupMode('generate')}>
                Generate
              </button>
              <button type="button" className="choice-button" onClick={() => onSelectMoneroSetupMode('import')}>
                Import
              </button>
            </div>
          ) : (
            <form className="import-form" onSubmit={onSaveMoneroWallet}>
              {moneroSetupMode === 'import' ? (
                <>
                  <label htmlFor="monero-private-spend-key">Mnemonic or private spend key</label>
                  <textarea
                    id="monero-private-spend-key"
                    className="mnemonic-input"
                    value={importedPrivateSpendKey}
                    onChange={(event) => setImportedPrivateSpendKey(event.target.value)}
                    placeholder="Enter a 25-word Monero mnemonic or 64 hexadecimal characters"
                    autoComplete="off"
                    rows={5}
                    required
                  />
                </>
              ) : null}
              {moneroSetupMode === 'generate' && moneroMaterial ? (
                <>
                  <label htmlFor="generated-monero-mnemonic">Monero Recovery Mnemonic</label>
                  <textarea
                    id="generated-monero-mnemonic"
                    className="mnemonic-input mnemonic-valid"
                    value={generatedMoneroMnemonic}
                    rows={5}
                    readOnly
                  />
                  <p className="seed-warning">Store these 25 words offline. They recover this Monero address and its private spend key.</p>
                </>
              ) : null}
              <button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Encrypting...' : 'Encrypt and Save'}
              </button>
            </form>
          )}
        </section>
      ) : null}

      {!isLoading && isUnlocked && selectedWalletType === 'monero' && moneroWallets.length > 0 && moneroView === 'wallet' ? (
        <section className="card">
          <h2 className="chain-title">
            <img className="chain-logo" src={moneroLogo} alt="" />
            Monero Address
          </h2>
          {networkSettings && moneroMaterial ? (
            <MoneroAddressCard
              material={moneroMaterial}
              settings={networkSettings}
              onChangeNetwork={switchMoneroNetwork}
              onOpenSettings={() => setMoneroView('settings')}
              addressPosition={activeMoneroWalletIndex}
              addressCount={moneroWallets.length}
              onPrev={() => onSelectMoneroWallet(moneroWallets[activeMoneroWalletIndex - 1].id)}
              onNext={() => onSelectMoneroWallet(moneroWallets[activeMoneroWalletIndex + 1].id)}
            />
          ) : (
            <p className="hint">Loading Monero wallet...</p>
          )}
          <div className="wallet-action-grid">
            <button type="button" className="secondary" onClick={() => setMoneroView('transaction')}>
              Send XMR
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setMoneroSetupMode(null);
                setMoneroView('add');
              }}
            >
              Add Address
            </button>
            <button type="button" className="secondary" onClick={() => setMoneroView('combine')}>
              Combine Addresses
            </button>
            <button type="button" className="secondary" onClick={() => setMoneroView('recover')}>
              Recover Combined Wallet
            </button>
          </div>
          <button className="secondary" type="button" onClick={onLockWallet}>Lock</button>
        </section>
      ) : null}

      {!isLoading && isUnlocked && selectedWalletType === 'monero' && moneroView === 'transaction' ? (
        <section className="card">
          <h2 className="chain-title">
            <img className="chain-logo" src={moneroLogo} alt="" />
            Send XMR
          </h2>
          {networkSettings && moneroMaterial ? (
            <TransactionBuilder
              chain="monero"
              material={moneroMaterial}
              config={networkSettings.monero}
              defaultRestoreHeight={moneroWallets[activeMoneroWalletIndex]?.restoreHeight}
            />
          ) : (
            <p className="hint">Loading transaction builder...</p>
          )}
        </section>
      ) : null}

      {!isLoading && isUnlocked && selectedWalletType === 'monero' && moneroView === 'settings' ? (
        <section className="card">
          <h2 className="chain-title">
            <img className="chain-logo" src={moneroLogo} alt="" />
            Monero Network Settings
          </h2>
          {networkSettings ? (
            <NetworkSettingsPanel
              chain="monero"
              settings={networkSettings}
              onChange={updateNetworkSettings}
            />
          ) : (
            <p className="hint">Loading network settings...</p>
          )}
        </section>
      ) : null}

      {!isLoading && isUnlocked && selectedWalletType === 'monero' && moneroView === 'combine' ? (
        <section className="card">
          <h2 className="chain-title">
            <img className="chain-logo" src={moneroLogo} alt="" />
            Combine Addresses
          </h2>
          <form className="import-form flow-panel" onSubmit={onComputeCombinedFromPrivateAndPublic}>
            <h3>Use your saved key</h3>
            <label htmlFor="counterparty-private-view">Counterparty private view key</label>
            <input id="counterparty-private-view" value={counterpartyPrivateViewKey} onChange={(event) => setCounterpartyPrivateViewKey(event.target.value)} required />
            <label htmlFor="counterparty-public-spend">Counterparty public spend key</label>
            <input id="counterparty-public-spend" value={counterpartyPublicSpendKey} onChange={(event) => setCounterpartyPublicSpendKey(event.target.value)} required />
            <button type="submit" disabled={!moneroMaterial}>Combine</button>
            {combinedAddressFromPriv ? <p className="result-value">{combinedAddressFromPriv}</p> : null}
          </form>
          <form className="import-form flow-panel" onSubmit={onComputeCombinedFromPublic}>
            <h3>Use two public key pairs</h3>
            <label htmlFor="pub-spend-a">Public spend key A</label>
            <input id="pub-spend-a" value={publicSpendKeyA} onChange={(event) => setPublicSpendKeyA(event.target.value)} required />
            <label htmlFor="pub-view-a">Public view key A</label>
            <input id="pub-view-a" value={publicViewKeyA} onChange={(event) => setPublicViewKeyA(event.target.value)} required />
            <label htmlFor="pub-spend-b">Public spend key B</label>
            <input id="pub-spend-b" value={publicSpendKeyB} onChange={(event) => setPublicSpendKeyB(event.target.value)} required />
            <label htmlFor="pub-view-b">Public view key B</label>
            <input id="pub-view-b" value={publicViewKeyB} onChange={(event) => setPublicViewKeyB(event.target.value)} required />
            <button type="submit">Combine Public Keys</button>
            {combinedAddressFromPublic ? <p className="result-value">{combinedAddressFromPublic}</p> : null}
          </form>
        </section>
      ) : null}

      {!isLoading && isUnlocked && selectedWalletType === 'monero' && moneroView === 'recover' ? (
        <section className="card">
          <h2 className="chain-title">
            <img className="chain-logo" src={moneroLogo} alt="" />
            Recover Combined Wallet
          </h2>
          <p className="hint">Add the counterparty's leaked private spend key to your saved key to gain full spend and view control of the combined address.</p>
          <form className="import-form" onSubmit={onRecoverCombinedWallet}>
            <label htmlFor="counterparty-private-spend">Counterparty private spend key</label>
            <input id="counterparty-private-spend" value={counterpartyPrivateSpendKey} onChange={(event) => setCounterpartyPrivateSpendKey(event.target.value)} placeholder="64 hexadecimal characters" autoComplete="off" required />
            <button type="submit">Recover Full Key Material</button>
          </form>
          {recoveredMaterial ? (
            <div className="flow-panel">
              <MoneroKeyList material={recoveredMaterial} />
              <button type="button" onClick={onSaveRecoveredWallet} disabled={isSubmitting}>
                {isSubmitting ? 'Encrypting...' : 'Encrypt and Save Recovered Wallet'}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {error ? <p className="error">{error}</p> : null}
    </main>
  );
}

export default App;
