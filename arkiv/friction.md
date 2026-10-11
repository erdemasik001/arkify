# Arkiv friction log

Kept while building Arkify (9–18 Oct 2026). Every entry is something we hit or tested ourselves.
Entries marked **[source]** come from reading the installed SDK; entries marked **[runtime]** were
reproduced against Tiramisu. Working paths are logged with the same rigour as problems.

Environment: macOS 26.6 (Darwin 25.6), Node 22.23.2, pnpm 12.10.1, `@arkiv-network/sdk@0.8.1`,
`viem@2.57.4`, Tiramisu (chain ID 7738577).

Format: **surface · version · expected · actual · reproduce · suggested fix**

---

## F-001 · SDK README ships a shared private key [source]

- **Surface:** docs (SDK README on npm)
- **Version:** `@arkiv-network/sdk@0.8.1`
- **Expected:** the README teaches the env-var pattern the challenge rules require ("never paste a private key into code").
- **Actual:** the README prints a hex private key "for quick testing" and the write example inlines `privateKeyToAccount('0x...')`. Anyone copying the sample writes entities from a key every other reader also holds, so `$creator` on those entities proves nothing.
- **Reproduce:** `npm view @arkiv-network/sdk readme | grep -n "example key" -A3`
- **Suggested fix:** remove the key; read it from `process.env.PRIVATE_KEY` in the sample and point to the Hub faucet.

## F-002 · `brotli-wasm` is a runtime dependency but the shipped build never uses it [source]

- **Surface:** SDK (packaging)
- **Version:** `@arkiv-network/sdk@0.8.1`
- **Expected:** runtime dependencies are code the bundle imports.
- **Actual:** `package.json` declares `brotli-wasm@^3.0.1` (3.2 MB on disk). `src/utils/compression.ts` exists but nothing calls `compress()`/`decompress()`, and `grep -rl brotli dist/` returns nothing. Payloads are therefore **not** compressed by the SDK; callers must compress themselves to stay under the 128 KiB payload limit.
- **Reproduce:** `pnpm add @arkiv-network/sdk@0.8.1 && grep -rl brotli node_modules/@arkiv-network/sdk/dist` → no output; `du -sh node_modules/.pnpm/brotli-wasm*`.
- **Suggested fix:** drop the dependency (or wire compression in as an opt-in `createEntity({ compress: true })` and document it).
- **Measured impact (11 Oct) [runtime]:** `pnpm measure-sources` sizes real solc standard-JSON inputs from Sourcify against the 131072-byte limit. Single-file contracts fit raw (WETH9 40 KB, UniswapV2Router02 36 KB). Multi-file ones do not: SwapRouter02 is 654 KB raw / 107 KB gzip / 42 KB brotli, UniswapV3Factory is 2.1 MB raw / 353 KB gzip / 41 KB brotli. So gzip is not always enough and Arkify compresses source bundles with brotli itself, the codec the SDK already ships but does not expose.

## F-003 · README links to files not in the package [source]

- **Surface:** docs
- **Version:** `@arkiv-network/sdk@0.8.1`
- **Expected:** "Sample code can also be found in the `sample` directory", `BUILD.md`, `CONTRIBUTING.md` resolve for an npm user.
- **Actual:** none of them ship in the tarball; the README's install snippet also still shows `"^0.6.0"`.
- **Reproduce:** `ls node_modules/@arkiv-network/sdk` → `LICENSE.md README.md dist package.json src`.
- **Suggested fix:** use absolute GitHub links; bump the version in the snippet.

## F-004 · `createdBy()` takes one address; a trust list needs a hand-built `OR` [source]

- **Surface:** SDK (query builder)
- **Version:** `@arkiv-network/sdk@0.8.1`
- **Expected:** filtering by a set of trusted creators is a first-class call (it is the core of the Security pillar).
- **Actual:** `SelectQueryBuilder.createdBy(creator: Hex)` stores a single `eq("$creator", addr(x))`; calling it twice overwrites. Workaround: `.where(or(trusted.map(a => eq("$creator", addr(a)))))`.
- **Reproduce:** see `src/query/queryBuilder.ts`, `createdBy()`.
- **Suggested fix:** accept `Hex | readonly Hex[]` in `createdBy()` / `ownedBy()`.

## F-005 · Entity events carry no attributes or creator [source — to be confirmed at runtime]

- **Surface:** SDK (`watchEntityEvents`) / protocol events
- **Version:** `@arkiv-network/sdk@0.8.1`
- **Expected:** a listener interested in one entity type can filter on the event.
- **Actual:** `EntityCreatedEvent` has `entityKey, owner, expiresAt, creationFlags` only. A worker that watches for `type = "arkify.request"` must call `getEntity` for every created entity on the chain (N+1 reads).
- **Reproduce:** see `src/types/events.ts`.
- **Suggested fix:** an attribute filter on the subscription, or include `$creator` and selected attributes in the log.
- **Measured (11 Oct) [runtime]:** a WebSocket subscription that only listened for 30 s received 20 `EntityCreated` and 6 other events from 2 owners, none of them ours (the network's own `arkiv-chain-indexer-baseload` generator). The read fan-out therefore scales with chain-wide activity, not with the app's. `owner` is an indexed topic in the event ABI, so a topic filter is possible at the `eth_subscribe` level, but `watchEntityEvents` has no parameter for it.

## F-006 · The Hub landing-page query snippet throws on SDK 0.8.1 [runtime]

- **Surface:** Hub (https://hub.arkiv.network, hero code sample)
- **Version:** Hub build `production · d5494dd`, `@arkiv-network/sdk@0.8.1`
- **Expected:** the featured sample, `.where(gt('created', Date.now() - 86_400_000))`, runs against the current SDK.
- **Actual:** a bare number is typed as `i32`, so it throws before any request: `InvalidValueError: Invalid i32 value 1791649044380: outside the i32 range [-2147483648, 2147483647] — use u64(...) for large counters, timestamps and block heights (Date.now() does not fit an i32)`. The error text itself is excellent: it names the fix.
- **Reproduce:** `import { gt } from "@arkiv-network/sdk/query"; gt("created", Date.now() - 86_400_000)`
- **Suggested fix:** show `gt('created', u64(Date.now() - 86_400_000))` on the Hub.

## F-007 · Client types expose fewer actions than the clients have; the wallet client cannot read entities [source + runtime]

- **Surface:** SDK (client types, JSDoc)
- **Version:** `@arkiv-network/sdk@0.8.1`
- **Expected:** `createPublicClient` returns something usable as a viem public client (it calls `.extend(publicActions)`), and, as the `createWalletClient` JSDoc says, the wallet client exposes writes "on top of the read actions a Public Client has".
- **Actual:**
  - `PublicArkivActions` picks 10 viem actions (`getBalance`, `getBlock`, `getBlockNumber`, `getChainId`, `getLogs`, `getTransaction`, `getTransactionCount`, `getTransactionReceipt`, `waitForTransactionReceipt`, `watchEvent`). `getGasPrice`, `getCode`, `estimateGas` and `readContract` are functions at runtime but `pub.getGasPrice()` fails with `TS2339: Property 'getGasPrice' does not exist`.
  - On the wallet client `getEntity`, `select` and `watchEntityEvents` are `undefined` at runtime, so every writer needs a second, public client to read back what it wrote.
- **Reproduce:** `const pub = createPublicClient({ chain: tiramisu, transport: http() }); pub.getGasPrice()` → compile error; `typeof (pub as any).getGasPrice` → `"function"`; `typeof (createWalletClient({ ... }) as any).getEntity` → `"undefined"`.
- **Workaround:** `import { getGasPrice } from "viem/actions"; getGasPrice(pub)`, and keep one public client beside each wallet client (see `scripts/spike.ts`).
- **Suggested fix:** type the public client with viem's full `PublicActions` (or document the subset), and either add the Arkiv read actions to the wallet client or fix its JSDoc.

## F-008 · The query builder rejects `$createdAt` filters that the node accepts [runtime]

- **Surface:** SDK (query builder) vs RPC (`arkiv_query`) vs challenge docs
- **Version:** `@arkiv-network/sdk@0.8.1`, Tiramisu at block ~442,900
- **Expected:** the challenge's `AGENTS.md` says to "range-filter on `$createdAt`", so `gt("$createdAt", u64(n))` should build.
- **Actual:** the builder throws before any request: `InvalidPredicateError: "$createdAt" is returned in query results but carries no index, so it cannot be filtered on`. The node disagrees. As raw text the same predicate is accepted and applied: `$createdAt >= u64(442908) AND $createdAt <= u64(442938)` returned entities created at 442938, 442937, 442936; `$createdAt > u64(542938)` and `$createdAt < u64(1000)` returned none. `$updatedAt` really is rejected by the node ("$updatedAt is not queryable — it is returned by projections only").
- **Reproduce:** `gt("$createdAt", u64(0n))` throws; `await client.query("$createdAt > u64(0)", { limit: 2 })` returns two entities.
- **Workaround:** pass the predicate as a string, e.g. ``client.query(`${eq("type", "x")} AND $createdAt > u64(${block})`)``.
- **Suggested fix:** move `$createdAt` to `QUERYABLE_SYSTEM_ATTRIBUTES` as `u64` in `src/query/expression.ts`.

## F-009 · `QueryError` replaces the node's explanation with a generic message [runtime]

- **Surface:** SDK (errors) / RPC (`arkiv_query` error codes)
- **Version:** `@arkiv-network/sdk@0.8.1`, `viem@2.57.4`
- **Expected:** a rejected query says what is wrong with it. The node does: `{"code":-32002,"message":"this system attribute holds u64 — write u64(0)","data":{"message":"…","position":13}}`.
- **Actual:** the SDK surfaces `Query rejected (type, -32002): Requested resource not available.. Query: $expiresAt > 0`. A parse error (`nonsense !!`) becomes `Query rejected (parse, -32001): Requested resource not found..` while the node said `unexpected '!' — negation is written NOT`. The node's codes -32001 and -32002 are also EIP-1474's "resource not found" / "resource unavailable", so viem attaches those generic `shortMessage`s and `asQueryError` picks the first `shortMessage` it finds. The useful text survives only on `error.data.message`.
- **Reproduce:** `await client.query("$expiresAt > 0").catch((e) => console.log(e.message, e.data))`; compare with `curl -s -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"arkiv_query","params":["$expiresAt > 0",{}]}' https://rpc.tiramisu.db-chain.testnet.arkiv.network`.
- **Suggested fix:** in `asQueryError`, prefer `data.message` (and `data.position`) over `shortMessage`.

---

## Working paths (tested, behaved as documented)

Read-only paths, tested on 11 Oct without a funded wallet. Write paths follow once `pnpm spike` has run.

### W-001 · Block timing matches the SDK constant [runtime]

- **Surface:** RPC (`arkiv_getBlockTiming`), SDK `getBlockTiming()`
- **Tested:** `getBlockTiming()` returned `{ currentBlock: 442902, currentBlockTime: 1791735556, blockDuration: 2 }`. Independently, the timestamps of the latest block and the block 500 earlier are exactly 1000 s apart: 2.000 s per block, the same as the SDK's `BLOCK_TIME`, so `ExpirationTime.fromHours(1)` is 1800 blocks and an hour in practice. Base fee 1 gwei, block gas limit 36,000,000.

### W-002 · Reading without the SDK: `arkiv_query` over plain JSON-RPC [runtime]

- **Surface:** RPC
- **Tested:** `curl -s -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"arkiv_query","params":["$createdAt > u64(0)",{"limit":"0x1","select":{"key":true,"creator":true,"owner":true,"createdAt":true,"expiresAt":true,"attributes":true}}]}' https://rpc.tiramisu.db-chain.testnet.arkiv.network` returns `{ data: [{ key, owner, creator, createdAt, expiresAt, attributes: [{ name, type, value }] }], blockNumber, cursor }`. No key, no account, no SDK. This is the path Arkify's "verify without us" panel prints.
- **Worth knowing:** without `select` the node returns only `key`; literals must be typed (`u64(0)`, `str('x')`, `addr(0x…)`), which the SDK's `eq(...).toString()` renders for you.

### W-003 · `watchEntityEvents` over a WebSocket transport [runtime]

- **Surface:** SDK `watchEntityEvents`, WebSocket endpoint
- **Tested:** `createPublicClient({ chain: tiramisu, transport: webSocket() })` with no `fromBlock` delivered 26 events in 30 s with no errors and no polling loop of ours. Latency against our own writes is measured in the spike.

