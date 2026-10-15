# Devfolio submission draft

Draft answers for the Devfolio project form, following the challenge's
[submission checklist](https://github.com/Arkiv-Network/global-tour-stop-pre-devcon/blob/main/docs/submission-checklist.md).
On Devfolio the answers are private to organisers and judges. Anything committed here is public.

Lines marked **TODO** need a decision or a fact only the team has.

Before submitting:

- Replace `blob/main` in every code link with `blob/<final commit SHA>`, so line anchors keep pointing at the judged code.
- Fill in the live URL and the video link.
- Never paste a private key, seed phrase, access key or an RPC URL that contains one.

---

## Standard fields

**Project name:** Arkify

**Tagline:** Independent verifiers prove a smart contract's source matches its bytecode, and sign it on Arkiv for anyone to read without our servers.

**Project links:**

- Repository: https://github.com/erdemasik001/arkify
- Demo video (≤ 3 min): **TODO**
- Live app: **TODO**

**Tracks:** Security, Censorship Resistance

### The problem it solves

When a block explorer marks a contract's source as "verified", people act on it. Users sign
approvals because the source looks harmless. Auditors review that source instead of the bytecode.
Wallets repeat the badge. That badge comes from a single operator's database, and the operator can
be wrong, compromised, pressured to remove an entry, or offline. We built a Soroban verifier before
(Sorofy). Its results lived in our own SQLite file, so we could have edited, deleted or invented any
of them, and no reader could tell.

Arkify removes that single point of trust and of censorship:

- Independent verifiers recompile the source with the official solc release and compare it with
  the deployed runtime bytecode. Each writes a signed attestation to Arkiv from its own wallet.
- Readers count only attestations whose on-chain `$creator` is in their own trusted list. The
  filter runs on the Arkiv node, so a forged attestation from any other account is never counted.
- A contract is Verified only when at least two trusted verifiers matched the same source, and
  Disputed if trusted verifiers contradict each other.
- Every attestation is scoped to the keccak256 of the code deployed now, so it never carries over
  to different code at the same address.
- The web app is static with no backend. Every page prints the exact Arkiv query and a `curl` that
  reproduces it. If our site and verifiers vanished, the answers would still be readable from
  Arkiv.

### Challenges I ran into

Each of these is logged with versions and steps to reproduce in `arkiv/friction.md`.

- **Our first create failed.** The draft schema used camelCase attribute names (`chainId`,
  `codeHash`), which the SDK accepts and the Tiramisu engine rejects. The SDK's revert message even
  claims uppercase is allowed (F-010). We moved to snake_case.
- **Solidity sources do not fit raw.** The public RPC refuses bodies over about 256 KiB, which caps
  a payload near 129 KB, below the SDK's 128 KiB constant once hex-encoded (F-011). A 2.1 MB
  multi-file input is 353 KB with gzip but 41 KB with brotli, so we compress with brotli. The SDK
  ships brotli but never uses it (F-002).
- **A drained query budget looked like a hang.** The anonymous RPC allows about 100
  `arkiv_query` calls per hour. viem's transport silently sleeps for the full `Retry-After`, so our
  verifiers froze with no error (F-013). We wrote a transport that fails fast and turns the 429 into
  a "try again in N minutes" message. The web app is built to need only five queries per contract
  page and to take live updates from WebSocket events, which are not metered.
- **Events carry no attributes.** An `EntityCreated` event does not say which type it is, so a
  naive listener reads every entity created on the chain (F-005). We derive each Arkify type's
  exact lifetime and creation flags from the event, and drop foreign creates without a read.
- **A refused WebSocket handshake silenced the watcher for good.** The gateway caps concurrent
  sockets per address, and the SDK's watcher never recovered (F-015). Our subscription owns the
  connection, reconnects with backoff, and catches up with a cursor-paginated scan.
- **Compiling untrusted sources safely.** A heavy solc-js compile could starve a verifier's
  heartbeat and leak memory. The engine now runs in a child process with a timeout and a memory
  ceiling. Only official solc releases whose SHA-256 matches the official list are loaded.

---

## Arkiv questions

### 1. Live app URL \*

**TODO**: the deployed URL (Vercel). It must open without asking for access.

### 2. Does any team member hold Indian nationality? \*

**TODO**

### 3. Why Arkiv? \*

Arkify's product is a verification result that nobody controls. Not the submitter, not a verifier,
and not us. The trust model is "count the answers signed by accounts I choose", and that needs three
things together:

1. An authorship field that the chain sets and nobody can write.
2. Queries on that field and on typed attributes, without a server of ours in between.
3. Data that stays available after we stop running anything.

Arkiv's `$creator` provides the first. Its attribute queries over a public RPC provide the second.
Entity Expiration with permissionless Lifetime Extension provides the third.

What breaks with the alternatives:

- **Postgres or any operator database:** the operator can edit, delete or invent results, and
  "signed by" is just a column. This is how our earlier project, Sorofy, worked, and why we
  rebuilt it.
- **IPFS:** proves a blob's integrity but not who published it, and cannot answer "attestations
  about this address and code hash from these signers". That needs an indexer, which is a server
  again. There are no lifetimes either, so a dead verifier would stay listed forever.
- **A subgraph:** needs our own contract and someone running the indexer. Readers query that
  indexer, not the chain, which adds a party that can lag, filter or go offline.
- **Our own API:** exactly the single point of trust and censorship we are removing.

Advantages we get only from Arkiv:

- **The `$creator` filter runs on the node.** Untrusted entities cannot even crowd trusted ones out
  of a result page.
- **Leases are part of the data model.** A verifier's registration expires 15 minutes after its
  last heartbeat, so the registry never shows a dead worker and there is no clean-up job.
- **`readonly` + `permissionlessExtension`.** A published result can never be edited, and anyone who
  relies on it can keep it alive without our involvement.
- **Atomic batches.** A request never points at a missing source, and a verifier's attestation
  never points at a source copy that failed to land.

**Deliberately kept off Arkiv:**

- Compilation and the solc binaries. That is computation that any verifier repeats.
- The deployed bytecode. Ethereum is its canonical store; we keep only its hash.
- Private keys and access keys.
- Each verifier's work queue.
- Each user's trusted list, which is a local preference.

### 4. How do you use Arkiv? \*

Four entity types (`arkify.verifier`, `arkify.request`, `arkify.source`, `arkify.attestation`).
Every attribute, lifetime, flag and query is listed in `arkiv/schema.md`. Feature by feature:

- **`$creator` as the trust model.** The verdict query ends with
  `($creator = addr(a) OR $creator = addr(b) …)`, and its complement `NOT (…)` fills a separate
  "untrusted" section that is shown and never counted. The UI shows each signer's address, linked
  to the explorer, and a Trust button. If a user trusts the demo's dishonest verifier, the ENS
  registry turns from Verified to Disputed.
  [queries.ts](https://github.com/erdemasik001/arkify/blob/main/packages/core/src/queries.ts#L22-L57) ·
  [Contract.tsx](https://github.com/erdemasik001/arkify/blob/main/apps/web/src/pages/Contract.tsx#L174) ·
  [verdict.ts](https://github.com/erdemasik001/arkify/blob/main/packages/core/src/verdict.ts#L62)
- **Typed attributes vs payload.** We filter on `chain_id`, `address`, `code_hash`, `source_hash`
  and `verdict`. Timestamps (`verified_at`, `last_beat`) are `u64`, so they can be queried as
  ranges: the home page counts "attestations in the last 7 days" with `verified_at > u64(…)`.
  Compile details and the brotli-compressed source are payload.
  [records.ts](https://github.com/erdemasik001/arkify/blob/main/packages/core/src/records.ts) ·
  [schema.ts](https://github.com/erdemasik001/arkify/blob/main/packages/core/src/schema.ts)
- **Compound queries and cursor pagination.** `AND`/`OR`/`NOT`, `u64` ranges, and `.createdBy(self)`
  so a verifier finds its own registration, attestations and source copies after a restart. Every
  read walks the cursor in pages of 200 and sorts on the client.
  [client.ts](https://github.com/erdemasik001/arkify/blob/main/packages/core/src/client.ts#L36-L52) ·
  [verifier.ts](https://github.com/erdemasik001/arkify/blob/main/packages/verifier/src/verifier.ts#L323-L337)
- **Entity Expiration per type, following product logic.**
  - Verifier lease: 15 minutes.
  - Request: 24 hours (work to be done, not a record).
  - Source: 180 days (it must outlive the attestations that point at it).
  - Attestation: 90 days.
  - Failed attestation: 24 hours (it says nothing lasting).

  [schema.ts](https://github.com/erdemasik001/arkify/blob/main/packages/core/src/schema.ts#L42-L56)
- **Lifetime Extension as a lease renewed by activity.** Every 5 minutes a verifier sends one batch
  that patches `last_beat` and extends its registration. The Verifiers page goes online or offline
  from `ExpiryExtended` events without polling. A verifier asked again about the same code and
  source extends its existing attestation instead of writing a duplicate.
  [heartbeat](https://github.com/erdemasik001/arkify/blob/main/packages/verifier/src/verifier.ts#L144-L158) ·
  [re-check](https://github.com/erdemasik001/arkify/blob/main/packages/verifier/src/verifier.ts#L265-L272) ·
  [Verifiers.tsx](https://github.com/erdemasik001/arkify/blob/main/apps/web/src/pages/Verifiers.tsx#L28-L30)
- **Creation flags.** Requests, sources and attestations are `readonly` (a verifier cannot rewrite
  a published result) and `permissionlessExtension`. Any visitor can press "Keep alive" on an
  attestation, source or request they rely on. Registrations have neither flag, because only their
  owner should keep them alive.
  [schema.ts](https://github.com/erdemasik001/arkify/blob/main/packages/core/src/schema.ts#L58-L66) ·
  [KeepAlive.tsx](https://github.com/erdemasik001/arkify/blob/main/apps/web/src/components/KeepAlive.tsx)
- **Atomic batches with `predictEntityKeys`.**
  - The source and the request that points at it are one transaction.
  - A verifier's own copy of a matched source and its attestation are one transaction, so a
    verified contract always links to a readable source even if the submitter deletes theirs.
  - The heartbeat is a patch and an extension in one batch.

  [client.ts](https://github.com/erdemasik001/arkify/blob/main/packages/core/src/client.ts#L103-L145) ·
  [verifier.ts](https://github.com/erdemasik001/arkify/blob/main/packages/verifier/src/verifier.ts#L282-L313)
- **WebSocket entity events.** `watchEntityEvents` over a WebSocket transport, with no `fromBlock`.
  Verifiers pick up requests with no polling interval, and contract pages and the home feed update
  without a refresh. Events carry no attributes, so each type's fixed lifetime and flags filter
  foreign creates before any read. The connection is rebuilt with backoff.
  [live.ts](https://github.com/erdemasik001/arkify/blob/main/packages/core/src/live.ts) ·
  [events.ts](https://github.com/erdemasik001/arkify/blob/main/packages/core/src/events.ts#L27-L38) ·
  [Contract.tsx](https://github.com/erdemasik001/arkify/blob/main/apps/web/src/pages/Contract.tsx#L102-L123)
- **Direct JSON-RPC.** Every contract page prints its `arkiv_query` and a `curl` that reproduces
  it ("Verify this without us").
  [Contract.tsx](https://github.com/erdemasik001/arkify/blob/main/apps/web/src/pages/Contract.tsx#L402-L430)

### 5. Friction report: link to `/arkiv/friction.md` \*

https://github.com/erdemasik001/arkify/blob/main/arkiv/friction.md

It has 16 issues (F-001 to F-016) and 14 tested working paths (W-001 to W-014). Each gives the
surface, versions, expected vs actual, steps to reproduce and a suggested fix. The raw spike output
with every transaction hash is in `arkiv/spike-run.json`.

### 6. Wallet addresses that create your Arkiv entities \*

- `0xfEBd2309E6C92c1F924A42Dc78d0E8D95Ea666C0`: requester (demo). Creates `arkify.request` and
  `arkify.source` (end-to-end demo, CLI requests) and the Phase 0 spike entities.
- `0xB5F160b92c066f9613fb05227744c604683cB590`: verifier-a, honest. Creates `arkify.verifier`,
  `arkify.attestation` and its own `arkify.source` copies, plus spike entities.
- `0xcF73f570D2F15C5A814D0D9D63164c4f99012E0E`: verifier-b, honest. Creates `arkify.verifier`,
  `arkify.attestation` and `arkify.source`.
- `0x86C783d97F9B1734ceAD7ac3Aeb12Bc5bC9DAe5C`: verifier-c, honest. Creates `arkify.verifier`,
  `arkify.attestation` and `arkify.source`.
- `0x0288268E6dD0F64F97dE427527f0EADa636c33C3`: evil, a demo-only dishonest verifier. Creates
  `arkify.verifier` and `arkify.attestation`, and always claims `full_match` without compiling.

Requests made from the web app are signed by each visitor's own wallet.

### 7. Link to `/arkiv/schema.md` \*

https://github.com/erdemasik001/arkify/blob/main/arkiv/schema.md

### 8. How can judges reproduce your Arkiv usage? \*

**Without a wallet:**

1. Open the live app (**TODO** URL) and click "ENS registry". This is the ENS registry on Sepolia,
   `0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e`.
   - It shows **Verified**: three trusted verifiers matched the true source.
   - A tampered copy (`owner == msg.sender` → `owner == tx.origin`) shows **Mismatch** from all three.
2. Under "From accounts you do not trust", the demo-only `evil` verifier claims `full_match` for
   both. Press **Trust** on it: the contract turns **Disputed**. Reset it on the Verifiers page.
3. Open "Verify this without us", copy the `curl` and run it. The same attestations come straight
   from the public Tiramisu RPC.
4. Open "Verifiers" to see which verifiers hold a live 15-minute lease and when they last beat.

**From a terminal (read only):**

```
git clone https://github.com/erdemasik001/arkify.git && cd arkify && pnpm install
pnpm arkify check 11155111 0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e
```

**Writing (needs testnet GLM from the Hub faucet):** `cp .env.example .env`, then
`pnpm gen-wallets`, fund the requester, then `pnpm fund`. Then run `pnpm e2e`. It starts three
honest verifiers and the dishonest one, submits the true and the tampered source, and checks the
verdicts read back from Arkiv.

The exact queries are in the README ("Read it yourself") and in `arkiv/schema.md`.

### 9. Pre-existing work you reused \*

- **Idea only, no code.** Arkify is a new implementation of the idea behind Sorofy
  (https://github.com/erdemasik001/Sorofy), our earlier Soroban build verifier. Baseline commit:
  `d0dd356652de1af2540c79d2301ad4902cadbe6a` (20 September 2026). No Sorofy code, schema or
  component is reused. Arkify targets EVM/Solidity, and the Arkiv integration and all core logic
  were written between 9 and 18 October 2026.
- **Third-party libraries only:** `@arkiv-network/sdk`, viem, solc-js (official builds), React,
  Vite, brotli-wasm, Fontsource fonts and Vitest. The Sourcify API is used to import candidate
  sources.

### 10. Arkiv surfaces you used \*

TypeScript SDK, Direct JSON-RPC, WebSocket events, Docs, Hub, Faucet, Access keys, Block Explorer.

**TODO**: confirm, and add Data Explorer / Arkiv MCP / skills / plugin if they were used.

### 11. If you selected Other, name it

Not applicable.

### 12. How long after you started did you write your first Arkiv entity? \*

**TODO** confirm. Suggested: **More than a day**. Phase 0 started on 9 October. The first entity
was created in the spike run on 11 October at 17:22 UTC (`arkiv/spike-run.json`, tx `0x74670ee9…`).

### 13. Which LLMs did you use? \*

**TODO** confirm. Suggested: Claude (Anthropic), through Claude Code.

### 14. What is the one thing Arkiv should improve first? \*

Let entity event subscriptions filter by attribute or creator, or include `$creator` and the
attributes in `EntityCreated`.

Today an event says only key, owner, expiry and flags (F-005). An app that listens for its own
entity type must read back every entity created on the chain, and Tiramisu's background load is a
create every second or two. For a backend-less app this collides with the anonymous query budget
of about 100 queries per hour per visitor (F-013). Events are the unmetered path that makes live
UIs possible, but without a filter they push the app back onto metered reads. Arkify works around
it by fingerprinting its types from lifetime and flags, which no other app should have to do.

### 15. Open to a 20-minute feedback call with the Arkiv team? \*

**TODO**

### 16. This is our team's work, built between 9 and 18 October. Any pre-existing or third-party work is disclosed. \*

**TODO** confirm (see question 9).

### 17. Our repo is public under the MIT licence, and every link is accessible to judges. \*

**TODO** confirm once the live URL and the video link are public. The repo is public with an MIT
licence.

### 18. I plan to attend Devcon 8 in Mumbai (optional)

**TODO**
