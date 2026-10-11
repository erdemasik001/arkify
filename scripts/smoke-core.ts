// Checks packages/core against Tiramisu: writes one of each Arkify entity, runs every query the
// app uses, decodes the results and computes a verdict. Entities live for ten minutes and describe
// a contract address and code hash that do not exist, so real lookups never see them.
//
//   pnpm smoke
import { brotliCompressSync, brotliDecompressSync } from "node:zlib"
import {
  attestationDraft,
  attestationsOfSource,
  attestationsVerifiedSince,
  type Compression,
  canonicalJson,
  computeVerdict,
  contractNameOf,
  decodeAll,
  decodeAttestation,
  decodeRequest,
  decodeSource,
  decodeVerifier,
  heartbeatAttributes,
  Lifetime,
  otherAttestations,
  packSource,
  RECORD_SELECTION,
  requestDraft,
  requestsCreatedAfter,
  requestsFor,
  type SourceBundle,
  Status,
  sourceDraft,
  sourcesWithHash,
  trustedAttestations,
  unpackSource,
  Verdict,
  verifierDraft,
  verifiersSeenSince,
} from "@arkify/core"
import { createPublicClient, createWalletClient, ExpirationTime } from "@arkiv-network/sdk"
import { tiramisu } from "@arkiv-network/sdk/chains"
import { http, keccak256, toHex } from "viem"
import { accountFromEnv, rpcUrl } from "./env"

const brotli: Compression = {
  compress: (bytes) => brotliCompressSync(bytes),
  decompress: (bytes, maxBytes) => brotliDecompressSync(bytes, { maxOutputLength: maxBytes }),
}

const pub = createPublicClient({ chain: tiramisu, transport: http(rpcUrl, { retryCount: 0 }) })
const wallet = (name: string) =>
  createWalletClient({
    chain: tiramisu,
    transport: http(rpcUrl),
    account: accountFromEnv(name),
    pollingInterval: 1_000,
  })
const alice = wallet("REQUESTER_PRIVATE_KEY")
const bob = wallet("VERIFIER_A_PRIVATE_KEY")
const A = alice.account.address
const B = bob.account.address

const shortLived = ExpirationTime.fromMinutes(10)
const run = Date.now().toString(36)
const now = () => BigInt(Math.floor(Date.now() / 1000))
const target = {
  chainId: 11155111n,
  address: "0x000000000000000000000000000000000000dEaD",
  codeHash: keccak256(toHex(`arkify-smoke-code-${run}`)),
} as const

let passed = 0
function check(condition: boolean, what: string): void {
  if (!condition) throw new Error(`FAILED: ${what}`)
  passed++
  console.log(`ok  ${what}`)
}

const startBlock = await pub.getBlockNumber()
const startedAt = now()

// Source and request land together: the request names the source by a key predicted beforehand.
const bundle: SourceBundle = {
  compilerVersion: "0.8.24+commit.e11b9ed9",
  contract: "contracts/Smoke.sol:Smoke",
  input: {
    language: "Solidity",
    sources: { "contracts/Smoke.sol": { content: `// ${run}\ncontract Smoke {}` } },
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
}
const packed = await packSource(bundle, brotli)
const [predicted] = await pub.predictEntityKeys({ owner: A, count: 1 })
const submitted = await alice.executeBatch({
  creates: [
    {
      ...sourceDraft({
        sourceHash: packed.sourceHash,
        compilerVersion: bundle.compilerVersion,
        contractName: contractNameOf(bundle.contract),
        payload: packed.payload,
      }),
      salt: predicted.salt,
      expires: shortLived,
    },
    {
      ...requestDraft({ ...target, sourceHash: packed.sourceHash, sourceKey: predicted.key }),
      expires: shortLived,
    },
  ],
})
check(submitted.createdEntities[0] === predicted.key, "source and request created in one batch")

const registered = await alice.createEntity(
  verifierDraft({ name: `smoke-${run}`, engine: "evm-solcjs", engineVersion: "0.0.0", now: startedAt }),
)
await alice.executeBatch({
  patches: [{ entityKey: registered.entityKey, set: heartbeatAttributes(now()) }],
  extensions: [{ entityKey: registered.entityKey, expires: Lifetime.verifierLease }],
})

const attest = (verdict: Verdict) => ({
  ...attestationDraft({
    ...target,
    sourceHash: packed.sourceHash,
    sourceKey: predicted.key,
    verdict,
    verifiedAt: now(),
    details: { engine: "evm-solcjs", engineVersion: "0.0.0", durationMs: 0, message: "smoke test" },
  }),
  expires: shortLived,
})
await alice.createEntity(attest(Verdict.FullMatch))
await bob.createEntity(attest(Verdict.Mismatch))
console.log("wrote: source, request, verifier (+heartbeat), two attestations\n")

const sources = await pub
  .select({ ...RECORD_SELECTION, payload: true })
  .where(sourcesWithHash(packed.sourceHash))
  .fetch()
const [source] = decodeAll(sources.entities, decodeSource)
check(source?.key === predicted.key && source.contractName === "Smoke", "source found by hash and decoded")
const [sourceEntity] = sources.entities
if (sourceEntity === undefined) throw new Error("no source entity")
const unpacked = await unpackSource(sourceEntity.payload, packed.sourceHash, brotli)
check(canonicalJson(unpacked) === canonicalJson(bundle), "source payload decompresses to the bundle it was hashed from")

const forTarget = await pub.select(RECORD_SELECTION).where(requestsFor(target)).fetch()
const mine = decodeAll(forTarget.entities, decodeRequest).filter(({ sourceKey }) => sourceKey === predicted.key)
check(mine.length === 1 && mine[0]?.creator === A, "request found by contract and decoded")
const since = await pub.query(requestsCreatedAfter(startBlock), { select: RECORD_SELECTION })
check(
  decodeAll(since.entities, decodeRequest).some(({ sourceKey }) => sourceKey === predicted.key),
  "request found by $createdAt range",
)

const seen = await pub.select(RECORD_SELECTION).where(verifiersSeenSince(startedAt - 1n)).createdBy(A).fetch()
const [verifier] = decodeAll(seen.entities, decodeVerifier)
check(verifier?.name === `smoke-${run}` && verifier.lastBeat >= startedAt, "verifier found by heartbeat range, lease renewed")

const trustingAlice = await pub.select(RECORD_SELECTION).where(trustedAttestations(target, [A])).fetch()
const others = await pub.select(RECORD_SELECTION).where(otherAttestations(target, [A])).fetch()
check(
  trustingAlice.entities.length === 1 && trustingAlice.entities[0]?.creator === A,
  "trusted query returns only the trusted creator's attestation",
)
check(others.entities.length === 1 && others.entities[0]?.creator === B, "complement query returns the rest")

const own = await pub
  .select(RECORD_SELECTION)
  .where(attestationsOfSource({ ...target, sourceHash: packed.sourceHash }))
  .createdBy(B)
  .fetch()
check(decodeAll(own.entities, decodeAttestation)[0]?.verdict === Verdict.Mismatch, "a verifier finds its own attestation with createdBy")

const recent = await pub.select(RECORD_SELECTION).where(attestationsVerifiedSince(startedAt - 1n)).fetch()
check(
  decodeAll(recent.entities, decodeAttestation).filter(({ codeHash }) => codeHash === target.codeHash).length === 2,
  "recent attestations found by verified_at range",
)

const both = await pub.select(RECORD_SELECTION).where(trustedAttestations(target, [A, B])).fetch()
const records = decodeAll(both.entities, decodeAttestation)
check(computeVerdict(records, { trusted: [A, B] }).status === Status.Disputed, "trusting both verifiers: disputed")
const onlyAlice = computeVerdict(records, { trusted: [A] })
check(
  onlyAlice.status === Status.WeaklyVerified && onlyAlice.untrusted.length === 1,
  "trusting one verifier: weakly verified, the other reported as untrusted",
)

console.log(`\n${passed} checks passed against Tiramisu.`)
