import { brotliCompressSync, brotliDecompressSync } from "node:zlib"
import type { CreateEntityParameters } from "@arkiv-network/sdk"
import { type Attributes, MAX_STRING_BYTES, toValue, validateAttributeName } from "@arkiv-network/sdk/attr"
import type { Address, Hex } from "viem"
import { describe, expect, it } from "vitest"
import {
  Attr,
  attestationDraft,
  type Compression,
  canonicalJson,
  contractNameOf,
  decodeAll,
  decodeAttestation,
  decodeRequest,
  decodeSource,
  decodeVerifier,
  type EntityLike,
  Flags,
  Lifetime,
  packSource,
  requestDraft,
  SourceHashMismatchError,
  SourceTooLargeError,
  type SourceBundle,
  sourceDraft,
  unpackSource,
  Verdict,
  verifierDraft,
} from "../src"

const SIGNER = "0xB5F160b92c066f9613fb05227744c604683cB590" as Address
const target = { chainId: 11155111n, address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" as Address }
const CODE = `0x${"c0".repeat(32)}` as Hex
const SOURCE = `0x${"11".repeat(32)}` as Hex
const SOURCE_KEY = `0x${"5e".repeat(32)}` as Hex

/** What the node would hand back for a draft: attributes resolved to typed values, plus metadata. */
function stored(draft: CreateEntityParameters, overrides: Partial<EntityLike> = {}): EntityLike {
  const attributes: Record<string, Attributes[string]> = {}
  for (const [name, value] of Object.entries(draft.attributes ?? {})) attributes[name] = toValue(value, name)
  return {
    key: `0x${"ab".repeat(32)}`,
    creator: SIGNER,
    owner: SIGNER,
    createdAt: 100n,
    expiresAt: 200n,
    attributes,
    payload: draft.payload,
    ...overrides,
  }
}

const brotli: Compression = {
  compress: (bytes) => brotliCompressSync(bytes),
  decompress: (bytes, maxBytes) => brotliDecompressSync(bytes, { maxOutputLength: maxBytes }),
}

const bundle: SourceBundle = {
  compilerVersion: "0.8.24+commit.e11b9ed9",
  contract: "contracts/Token.sol:Token",
  input: {
    language: "Solidity",
    sources: { "contracts/Token.sol": { content: "contract Token {}" } },
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
}

describe("attribute names", () => {
  it("are lowercase, which is all the engine accepts", () => {
    for (const name of Object.values(Attr)) {
      expect(name).toMatch(/^[a-z][a-z0-9._-]*$/)
      expect(() => validateAttributeName(name)).not.toThrow()
    }
  })
})

describe("drafts and decoders", () => {
  it("round-trips a verifier", () => {
    const draft = verifierDraft({ name: "verifier-a", engine: "evm-solcjs", engineVersion: "0.1.0", now: 1_700n })
    expect(draft.expires).toBe(Lifetime.verifierLease)
    expect(draft.flags).toBe(Flags.verifier)
    expect(decodeVerifier(stored(draft))).toMatchObject({
      creator: SIGNER,
      name: "verifier-a",
      engine: "evm-solcjs",
      engineVersion: "0.1.0",
      lastBeat: 1_700n,
    })
  })

  it("round-trips a request", () => {
    const draft = requestDraft({ ...target, sourceHash: SOURCE, sourceKey: SOURCE_KEY })
    expect(draft.flags).toEqual({ readonly: true, permissionlessExtension: true })
    expect(decodeRequest(stored(draft))).toMatchObject({ ...target, sourceHash: SOURCE, sourceKey: SOURCE_KEY })
  })

  it("round-trips a source", () => {
    const draft = sourceDraft({
      sourceHash: SOURCE,
      compilerVersion: bundle.compilerVersion,
      contractName: "Token",
      payload: new Uint8Array([1, 2, 3]),
    })
    expect(draft.expires).toBe(Lifetime.source)
    expect(decodeSource(stored(draft))).toMatchObject({
      sourceHash: SOURCE,
      compilerVersion: "0.8.24+commit.e11b9ed9",
      contractName: "Token",
    })
  })

  it("round-trips an attestation and gives failures a short life", () => {
    const input = {
      ...target,
      codeHash: CODE,
      sourceHash: SOURCE,
      sourceKey: SOURCE_KEY,
      verifiedAt: 1_800n,
      details: { engine: "evm-solcjs", engineVersion: "0.1.0", durationMs: 1200 },
    }
    const draft = attestationDraft({ ...input, verdict: Verdict.FullMatch })
    expect(draft.expires).toBe(Lifetime.attestation)
    expect(decodeAttestation(stored(draft))).toMatchObject({
      ...target,
      creator: SIGNER,
      codeHash: CODE,
      sourceHash: SOURCE,
      sourceKey: SOURCE_KEY,
      verdict: "full_match",
      verifiedAt: 1_800n,
    })
    expect(attestationDraft({ ...input, verdict: Verdict.Error }).expires).toBe(Lifetime.failedAttestation)
  })

  it("keeps every string attribute within the 128-byte limit for realistic values", () => {
    const draft = sourceDraft({
      sourceHash: SOURCE,
      compilerVersion: "0.8.24-nightly.2024.1.1+commit.e11b9ed9.Emscripten.clang",
      contractName: contractNameOf(`${"deep/".repeat(40)}Token.sol:Token`),
      payload: new Uint8Array(),
    })
    for (const value of Object.values(draft.attributes ?? {})) {
      if (typeof value === "string") expect(new TextEncoder().encode(value).length).toBeLessThanOrEqual(MAX_STRING_BYTES)
    }
  })

  it("drops entities that are not what their type says", () => {
    const good = stored(
      attestationDraft({
        ...target,
        codeHash: CODE,
        sourceHash: SOURCE,
        sourceKey: SOURCE_KEY,
        verdict: Verdict.Mismatch,
        verifiedAt: 1n,
        details: { engine: "x", engineVersion: "1", durationMs: 1 },
      }),
    )
    const attributes = good.attributes ?? {}
    const withAttributes = (changed: Attributes): EntityLike => ({ ...good, attributes: changed })
    const { verdict: _, ...withoutVerdict } = attributes
    const malformed: EntityLike[] = [
      withAttributes({ ...attributes, verdict: toValue("certainly_fine") }),
      withAttributes({ ...attributes, chain_id: toValue("11155111") }),
      withAttributes({ ...attributes, schema_version: toValue(2) }),
      withAttributes({ ...attributes, type: toValue("arkify.request") }),
      withAttributes(withoutVerdict),
      { ...good, creator: undefined },
      { ...good, attributes: undefined },
    ]
    for (const entity of malformed) expect(decodeAttestation(entity)).toBeUndefined()
    expect(decodeAll([good, ...malformed], decodeAttestation)).toHaveLength(1)
    expect(decodeVerifier(good)).toBeUndefined()
  })
})

describe("source bundles", () => {
  it("serialise canonically, so key order does not change the hash", async () => {
    const reordered: SourceBundle = {
      input: { settings: { optimizer: { runs: 200, enabled: true } }, sources: bundle.input.sources, language: "Solidity" },
      contract: bundle.contract,
      compilerVersion: bundle.compilerVersion,
    }
    expect(canonicalJson({ b: 1, a: [{ d: 1, c: null }] })).toBe('{"a":[{"c":null,"d":1}],"b":1}')
    expect((await packSource(reordered, brotli)).sourceHash).toBe((await packSource(bundle, brotli)).sourceHash)
  })

  it("round-trip through compression", async () => {
    const packed = await packSource(bundle, brotli)
    expect(packed.sourceHash).toMatch(/^0x[0-9a-f]{64}$/)
    expect(await unpackSource(packed.payload, packed.sourceHash, brotli)).toEqual(bundle)
  })

  it("refuse a payload stored under someone else's hash", async () => {
    const packed = await packSource(bundle, brotli)
    await expect(unpackSource(packed.payload, SOURCE, brotli)).rejects.toBeInstanceOf(SourceHashMismatchError)
  })

  it("refuse a bundle that stays too large after compression", async () => {
    const noise = Array.from({ length: 200_000 }, () => Math.random().toString(36).slice(2)).join("")
    const huge: SourceBundle = { ...bundle, input: { ...bundle.input, sources: { "A.sol": { content: noise } } } }
    await expect(packSource(huge, brotli)).rejects.toBeInstanceOf(SourceTooLargeError)
  })

  it("name the contract without its path", () => {
    expect(contractNameOf("contracts/Token.sol:Token")).toBe("Token")
    expect(contractNameOf("C:/weird/path.sol:Vault")).toBe("Vault")
  })
})
