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

## F-005 · Entity events carry no attributes or creator [source + runtime]

- **Surface:** SDK (`watchEntityEvents`) / protocol events
- **Version:** `@arkiv-network/sdk@0.8.1`
- **Expected:** a listener interested in one entity type can filter on the event.
- **Actual:** `EntityCreatedEvent` has `entityKey, owner, expiresAt, creationFlags` only. A worker that watches for `type = "arkify.request"` must call `getEntity` for every created entity on the chain (N+1 reads).
- **Reproduce:** see `src/types/events.ts`.
- **Suggested fix:** an attribute filter on the subscription, or include `$creator` and selected attributes in the log.
- **Measured (11 Oct) [runtime]:** a WebSocket subscription that only listened for 30 s received 20 `EntityCreated` and 6 other events from 2 owners, none of them ours (the network's own `arkiv-chain-indexer-baseload` generator). The read fan-out therefore scales with chain-wide activity, not with the app's. `owner` is an indexed topic in the event ABI, so a topic filter is possible at the `eth_subscribe` level, but `watchEntityEvents` has no parameter for it. Confirmed in the spike: the event object's fields are `type, blockNumber, transactionHash, logIndex, entityKey, owner, expiresAt, creationFlags`, and reading the three attributes of our own entity took a separate `getEntity`.
- **Workaround:** `EntityCreated` does carry `expiresAt` and `creationFlags`, and Arkify creates each entity type with a fixed lifetime and fixed flags. `mayBe()` in `packages/core/src/events.ts` drops every create whose `expiresAt - blockNumber` and flags do not fit a request, so only candidates cost a read. It works because the expiry of a relative lifetime is exactly the inclusion block plus the lifetime (spike step M4: created at 444788 for 3 blocks, `expiresAt` 444791).

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

## F-010 · The engine rejects uppercase attribute names that the SDK accepts [runtime]

- **Surface:** SDK (attribute-name validation, revert explanation) vs the Tiramisu engine
- **Version:** `@arkiv-network/sdk@0.8.1`, Tiramisu at block ~444,200
- **Expected:** a name that passes `validateAttributeName` can be written. The SDK's rule is `/^[A-Za-z][A-Za-z0-9._-]*$/` and its errors say "contain only A-Z, a-z, 0-9 … Names are case-sensitive".
- **Actual:** any uppercase letter is rejected by the engine at gas estimation. `chainId`, `Chain`, `aB` and `ABC` fail; `chainid`, `chain_id`, `chain.id`, `chain-id` and `c1` are accepted. The SDK then explains the revert with a sentence that contradicts it: `an attribute name holds "I" (0x49) at byte 5, which is outside the name charset ("A"-"Z", "a"-"z", "0"-"9", ".", "-" and "_", with a letter first)`.
- **Impact:** our first create failed, because every camelCase name in the draft schema (`chainId`, `codeHash`, `verifiedAt`) is invalid. Arkify's attributes are snake_case for this reason.
- **Reproduce:** `client.createEntity({ payload: new Uint8Array(), contentType: "application/octet-stream", attributes: { chainId: "x" }, expires: ExpirationTime.fromMinutes(10) })`; `pnpm spike` records it under step M3 (`upperCaseName`).
- **Suggested fix:** make `NAME_RE` lowercase-only so the mistake is caught before a request, and correct the charset text in `src/utils/revert.ts` and the `InvalidAttributeNameError` message.

## F-011 · A payload at the SDK's 128 KiB limit cannot be sent through the public RPC [runtime]

- **Surface:** RPC gateway vs SDK (`MAX_PAYLOAD_BYTES`)
- **Version:** `@arkiv-network/sdk@0.8.1`, `viem@2.57.4`, public Tiramisu RPC
- **Expected:** a payload of `MAX_PAYLOAD_BYTES` (131072) can be created; 131073 is refused by the SDK with a clear message.
- **Actual:** the gateway caps the HTTP body at about 256 KiB and answers `HTTP 413 {"error":"BAD_REQUEST","message":"request body too large"}`. Calldata is hex in JSON, so it doubles: with two short attributes the largest payload that went through was 129,728 bytes and 129,792 was refused. The limit shrinks as attributes are added. The SDK reports the 413 as `Transaction failed: Execution error without revert data`, which says nothing about size.
- **Reproduce:** create an entity with `payload: new Uint8Array(randomBytes(131072))` (step M1 of `pnpm spike`, `atSdkLimit`); or POST any JSON-RPC body over 262,144 bytes with curl.
- **Workaround:** Arkify caps a source bundle at 120 KiB after compression (122,880 bytes went through at 4,942,360 gas).
- **Suggested fix:** lower `MAX_PAYLOAD_BYTES` to what the gateway accepts or raise the gateway limit, and surface HTTP 413 as a size error.

## F-012 · `exists`, `ne` and `hasType` are exported by the SDK and rejected by the node [runtime]

- **Surface:** SDK (`@arkiv-network/sdk/query`) vs RPC (`arkiv_query`)
- **Version:** `@arkiv-network/sdk@0.8.1`, Tiramisu at block ~444,700
- **Expected:** every operator the query module exports and documents can be run.
- **Actual:** three cannot. The node answers: `exists(…) is not supported — the index has no per-attribute presence set in this version`; `!= is not part of the query language — write NOT (attr = value) for the complement`; `typeof(…) is not supported — a value predicate already asserts the attribute's type`. Because of F-009 the developer sees only `Query rejected (type, -32002): Requested resource not available.` `eq`, `gt`/`gte`/`lt`/`lte`, `and`, `or`, `not(eq(...))` and `startsWith` all work.
- **Reproduce:** `await client.query(and(eq("app", "x"), exists("score")).toString())`, same with `ne("a", "b")` and `hasType("score", "i32")`; step 3 of `pnpm spike` records all three (`exportedOperators`).
- **Suggested fix:** remove or mark the three builders until the node supports them; render `ne(a, b)` as `NOT a = b`.

## F-013 · The public RPC meters anonymous traffic, and a drained budget looks like a hang [runtime]

- **Surface:** RPC gateway, Access keys; SDK README; viem transport defaults
- **Version:** public Tiramisu RPC on 11 Oct, `viem@2.57.4`
- **Expected:** limits on the public endpoint are stated where a builder starts, and hitting one fails loudly. The SDK README has no mention of limits, quotas or keys. The docs site does have an [Access Keys page](https://docs.arkiv.network/start-here/access-keys/), which says a key "raises the rate limits" and that the RPC works without one "at the default rate limit", but not what that limit is, that it is counted per hour, or what a client receives when it is reached.
- **Actual:** two meters exist. Every response carries `ratelimit: limit=600, remaining=…, reset=…` (requests, about a minute). Every `arkiv_query` carries `arkiv-cost: 100` against an anonymous budget of 10,000, and when that is spent the gateway answers `HTTP 429 {"error":"ANON_COST_LIMITED","message":"unauthenticated query budget exhausted; get an API key at https://hub.arkiv.network for a monthly quota"}` with `retry-after: 8`. viem's `http()` transport retries a 429 three times and honours `Retry-After`, so each query stalled for about half a minute before failing and our spike sat for over ten minutes with no output. One full spike run is 45 queries (cost 4,500); two runs and a probe back to back drained the budget.
- **Measured again (12 Oct):** the budget is hourly. With it spent, the gateway answered `ratelimit: limit=10000, remaining=0, reset=2321` and `retry-after: 2321`: about 100 `arkiv_query` calls per hour per client address, and a wait of up to an hour once they are gone. viem's transport sleeps for exactly that `Retry-After` before its retry, so with retries on, the four verifiers `pnpm e2e` had just started printed nothing more, and no error, until we stopped them a minute later. The `reset=8` seen the day before is consistent with the same counter, eight seconds before its window ended.
- **Reproduce:** issue about 100 `arkiv_query` calls within an hour without a key (three `pnpm spike` runs, or a dozen page loads of the web app plus one `pnpm e2e`), then read the response headers of the next one with `curl -D -`.
- **Workaround:** every reader uses `arkivHttp()` from `packages/core/src/rpc.ts`: no retries, and a 429 becomes an `ArkivBudgetError` that carries the wait. The web app shows it as a sentence ("will answer again in about 38 minutes"), the verifier pauses its reads until then and keeps its heartbeat going. The app keeps queries per view small (five for a contract page) and updates from WebSocket events, which are not metered, instead of polling: the verifiers page follows heartbeats from `ExpiryExtended` events alone.
- **Suggested fix:** state the default limits, the `Arkiv-Cost` header and the 429 response on the Access Keys page and link it from the README, and have the SDK turn `ANON_COST_LIMITED` into a named error that carries `retryAfter`.
- **With an access key (13 Oct):** responses carry `ratelimit: limit=9999, remaining=…, reset=1` and `arkiv-quota-used-percent`; each `arkiv_query` still reports `arkiv-cost: 100` against the key's monthly quota. Four verifiers started together all connected over WebSocket.
- **A consequence for backend-less apps:** the same docs page says to keep a key out of the browser and call the RPC from a backend. An app whose point is that it has no backend therefore runs on the anonymous budget, per visitor. Arkify's web app does, and is built to fit in it; only the verifiers use a key.

## F-014 · A faucet claim looks lost until the wallet is switched to Tiramisu [runtime]

- **Surface:** Hub faucet (https://hub.arkiv.network/faucet)
- **Version:** Hub build `production · d5494dd`, MetaMask
- **Expected:** after a successful claim the builder sees the testnet GLM, and can fund the wallets an app actually runs with.
- **Actual:** the faucet asks to "sign in with your wallet" and paid 10 GLM to the connected browser wallet. The transfer succeeded on chain, yet the wallet showed nothing because it was not on the Tiramisu network, and the builder reported the tokens as not arrived. The five keys our scripts generate never touch a browser, so they were funded by a second hop: browser wallet to one script wallet, then `pnpm fund`.
- **Reproduce:** claim with a MetaMask that has never added chain 7738577 and look at the balance.
- **Suggested fix:** on success, show the transaction link and an "Add Tiramisu to wallet" button, and let the claimer name a recipient address so server-side keys can be funded directly.

## F-015 · A refused WebSocket handshake leaves `watchEntityEvents` silent for good [runtime]

- **Surface:** RPC gateway (WebSocket endpoint), SDK `watchEntityEvents`, viem `webSocket` transport
- **Version:** public Tiramisu RPC on 12 Oct, `@arkiv-network/sdk@0.8.1`, `viem@2.57.4`
- **Expected:** a subscription either works or fails in a way the app can recover from, and `reconnect` on the transport covers connection problems.
- **Actual:** the gateway caps concurrent WebSocket connections per client address. Six handshakes sent at once gave five `101 Switching Protocols` and one `HTTP 429 {"error":"WS_CONN_LIMIT","message":"too many concurrent websocket connections"}`. Starting four verifiers together on one machine, two were refused. In the app the refusal arrives once, through `onError`, as `Received network error or non-101 status code.` with no status or body. After that the watcher delivered nothing: with `reconnect: { attempts: 1000, delay: 2000 }` set on the transport, neither refused verifier received a single event in the next three minutes. Both ran on, heartbeat and all, and never saw the request the other two answered.
- **Reproduce:** run `for i in 1 2 3 4 5 6; do curl -s -m 4 --http1.1 -i -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' https://rpc.tiramisu.db-chain.testnet.arkiv.network | head -1 & done; wait`. Or open six `createPublicClient({ transport: webSocket() })` clients and call `watchEntityEvents` on each.
- **Workaround:** the verifier owns the connection (`packages/verifier/src/verifier.ts`): on `onError` it closes the client and subscribes again with exponential backoff, and because Tiramisu is never quiet, a minute without any event also triggers a reconnect. A request scan with every heartbeat catches whatever was missed. `pnpm e2e` shows a refused verifier reconnecting two seconds later and answering.
- **Suggested fix:** document the connection limit, pass the gateway's status and body through to `onError`, and have the watcher retry a failed first handshake when `reconnect` is set.

## F-016 · The Hub's access-key page fails with a blank error in Safari [runtime, seen once]

- **Surface:** Hub (https://hub.arkiv.network/access-keys)
- **Version:** Hub build `production · 7abc7fd`, Safari on macOS 26.6, 13 Oct
- **Expected:** without an injected wallet the page offers a way forward, as it does in a Chromium browser: there the same build shows "Connect your wallet" and a wallet picker (Rainbow, Base, MetaMask, WalletConnect).
- **Actual:** opened from a link, which the system sent to Safari (no wallet extension), the page showed only the Hub's error screen: "THIS PAGE COULDN'T LOAD. Reload to try again, or go back." Nothing says a wallet is missing or that another browser would work. The builder, who had created the key in Chrome minutes earlier, read it as the wallet refusing to connect.
- **Reproduce:** open the URL in Safari with no wallet extension and try to connect. We saw it once and did not investigate further; in Chrome with MetaMask, and in a Chromium browser without any wallet, the page works.
- **Suggested fix:** have the error screen name what failed, and when no wallet is detected say so and offer WalletConnect or "open in a browser with a wallet".

---

## Working paths (tested, behaved as documented)

W-001 to W-003 were tested on 11 Oct without a funded wallet. The rest come from `pnpm spike` (run `mv43abjc`, 11 Oct, 16/16 steps), whose full output with every transaction hash is in [`spike-run.json`](spike-run.json). Signers: requester `0xfEBd2309E6C92c1F924A42Dc78d0E8D95Ea666C0`, verifier-a `0xB5F160b92c066f9613fb05227744c604683cB590`.

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

### W-004 to W-013 · Write, query and lifecycle paths [runtime]

Each row is a spike step: what we expected from the SDK source, and what Tiramisu did.

| # | Surface | Tested | Result |
|---|---|---|---|
| W-004 | SDK `createEntity`, `getEntity` | Create with `str`, `u64`, `addr`, `bytes32`, `i32` and `bool` attributes and a JSON payload, then read back. | Every value and type round-trips; `creator` and `owner` are the signer. Tx `0x74670ee9f4e759600af0609f6f8bff7f514e1e3659d62cad17c72c2d699038b0`. |
| W-005 | SDK query builder, RPC | Eight predicates with `createdBy`: `run = str('mv43abjc') AND type = str('arkify.spike') AND chain_id = u64(11155111) AND address = addr(0xC02a…6Cc2) AND code_hash = bytes32(0x9b27…e92c) AND verified_at > u64(1791739187) AND verified_at < u64(1791739307) AND $creator = addr(0xfEBd…66C0)`. Also `createdBy(other)`, an `OR` over two `$creator` values, a `$expiresAt` range, a negative `i32` range, `not(eq)` and `startsWith`. | Exactly one result where expected and none for the wrong creator. The rendered text runs unchanged as a raw `arkiv_query`. |
| W-006 | SDK `limit`, `cursor`, `for await` | Five entities read with `limit(2)`. | Three pages, each entity once. Page order was `[1,4] [3,2] [0]`: there is no ordering, sort on the client. `limit(201)` is refused by the SDK. |
| W-007 | SDK `extendEntity` | Extend a 1-hour entity to "2 hours", then to "30 minutes". | The expiry is set from now, not added: it moved by 1,806 blocks. Shortening reverts with `already expires at block …, so extending it to … would shorten its life`. 25,210 gas. |
| W-008 | SDK `patchEntity` | Owner sets two attributes and unsets one; a stranger tries the same. | Attributes change, `updatedAt` moves, expiry and payload stay. The stranger gets `is owned by …, not …`. 55,320 gas. |
| W-009 | Creation flags | `readonly` + `permissionlessExtension` entity: stranger extends, stranger patches, owner patches, owner extends. Control: stranger extends an entity without the flag. | Stranger extension succeeds and does not change the owner (tx `0x759ba4a47f5596628cca999c812517e4109cd79fd84d59e50c001a03f23d93b1`); both patches revert (`not owner`, `was created readonly`); the control reverts. Exactly as documented. |
| W-010 | SDK `executeBatch`, `predictEntityKeys` | (a) Patch and extend one entity in one transaction. (b) Two creates where the second stores the first's predicted key as a `key` attribute. (c) A create plus a patch of a missing entity, sent with a fixed gas limit so it is really mined. | (a) One tx, 55,128 gas. (b) The predicted key equals the minted key and `source_key = key(…)` finds the second entity. (c) Tx `0xeca23fb1a33afa2df799736e892e31465fcbc343fab2f5ff2bbe173a74107b56` reverted and the create was not applied. |
| W-011 | SDK `watchEntityEvents`, WebSocket | Subscribe, then create an entity over HTTP. | The event arrived 3.3 s after sending and about 1 s before the receipt poll returned. |
| W-012 | SDK `changeOwnership` | Transfer to another wallet, then patch as old and new owner. | `$owner` moves, `$creator` does not. The old owner is refused, the new one succeeds; `createdBy(original)` still finds the entity and `ownedBy(original)` no longer does. |
| W-013 | Entity Expiration | Same 1,024-byte entity created for 1 hour, 180 days, 100 years and `permanent()`. Separately, a 3-block lifetime. | All four cost 116,768 gas: lifetime is free, so it can follow product logic alone. The 3-block entity (created at 444788, expiry 444791) was unreadable from block 444791 and gone from queries; its creation receipt is still served. |

### W-014 · Limits and costs measured [runtime]

- **Attributes:** 30 user attributes fit beside `$payload` and `$contentType` (32 cells), with a 32-byte name and a 128-byte `str` value; the SDK refuses a 33rd cell, a 33-byte name, a 129-byte string and reserved names before any request, each with a message that names the fix.
- **Payload:** 1,024, 32,768 and 122,880 bytes of random data read back intact in about 0.2 s. See F-011 for the ceiling.
- **Fees** at a 1 gwei base fee (1 GLM = 10^18 wei):

| Operation | Gas | Fee (GLM) |
|---|---|---|
| Create, 2 attributes, empty payload | 95,384 | 0.000095 |
| Create, 10 attributes, 46 B payload | 130,976 | 0.000131 |
| Create, 30 attributes | 230,496 | 0.000230 |
| Create, 1,024 B payload | 116,768 | 0.000117 |
| Create, 32,768 B payload | 1,347,750 | 0.001348 |
| Create, 122,880 B payload | 4,942,360 | 0.004942 |
| Batch of 5 small creates | 501,920 | 0.000502 |
| Batch of 2 linked creates | 196,168 | 0.000196 |
| Extend | 25,210 | 0.000025 |
| Patch (set 2, unset 1) | 55,320 | 0.000055 |
| Batch: patch + extend (heartbeat) | 55,128 | 0.000055 |
| Change ownership | 25,430 | 0.000025 |

A payload costs about 40 gas per byte. A verifier heartbeat every 5 minutes is about 0.016 GLM a day, so one 10 GLM faucet claim covers every wallet through judging.

