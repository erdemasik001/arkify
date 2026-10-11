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

---

## Working paths (tested, behaved as documented)

_Filled in during the Phase 0 spike._
