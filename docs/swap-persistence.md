# Durable LeakSwap Records

Zebgen stores versioned, password-encrypted swap records, signing journals and
verified settlement evidence in extension local
storage. These survive page refresh and browser restart, but not profile deletion
or extension removal. There is no portable export/import backup yet.

## Swap Identity

An approved `saveLeakSwap` request binds an application ID to the current Algorand
genesis hash, derived Algorand account, original Monero wallet, Monero network and
encrypted combined-address context. Zebgen reads parties, public spend keys and
deadlines from the configured Algod, checks them against the wallet/context, and
rejects identity replacement. Restore heights can only move earlier.

Legacy records validate state consistency, not deployed application bytecode
provenance. Agreement-bound records additionally compare application bytecode
against the supported protocol artifact. The configured node supplies chain
data and compiles sponsor TEAL; it must be trustworthy.

LeakSwap saves Ali's record after deployment and before funding; a failed save
blocks funding until retried. The signed deployment reference is journaled even
before an application ID is known, but automatic deployment-ID reconciliation
from that reference is not implemented. Xin saves when loading the application
or before claiming. Monero sends from the generic wallet are not gated on this
record: users can still send without first loading the swap.

## Signing Journal

For page-requested Algorand signing, Zebgen encrypts transaction IDs, genesis hash,
sender, origin, validity rounds, unsigned transaction bytes and signing time
before returning signatures. Storage failure prevents signature delivery. It does
not store signed transaction bytes or claim that the transaction was submitted.
Unsigned settlement arguments can contain deliberately leaked key material and
are encrypted along with the rest of the journal.

Only transactions signed locally are journaled; a counterparty's settlement must
still be located on-chain. The journal is not an automatic broadcast retry queue.

## Resume

After reconnecting to LeakSwap, approve `listLeakSwaps` through Load Saved Swaps.
The response shares saved view keys, public identity and signed references with
the approved page, never private spend keys. Records are filtered to the active
wallets and exact network identity. Loading does not require the app to exist.
Current status still requires chain reconciliation; stored signed references are
shown explicitly as unconfirmed references.

Confirmed claim/refund outcomes are stored on the encrypted swap record with
their transaction ID and confirmed round. After settlement the page requests a
Save Confirmed Swap Settlement approval. Zebgen verifies the transaction's
genesis, app, sender, deletion call, method and (for leaky calls) signature, without
querying the deleted application. A stored terminal outcome cannot be replaced
or cleared by a stale save. Signing alone never marks a swap complete.

When loading an older saved swap, Zebgen reconciles its journaled settlement
references against algod and saves any verified terminal outcome. Unavailable
history is logged and leaves the result unverified, not completed. Resuming a
verified claim shows ALGO claimed and contract deleted, rather than prompting
Xin to wait for deployment or deposit again.

The wallet dashboard refreshes its public Monero inventory on focus/visibility
return, including wallets saved through a separate approval window. Recovery
does not automatically activate the added wallet.

Inside Zebgen's Monero LeakSwap view, saved identities and signed references can
be inspected offline after unlocking. The context-bound manual leaked-key form
remains available.

## Recover After Settlement

LeakSwap keeps Claim XMR (Ali) and Recover XMR (Xin) available for a saved app,
independent of live application state. Approving `recoverLeakSwapMonero` searches
the configured indexer for settlement references and verifies candidates through
algod. If the localnet indexer is unavailable, Zebgen scans at most 2,048 recent
local blocks. A confirmed transaction ID can also be supplied directly. Older
local history and unavailable remote indexers require that reference; no large
remote block scan is started automatically.

Recovery checks exact genesis, app ID, counterparty sender, deletion completion,
ABI method, confirmed round, signature encoding, fixed nonce, signature validity
and recovered public key. Ali needs Xin's leaky claim; Xin needs Ali's leaky
refund. App deletion or a punish refund alone is not sufficient. The recovered
combined address must match the authenticated encrypted context.

The original wallet/share remains required. Private spend keys never return to
the page. Zebgen encrypts the recovered wallet using the saved restore height,
reuses an existing matching wallet, and does not switch active accounts or send
funds. Select the recovered Monero wallet in Zebgen to scan and spend. The saved
record and original context must survive; this is not recovery from profile loss.

## Advanced Recovery And Support

In Zebgen's LeakSwap view, expand **Advanced recovery and support records** and
load the saved records. This works without the LeakSwap page or a live application.
Select a record to inspect its application ID/address, genesis hash, party addresses,
combined Monero address, network, restore height, agreement digest, deadlines,
verified settlement reference and matching locally signed transaction references.
The journal records signing, not submission or confirmation. A deployment signed
before its application ID was assigned remains in the journal but is not automatically
associated with this per-application report. Monero deposit history is separate.

Export support report downloads an allowlisted JSON report. It excludes mnemonic,
private spend keys, private view keys and raw transaction arguments, which can contain
leaked shares. It still links public identities: obtain user consent before sharing.
This report is not a wallet backup. Never ask a user to send their mnemonic, password,
private view key, leaked scalar or decrypted wallet context to support.

The manual settlement transaction ID field bypasses history discovery, not validation.
Use the original Algorand account and matching networks. Zebgen verifies the same
chain/application/sender/confirmation/signature/address bindings as ordinary recovery.
The existing context-bound manual leaked-key form is also available separately;
never paste a leaked scalar into a support ticket.

After successful settlement verification, Zebgen encrypts and saves the transaction
bytes, transaction ID and confirmed round before saving the recovered wallet. Later
attempts can revalidate this retained evidence without querying settlement history.
Evidence is immutable and bound to the saved swap. Chain identity and the original
wallet/share are still required. The configured node is trusted for the initial
confirmation observation; this is not an independently verified consensus proof.

Before the first successful lookup, an unavailable indexer or pruned history still
requires a settlement reference and a node that serves it. Capturing evidence is not
a background watchtower while Zebgen is locked or the browser is closed. Profile loss
remains unrecoverable without an external wallet/context backup, which is not yet
implemented. Do not clear browser storage or reinstall the extension when investigating
an incomplete swap.

## Authenticated Handshakes

Invite and acceptance records are encrypted before their links are returned.
Ali can match an acceptance to the saved offer after a browser restart. Links
carry a versioned SHA-256 checksum for truncation/corruption detection and an
Ed25519 signature for authentication. Checksums alone do not authenticate a
counterparty, and address authentication does not prove a chat identity.

Signing accepts only structured, strictly validated offer or acceptance fields.
The wallet constructs canonical JSON with a fixed `LeakSwap/Offer/v1` or
`LeakSwap/Acceptance/v1` domain; callers cannot supply bytes or a custom domain.
Acceptance signatures bind the full offer digest and Xin's identity/key material.

XHD `2.0.0-canary.1` marks `rawSign` private. Its public `signAlgoTransaction`
wrapper signs the supplied bytes directly, without adding `TX`. The constrained
handshake helper uses that wrapper only after manual field, domain and prefix
checks. It does not use `signData`: that method compiles an Ajv schema at runtime,
which violates extension CSP. CSP is unchanged; no `unsafe-eval` permission was
added. Tests compare both signing paths byte-for-byte and verify that handshake
signing still works when `signData` is disabled.

Links share private view keys, never private spend keys. Fragments are visible to
the recipient and page JavaScript. New approvals create dedicated swap shares;
they do not use the normal funding wallet's private view key.
Creating or accepting a link authenticates terms; it does not transfer funds.

## Dedicated Key Shares

Explicitly approved `createSwapInvite` and `acceptSwapInvite` operations generate
fresh Monero key material and encrypt it in a separate `leakswapShare:` vault
before returning signed links. Acceptance retries reuse the exact saved share,
including after restart or concurrent requests. Existing legacy acceptances are
returned without replacing their keys. Each share binds the offer digest, exact
Algorand genesis hash and derived account identity, and Monero network (including
the mainnet/regtest distinction).

Shares have negative context IDs, separate from positive normal-wallet database
IDs. Unlocking a share verifies its identity and networks without changing normal
wallet metadata. They appear only in LeakSwap's key-share inventory, with no
receive address, send controls or generic payment capability. They are not normal
funding wallets. Existing wallets, contexts and legacy agreements are retained.

The provider's share-info, combined-address, scan and leaky-signature requests
carry `agreementDigest`; the wallet resolves the encrypted accepted record and
its own share, never a global selected-share pointer. Combined operations enforce
the signed counterparty keys. Leaky signing also requires `agreementAppId` and
verifies the application and exact message address. Saving, listing, readiness
checks and context-bound recovery use the same share identity. Legacy agreements
continue to use their original selected normal wallet.

Raw private spend keys are not returned in the inventory or sent to the page.
Leaky signatures nevertheless reveal those keys, as described below. Like existing
encrypted records, shares survive restarts but not profile deletion or extension
removal. Portable backup/export is not implemented. No storage reset or migration
is performed.

## Agreement-Bound Execution

Use Accepted Swap loads the agreed role and keys, computes the combined address
through Zebgen, and locks the parties, amounts and deadlines. Deployment uses
the exact signed Unix seconds, not the minute-rounded date inputs. Each signing
request carries the offer digest; Zebgen loads its own encrypted accepted record,
verifies both signatures and checks the active wallets and networks.

Before deployment signing, Zebgen checks the ABI arguments and supported
approval/clear bytecode. After deployment it checks the same identities, keys,
deadlines and bytecode against on-chain state. Sponsor funding must target the
LogicSig address derived by locally assembling the bundled protocol TEAL template
with the app ID and agreed parties, without trusting a node compiler response.
Atomic funding must pay exactly the agreed ALGO amount plus the expected sponsor
reserve. An already fully funded escrow blocks retries; unsolicited dust or a
partial balance does not block funding. Deposit and settlement checks require
at least the agreed escrow amount.

### Wallet-Owned Settlement And Disclosure

Accepted agreements use `settleLeakSwap({ agreementDigest, appId, action })`,
where action is `claim` or `refund`. The wallet derives the parties, key share,
sponsor, fees and ABI arguments from its authenticated agreement and bundled
protocol. Requests cannot supply a signature, recipient, fee or transaction.
Agreement-bound signature export and generic claim/refund signing are refused,
including in development builds. The page requires the new API and does not
fall back to signature export for an accepted agreement.

Before generating the revealing signature, the wallet checks application code
and state, network, active party, key identity, escrow and sponsor funding,
readiness and deadlines. It constructs the group locally, generates the leaky
signature internally, records a transaction reference in the encrypted journal,
and simulates with the real sponsor LogicSig and an unsigned application call.
Only a passing simulation permits Algorand signing and direct submission from
the wallet. The page receives only the confirmed transaction ID and round.
The wallet serializes settlement attempts and rechecks account, network and
approval cancellation before signing and broadcasting.

Anyone possessing the leaky signature and public message can recover the spend
key. The simulation node receives this signature even if simulation fails;
confirmation and broadcast are not prerequisites for disclosure to that node.
A successful simulation checks only the node's reported current state, not
future inclusion or cross-chain settlement. State/deadline races and dishonest
nodes remain risks. Submission/confirmation failures report an uncertain result
with a transaction reference, not a claim that disclosure was rolled back.
The encrypted journal supports later reconciliation; it is not automatic retry.

Unbound development/e2e manual swaps retain the old signature-export API. They
do not receive the accepted-agreement protections above. Legacy accepted
agreements use the wallet-owned path but may still disclose their original
normal-wallet spend key rather than a dedicated share; the approval warning
therefore applies to the selected swap key, not necessarily a disposable key.

Tests in `scripts/settleLeakSwap.test.mjs` cover local rejection before signature
generation, simulation rejection/errors, cancellation, storage failure, receipt
allowlisting and uncertain submission. The opt-in command
`node --experimental-transform-types --no-warnings scripts/settleLeakSwap.localnet.mjs`
uses disposable LocalNet accounts/apps to exercise real simulation, signing,
confirmation, deletion and escrow/sponsor closeout for both claim and refund.
It does not exercise browser approval or real Monero funding.

The private app's `e2e-ui/walletSettlement.ts` covers the real browser provider,
encrypted offer/acceptance and share vaults, runtime sender-origin rejection,
signature-export rejection, premature claim refusal, explicit denial, and a
confirmed wallet-owned refund followed by rejection of a deleted-app retry.
It checks receipt-only responses and captures narrow/desktop approval layouts.
Run with `ZEBGEN_EXTENSION_PATH` pointing at an isolated e2e extension build;
`LEAKSWAP_TEST_URL` optionally selects the page server. The extension build can
be isolated with `ZEBGEN_BUILD_OUT_DIR=.output/security-review wxt build --mode e2e`.
This scenario uses fresh profiles and disposable LocalNet funds, without Monero
mining or clock changes. It invokes the provider directly from the page, not
the page's claim/refund buttons, and does not prove a full browser Monero swap.

The saved swap binds the app ID to the digest. Later signing requests referencing
that app or escrow infer the binding even when the page omits the digest. The
agreement is restored with saved swaps after reload, including after app deletion.
Legacy/manual swaps without a binding retain their existing behavior; there is
no blanket rule treating every generic transaction as a LeakSwap agreement.

Xin's first save checks the escrow amount. Set Ready and claim signing recheck
it. New offers include a wallet-captured `moneroRestoreHeight`: the configured
Monero chain height at offer creation minus a 20-block safety margin, bounded at
zero. The height is part of the canonical offer signature and acceptance digest,
captured before the combined address can be funded. If the height probe fails,
the wallet logs the failure and signs height zero instead. Existing offers without
this field retain their original signing bytes and use height zero.

For Set Ready, Zebgen independently scans from the signed height and requires at
least the agreed mature received XMR. The page also starts no later than that
height; an explicit earlier diagnostic height remains allowed. Saved agreement
recovery contexts are lowered to this bound, never moved later. These checks are
additional to the page check and cannot be bypassed by a direct provider request.
The configured daemon remains trusted for its chain height and chain data.
These remain view-only received totals, not
proof that outputs are unspent. Generic Monero sends are not restricted to an
agreement amount or recipient.

## Monero Balance Checkpoints And Activity

The unlocked-balance view encrypts its last verified total, scan height and time.
Storage keys are hashed and scoped to wallet address, network, daemon and restore
height. Reopening restores that observation immediately and checks the daemon
height. New blocks trigger another balance scan for short wallet histories;
histories exceeding 5,000 blocks require explicit refresh to avoid repeated large
downloads. Failed refreshes retain the last observation, not a claimed live total.

This is snapshot persistence, not incremental output scanning. Published
`zebgen-monero-wasm` 0.4.0 returns only an aggregate unlocked balance. A correct
incremental implementation needs a persistent output ledger, spent-key-image
checks, maturity updates and reorg reconciliation in the scanner. Advancing the
restore height and adding new totals would miss old spends and maturity changes.

New outgoing Monero transactions journal encrypted hash, amount, fee, wallet,
network, daemon and relay outcome before broadcast. The overview reloads these
records after navigation/restart and checks the daemon for pool or block inclusion.
Uncertain outcomes are not failures and are never automatically retried. This
does not reconstruct transactions sent before journaling was introduced, or
provide incoming transaction history. Raw transactions and private keys are not
stored in activity records.

## Deposit With Zebgen

`depositLeakSwapMonero({ agreementDigest, appId })` opens an explicit review.
Zebgen derives the destination and exact amount from its accepted agreement,
verifies the supported application, ALGO funding and deposit deadline, and uses
the active normal Monero wallet, never a dedicated swap share. The user prepares,
reviews the fee and confirms Send with a fresh password/PIN. Relay is not
confirmation; the page and wallet show the hash for subsequent status checks.

An encrypted reservation bound to agreement, application, genesis and Monero
network is saved before relay under a cross-context lock. Existing relaying,
submitted or unknown attempts prevent another provider deposit, including after
restart. There is no automatic reset for uncertain outcomes. Keep extension
storage intact and reconcile activity before taking any manual recovery action.
Other wallets remain supported through the displayed address and copy control.

## Checks

- `node --experimental-transform-types --no-warnings --test scripts/swapRecords.test.mjs scripts/fundingProvider.test.mjs`
- `node --experimental-transform-types --no-warnings --test scripts/swapHandshake.test.mjs`
- `node --experimental-transform-types --no-warnings --test scripts/swapAgreement.test.mjs`
- Private browser `npm run test:handshake`: invite/acceptance, zero-ALGO
  authentication, accepted deployment and exact funding, real XMR deposit and
  sponsored claim. Rejects altered deadlines/bytecode/amount/sponsor, omitted
  digest bypass, duplicate funding and direct-provider readiness without XMR.
  Both browsers restart before settlement and restore records after deletion.
- Private browser `npm run test:refund`: all four scenarios close/reopen both
  existing profiles after app deletion, restore records in page and extension,
  then recover and sweep where funded.
- Private browser `npm run test:zebgen`: both parties reload/resume before the
  Monero deposit, followed by a real sponsored claim and recovered-wallet sweep.

Missing certification: fresh-profile backup restoration, interrupted signing,
concurrent approvals, deployment response loss, counterparty history discovery,
and browser storage quota exhaustion. Journal retention/pruning is not yet added;
quota errors fail signing rather than silently dropping recovery references.