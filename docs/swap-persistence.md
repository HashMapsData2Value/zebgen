# Durable LeakSwap Records

Zebgen stores two versioned, password-encrypted record types in extension local
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

Inside Zebgen's Monero LeakSwap view, saved identities and signed references can
be inspected offline after unlocking. Recovery still uses the context-bound
manual leaked-key form. Settlement-ID recovery and archival discovery are not
implemented.

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
the recipient and page JavaScript. Use dedicated swap wallets for privacy.
Creating or accepting a link authenticates terms; it does not transfer funds.

## Agreement-Bound Execution

Use Accepted Swap loads the agreed role and keys, computes the combined address
through Zebgen, and locks the parties, amounts and deadlines. Deployment uses
the exact signed Unix seconds, not the minute-rounded date inputs. Each signing
request carries the offer digest; Zebgen loads its own encrypted accepted record,
verifies both signatures and checks the active wallets and networks.

Before deployment signing, Zebgen checks the ABI arguments and supported
approval/clear bytecode. After deployment it checks the same identities, keys,
deadlines and bytecode against on-chain state. Sponsor funding must target the
LogicSig address derived by compiling the protocol TEAL template with the app ID
and agreed parties. Atomic funding must pay exactly the agreed ALGO amount to
an empty escrow plus the expected sponsor reserve; a funded escrow blocks retries.

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