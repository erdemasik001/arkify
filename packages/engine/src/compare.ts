// Compares the runtime bytecode on chain with the runtime bytecode a compiler produced.
// Pure: no network, no compiler. Everything here is unit-tested with hand-built bytecode.
import { Verdict } from "@arkify/core"

/** A byte range inside runtime bytecode. */
export type Range = { start: number; length: number }

export type Comparison = {
  verdict: typeof Verdict.FullMatch | typeof Verdict.PartialMatch | typeof Verdict.Mismatch
  /** Why, when the verdict is not a full match. */
  message?: string
}

const PUSH20 = 0x73
/** The CBOR keys under which solc stores the hash of the metadata: "ipfs", "bzzr0", "bzzr1". */
const SOURCE_HASH_KEYS = ["6469706673", "65627a7a7230", "65627a7a7231"]
/** Every CBOR key that marks a trailer as solc's: the above and "solc". */
const METADATA_KEYS = [...SOURCE_HASH_KEYS, "64736f6c63"]

/**
 * Splits runtime bytecode into the executable body and solc's CBOR metadata trailer.
 *
 * The last two bytes give the trailer's length. Bytecode built without a trailer would be misread
 * by that rule alone, so the trailer must also look like one: a small CBOR map holding a key solc
 * writes. Otherwise the whole code is body.
 */
export function splitMetadata(code: Uint8Array): { body: Uint8Array; metadata: Uint8Array } {
  const whole = { body: code, metadata: new Uint8Array() }
  if (code.length < 2) return whole
  const length = ((code[code.length - 2] ?? 0) << 8) | (code[code.length - 1] ?? 0)
  const start = code.length - 2 - length
  if (length === 0 || start < 0) return whole
  const first = code[start] ?? 0
  if (first < 0xa1 || first > 0xa4) return whole
  const trailer = toHex(code.subarray(start, code.length - 2))
  if (!METADATA_KEYS.some((key) => trailer.includes(key))) return whole
  return { body: code.subarray(0, start), metadata: code.subarray(start) }
}

/**
 * Decides whether compiled runtime bytecode is the code on chain.
 *
 * Bytes that are legitimately set at deployment are zeroed on both sides first: immutables,
 * linked library addresses, and the address a library's call protection embeds in itself.
 *
 * - `full_match`: what remains is identical, including a metadata hash. That hash commits to every
 *   source file and setting, so the source is exactly what was deployed.
 * - `partial_match`: the executable code is identical but the source files are not proven, either
 *   because the metadata hash differs or because the contract was built without one.
 * - `mismatch`: the executable code differs.
 */
export function compareRuntime(
  onchain: Uint8Array,
  compiled: { code: Uint8Array; masks: readonly Range[] },
): Comparison {
  const a = Uint8Array.from(onchain)
  const b = Uint8Array.from(compiled.code)

  const masks = [...compiled.masks]
  if (b[0] === PUSH20 && a[0] === PUSH20 && isZero(b, 1, 20)) masks.push({ start: 1, length: 20 })
  for (const { start, length } of masks) {
    a.fill(0, start, start + length)
    b.fill(0, start, start + length)
  }

  if (equal(a, b)) {
    if (hasSourceHash(splitMetadata(b).metadata)) return { verdict: Verdict.FullMatch }
    return {
      verdict: Verdict.PartialMatch,
      message:
        "The bytecode is identical, but it was built without a metadata hash, so the exact source files are not proven.",
    }
  }

  const left = splitMetadata(a)
  const right = splitMetadata(b)
  if (left.metadata.length > 0 && right.metadata.length > 0 && equal(left.body, right.body)) {
    return {
      verdict: Verdict.PartialMatch,
      message: "The executable code matches; the metadata hash does not, so the exact source files are not proven.",
    }
  }

  const offset = firstDifference(left.body, right.body)
  return {
    verdict: Verdict.Mismatch,
    message:
      `Runtime bytecode differs at byte ${offset} ` +
      `(compiled ${right.body.length} bytes, on chain ${left.body.length} bytes, metadata excluded).`,
  }
}

function hasSourceHash(metadata: Uint8Array): boolean {
  const trailer = toHex(metadata)
  return SOURCE_HASH_KEYS.some((key) => trailer.includes(key))
}

function isZero(bytes: Uint8Array, start: number, length: number): boolean {
  if (bytes.length < start + length) return false
  for (let index = start; index < start + length; index++) if (bytes[index] !== 0) return false
  return true
}

function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) return false
  return true
}

function firstDifference(a: Uint8Array, b: Uint8Array): number {
  const shared = Math.min(a.length, b.length)
  for (let index = 0; index < shared; index++) if (a[index] !== b[index]) return index
  return shared
}

function toHex(bytes: Uint8Array): string {
  let out = ""
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0")
  return out
}
