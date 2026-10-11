// Source bundles: everything a verifier needs to rebuild a contract, stored content-addressed.
// `source_hash` on an entity is only a claim until the reader has decompressed the payload and
// hashed it again, which `unpackSource` always does.
import { type Hex, keccak256, stringToBytes } from "viem"
import { MAX_SOURCE_PAYLOAD_BYTES } from "./schema"

/** A solc standard-JSON input. Only the parts Arkify reads are typed. */
export type SolcInput = {
  language: string
  sources: Record<string, { content?: string }>
  settings?: Record<string, unknown>
}

export type SourceBundle = {
  /** Full solc version, e.g. `0.8.24+commit.e11b9ed9`. */
  compilerVersion: string
  /** The contract to compare, as `path/File.sol:Name`. */
  contract: string
  input: SolcInput
}

/** A decompressed bundle larger than this is refused, so a hostile payload cannot exhaust memory. */
export const MAX_SOURCE_BUNDLE_BYTES = 16 * 1024 * 1024

/**
 * Brotli, supplied by the platform: `node:zlib` in the verifier and CLI, a WASM build in the
 * browser. `decompress` must stop at `maxBytes` rather than trust the stream.
 */
export type Compression = {
  compress(bytes: Uint8Array): Uint8Array | Promise<Uint8Array>
  decompress(bytes: Uint8Array, maxBytes: number): Uint8Array | Promise<Uint8Array>
}

export class SourceTooLargeError extends Error {
  constructor(readonly payloadBytes: number) {
    super(
      `The compressed source bundle is ${payloadBytes} bytes; Arkify stores at most ` +
        `${MAX_SOURCE_PAYLOAD_BYTES} bytes per source entity.`,
    )
    this.name = "SourceTooLargeError"
  }
}

export class SourceHashMismatchError extends Error {
  constructor(
    readonly expected: Hex,
    readonly actual: Hex,
  ) {
    super(`The source payload hashes to ${actual}, not to the ${expected} it is stored under.`)
    this.name = "SourceHashMismatchError"
  }
}

export class InvalidSourceBundleError extends Error {
  constructor(reason: string) {
    super(`Not a source bundle: ${reason}`)
    this.name = "InvalidSourceBundleError"
  }
}

/** JSON with object keys sorted, so the same bundle always serialises to the same bytes. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null"
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  const entries = Object.entries(value)
    .filter(([, member]) => member !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([name, member]) => `${JSON.stringify(name)}:${canonicalJson(member)}`).join(",")}}`
}

export function serializeBundle(bundle: SourceBundle): Uint8Array {
  return stringToBytes(canonicalJson(bundle))
}

/** The contract's name without its path: `contracts/Token.sol:Token` gives `Token`. */
export function contractNameOf(contract: string): string {
  return contract.slice(contract.lastIndexOf(":") + 1)
}

export type PackedSource = {
  /** keccak256 of the uncompressed, canonical bundle. */
  sourceHash: Hex
  /** The entity payload: the bundle, brotli-compressed. */
  payload: Uint8Array
  bundleBytes: number
}

export async function packSource(bundle: SourceBundle, compression: Compression): Promise<PackedSource> {
  const bytes = serializeBundle(assertBundle(bundle))
  const payload = await compression.compress(bytes)
  if (payload.length > MAX_SOURCE_PAYLOAD_BYTES) throw new SourceTooLargeError(payload.length)
  return { sourceHash: keccak256(bytes), payload, bundleBytes: bytes.length }
}

/**
 * Decompresses a source payload and checks it against the hash it is stored under.
 *
 * @throws {SourceHashMismatchError} If the payload is not the content `sourceHash` names.
 * @throws {InvalidSourceBundleError} If the content is not a source bundle.
 */
export async function unpackSource(
  payload: Uint8Array,
  sourceHash: Hex,
  compression: Compression,
): Promise<SourceBundle> {
  const bytes = await compression.decompress(payload, MAX_SOURCE_BUNDLE_BYTES)
  const actual = keccak256(bytes)
  if (actual.toLowerCase() !== sourceHash.toLowerCase()) {
    throw new SourceHashMismatchError(sourceHash, actual)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new InvalidSourceBundleError("the content is not JSON")
  }
  return assertBundle(parsed)
}

function assertBundle(value: unknown): SourceBundle {
  const bundle = value as Partial<SourceBundle> | null
  if (typeof bundle !== "object" || bundle === null) {
    throw new InvalidSourceBundleError("expected an object")
  }
  if (typeof bundle.compilerVersion !== "string" || bundle.compilerVersion === "") {
    throw new InvalidSourceBundleError("compilerVersion is missing")
  }
  if (typeof bundle.contract !== "string" || !bundle.contract.includes(":")) {
    throw new InvalidSourceBundleError('contract must look like "path/File.sol:Name"')
  }
  const input = bundle.input
  if (typeof input !== "object" || input === null || typeof input.language !== "string") {
    throw new InvalidSourceBundleError("input is not a solc standard-JSON input")
  }
  if (typeof input.sources !== "object" || input.sources === null) {
    throw new InvalidSourceBundleError("input.sources is missing")
  }
  return bundle as SourceBundle
}
