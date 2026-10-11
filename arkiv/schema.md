# Arkify data contract on Arkiv

Schema version 1. Network: Tiramisu (chain ID 7738577). SDK: `@arkiv-network/sdk@0.8.1`.

The code form of this document is [`packages/core/src/schema.ts`](../packages/core/src/schema.ts),
the queries are built in [`packages/core/src/queries.ts`](../packages/core/src/queries.ts), and
[`packages/core/test/queries.test.ts`](../packages/core/test/queries.test.ts) pins the exact text of
each one. `pnpm smoke` writes one of each entity to Tiramisu and runs every query below against it.

## What is on Arkiv, and what is not

**On Arkiv**, because each of these must outlive and be independent of whoever runs Arkify:

- verification **requests**: who asked for which contract to be checked against which source
- **source bundles**: content-addressed copies of the source a contract is checked against
- verifier **registrations**: a lease each verifier renews while it is alive
- **attestations**: one verifier's signed result for one (deployed code, source) pair

**Deliberately not on Arkiv:**

- Compilation and the solc binaries. That is computation; any verifier repeats it from the source bundle.
- The deployed bytecode itself. Ethereum is already its canonical store. Attestations carry only its hash (`code_hash`).
- Private keys, access keys and any personal data. Verifier names and descriptions are synthetic labels.
- A verifier's work queue and progress. It is rebuilt from requests and the verifier's own attestations.
- The user's list of trusted verifiers. It is a local preference (browser storage or a CLI flag), not shared state.

## Conventions

- Every entity has `type` (`str`) and `schema_version` (`i32`, currently `1`), and every query filters on both.
- Attribute names are lowercase snake_case. The engine rejects uppercase letters ([friction F-010](friction.md)).
- Everything the app filters on is a typed attribute; numbers that need ranges are `u64`. Everything else is payload.
- **Who wrote an entity is never read from an attribute.** It is the on-chain `$creator`, which the chain sets at creation and nothing can change. `$owner` can be transferred and is not used for trust.
- Any account can write an entity with an Arkify `type`. Readers decode defensively (a malformed entity is dropped) and trust nothing until `$creator` or the content hash has been checked.

## Entity types

### `arkify.verifier`

A verifier announcing itself. Written by the verifier's own wallet, so its `$creator` is the address users put in their trusted list.

| Attribute | Type | Meaning |
|---|---|---|
| `type` | `str` | `arkify.verifier` |
| `schema_version` | `i32` | `1` |
| `name` | `str` | Display label. Self-declared, so the UI always shows the `$creator` address beside it. |
| `engine` | `str` | Verification engine, e.g. `evm-solcjs` |
| `engine_version` | `str` | Engine version |
| `last_beat` | `u64` | Unix seconds of the last heartbeat. Queried as a range. |

- **Payload:** JSON `{ description }`.
- **Entity Expiration: 15 minutes, as a lease.** Every 5 minutes the verifier sends one atomic batch that patches `last_beat` and performs a Lifetime Extension back to 15 minutes. A verifier that dies misses three beats and its registration expires, so the registry never lists a dead worker and nobody has to clean up.
- **Flags:** none. The verifier patches it on every beat, so it cannot be `readonly`, and only the verifier should be able to keep its own lease alive.

### `arkify.request`

A request to check a contract against a source bundle. Written by anyone.

| Attribute | Type | Meaning |
|---|---|---|
| `type` | `str` | `arkify.request` |
| `schema_version` | `i32` | `1` |
| `chain_id` | `u64` | EVM chain of the contract |
| `address` | `addr` | Contract address |
| `source_hash` | `bytes32` | Hash of the source bundle to check against |
| `source_key` | `key` | Entity key of that `arkify.source` |

- **Payload:** empty.
- **Entity Expiration: 24 hours.** A request is work to be done, not a record. Once verifiers have answered it, the attestations are the record; an unanswered request should not linger.
- **Flags:** `readonly` (verifiers must attest to what was asked, not to an edited request) and `permissionlessExtension` (if no verifier has picked a request up, anyone can keep it alive without owning it).
- A request and a new source are created in **one atomic batch**: the source's key is computed first with `predictEntityKeys` and stored in the request's `source_key`, so a request never points at a source that failed to land.

### `arkify.source`

A source bundle, stored content-addressed. Written by whoever submits it, and again by every verifier that matches it.

| Attribute | Type | Meaning |
|---|---|---|
| `type` | `str` | `arkify.source` |
| `schema_version` | `i32` | `1` |
| `source_hash` | `bytes32` | keccak256 of the uncompressed, canonical bundle |
| `compiler_version` | `str` | Full solc version, e.g. `0.8.24+commit.e11b9ed9`. Lets lists render without downloading the payload. |
| `contract_name` | `str` | Contract name without its path, for the same reason |

- **Payload:** the bundle `{ compilerVersion, contract, input }`, where `input` is the solc standard-JSON input, serialised with sorted keys and compressed with brotli. Content type `application/vnd.arkify.source+br`.
- **`source_hash` is a claim until checked.** Every reader decompresses the payload, hashes it and compares (`unpackSource`); a payload stored under someone else's hash is rejected. Decompression is capped at 16 MiB.
- **Size:** at most 120 KiB after compression. The public RPC refuses request bodies over about 256 KiB, which caps a payload near 129 KB ([F-011](friction.md)). Measured with `pnpm measure-sources`: UniswapV3Factory's 2.1 MB input is 41 KB with brotli but 353 KB with gzip, which is why brotli is used. A bundle that is still too large is refused; it is not split.
- **Entity Expiration: 180 days.** A source must outlive the attestations (90 days) that point at it.
- **Each verifier keeps its own copy of a source it matched.** The submitter owns the copy they uploaded and could delete it, which would leave a "verified" contract with no readable source. So a verifier writes its own copy and its attestation in **one atomic batch**, the attestation's `source_key` naming the copy by a predicted key. When it attests against that source again, the same batch that writes the attestation performs a Lifetime Extension on the copy. A source that did not match is not copied.
- **Flags:** `readonly` (content-addressed data must never change) and `permissionlessExtension` (anyone who relies on a source can keep it alive).

### `arkify.attestation`

One verifier's result for one (deployed code, source) pair. Written by the verifier's wallet; its `$creator` is what makes it count.

| Attribute | Type | Meaning |
|---|---|---|
| `type` | `str` | `arkify.attestation` |
| `schema_version` | `i32` | `1` |
| `chain_id` | `u64` | EVM chain of the contract |
| `address` | `addr` | Contract address |
| `code_hash` | `bytes32` | keccak256 of the runtime bytecode the verifier read from the chain |
| `source_hash` | `bytes32` | Hash of the source bundle that was compiled |
| `source_key` | `key` | Entity key of an `arkify.source` with that hash: for a match, the verifier's own copy |
| `verdict` | `str` | `full_match`, `partial_match`, `mismatch` or `error` |
| `verified_at` | `u64` | Unix seconds. Queried as a range. |

- **Payload:** JSON details that are shown but never filtered on: `{ engine, engineVersion, durationMs, compiledCodeHash?, message? }`.
- **Verdicts.** The first three are deterministic: every honest verifier reaches the same one.
  - `full_match`: the compiled runtime bytecode is identical to the deployed code, including the metadata hash, which commits to every source file and compiler setting. Immutables and linked library addresses, which are set at deployment, are ignored.
  - `partial_match`: the executable code is identical but the exact source files are not proven, because the metadata hash differs or the contract was built without one.
  - `mismatch`: the source does not produce the deployed code. That includes a source that does not compile, a compiler version that is not an official solc release, and an address with no code.
  - `error`: the verifier could not finish (for example it could not download the compiler). It says nothing about the contract.
- **`code_hash` scopes an attestation to the code that was checked.** If the code at an address changes, old attestations stop matching the lookup, which always uses the hash of the code deployed now.
- **Entity Expiration: 90 days**, renewed by activity: when the same verifier re-checks the same code against the same source it performs a Lifetime Extension on its existing attestation instead of writing a second one. An `error` attestation lives **24 hours**: a failed run says nothing lasting about the contract.
- **Flags:** `readonly` (a verifier cannot quietly rewrite a result it has published) and `permissionlessExtension` (anyone who relies on an attestation can keep it alive, without being able to change it).

## Queries the app runs

Addresses and hashes below are examples. Queries are shown exactly as they are sent to `arkiv_query`.

**1. Verdict lookup: attestations by trusted verifiers** (web, CLI). The `$creator` filter runs on the node, so attestations from anyone else are never returned and cannot crowd a trusted verifier out of a result page.

```
type = str('arkify.attestation') AND schema_version = i32(1) AND chain_id = u64(11155111) AND address = addr(0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2) AND code_hash = bytes32(0xc0c0…c0c0) AND ($creator = addr(0xB5F160b92c066f9613fb05227744c604683cB590) OR $creator = addr(0xcF73f570D2F15C5A814D0D9D63164c4f99012E0E))
```

**2. Everyone else's attestations for the same code** (web). Shown in an "untrusted" section and never counted.

```
type = str('arkify.attestation') AND schema_version = i32(1) AND chain_id = u64(11155111) AND address = addr(0xC02a…6Cc2) AND code_hash = bytes32(0xc0c0…c0c0) AND NOT ($creator = addr(0xB5F1…B590) OR $creator = addr(0xcF73…2E0E))
```

**3. A verifier's own attestation for a (code, source) pair** (verifier, with `.createdBy(self)`). Decides between a Lifetime Extension and a new attestation.

```
type = str('arkify.attestation') AND schema_version = i32(1) AND chain_id = u64(11155111) AND address = addr(0xC02a…6Cc2) AND code_hash = bytes32(0xc0c0…c0c0) AND source_hash = bytes32(0x1111…1111) AND $creator = addr(0xB5F1…B590)
```

**4. Recent attestations** (web live feed, first page; new ones then arrive over WebSocket events). With `.createdBy(self)` a verifier reads what it answered in the last day when it starts, so a restart does not redo that work.

```
type = str('arkify.attestation') AND schema_version = i32(1) AND verified_at > u64(1791739187)
```

**5. Live verifiers, and verifiers seen recently** (web). An expired lease is simply not returned. With `.createdBy(self)` a starting verifier finds the registration it already holds and renews it instead of creating a second one.

```
type = str('arkify.verifier') AND schema_version = i32(1)
type = str('arkify.verifier') AND schema_version = i32(1) AND last_beat > u64(1791739187)
```

**6. Requests: all live ones, those for one contract, and those created after a block** (verifier start-up and catch-up, web). The last is sent as raw text because the SDK's builder refuses `$createdAt` although the node filters on it ([F-008](friction.md)).

```
type = str('arkify.request') AND schema_version = i32(1)
type = str('arkify.request') AND schema_version = i32(1) AND chain_id = u64(11155111) AND address = addr(0xC02a…6Cc2)
type = str('arkify.request') AND schema_version = i32(1) AND $createdAt > u64(444000)
```

**7. Source by content hash** (verifier, web source viewer). Each candidate must still pass the hash check. With `.createdBy(self)` a verifier finds its own copy.

```
type = str('arkify.source') AND schema_version = i32(1) AND source_hash = bytes32(0x1111…1111)
```

## Events

Verifiers and the web app subscribe with `watchEntityEvents` over a WebSocket transport, without `fromBlock`. An `EntityCreated` event carries no attributes ([F-005](friction.md)), and the subscription sees every create on the chain, so [`mayBe`](../packages/core/src/events.ts) first tests what the event does carry: each Arkify type is created with a fixed lifetime and fixed flags, so `expiresAt - blockNumber` and `creationFlags` rule out foreign entities without a read. Only a create shaped like a request (24 hours, `readonly` + `permissionlessExtension`) is read back and decoded.

The subscription is the live path. Under it, each verifier runs query 6 once at start-up and once per heartbeat, so a request that arrived while its socket was down is still answered.

Results are paged with the cursor (the node returns at most 200 per page and in no guaranteed order), and sorted on the client by `verified_at`.

Reading needs no SDK and no Arkify server. Every live Arkify attestation, as a plain JSON-RPC call:

```bash
curl -s https://rpc.tiramisu.db-chain.testnet.arkiv.network -H 'content-type: application/json' --data @- <<'JSON'
{"jsonrpc":"2.0","id":1,"method":"arkiv_query","params":["type = str('arkify.attestation') AND schema_version = i32(1)",{"select":{"key":true,"creator":true,"expiresAt":true,"attributes":true}}]}
JSON
```

## From attestations to a verdict

[`computeVerdict`](../packages/core/src/verdict.ts) is a pure function shared by the web app, the CLI and the verifier.

1. Attestations whose `$creator` is not in the trusted list are set aside and reported as untrusted. They are never counted.
2. The rest are grouped by `source_hash`, keeping each verifier's latest attestation per source. An attestation speaks about one source, so a `mismatch` on one source does not contradict a match on another.
3. Each source is judged: **disputed** if trusted verifiers both matched and mismatched it; **verified** if at least `threshold` (default 2) distinct verifiers matched it; **weakly verified** if fewer did; **mismatch** if it only has mismatches. `error` attestations are shown and not counted.
4. The overall status is the most serious one found, in the order disputed, verified, weakly verified, mismatch, unverified.

## Limits this schema was designed around

Measured on Tiramisu on 11 October 2026; see [friction.md](friction.md) for the reproductions.

| Limit | Value | Consequence here |
|---|---|---|
| Attribute names | lowercase only | snake_case throughout |
| Query operators | `exists`, `!=` and `typeof` are rejected by the node | only `=`, ranges, `AND`, `OR`, `NOT (…)` are used |
| Range filters | numeric types and `$createdAt`, `$expiresAt` | timestamps are `u64` |
| String attribute | 128 bytes | long text (paths, messages) lives in payloads |
| Payload through the public RPC | about 129 KB | source bundles are brotli-compressed and capped at 120 KiB |
| Anonymous RPC budget | about 100 `arkiv_query` calls per hour per client address | five queries for a contract page; live updates come from WebSocket events, which are not metered |
| Lifetime and fees | lifetime does not change the fee | lifetimes follow product logic only |
