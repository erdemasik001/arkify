import { describe, expect, it } from "vitest"
import { compareRuntime, splitMetadata } from "../src"

const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0))
const withLength = (cbor: number[]) => [...cbor, cbor.length >> 8, cbor.length & 0xff]

/** solc's trailer: { "ipfs": <34-byte multihash>, "solc": <3-byte version> }, then its length. */
const trailer = (seed: number) =>
  withLength([
    0xa2, 0x64, ...ascii("ipfs"), 0x58, 0x22, 0x12, 0x20, ...Array<number>(32).fill(seed),
    0x64, ...ascii("solc"), 0x43, 0x00, 0x08, 0x18,
  ])
/** The trailer of a build with `bytecodeHash: "none"`: the compiler version only. */
const versionOnlyTrailer = withLength([0xa1, 0x64, ...ascii("solc"), 0x43, 0x00, 0x08, 0x18])

const BODY = [0x60, 0x80, 0x60, 0x40, 0x52, 0x34, 0x80, 0x15, 0x61, 0x00, 0x10, 0x57, 0x60, 0x00, 0x80, 0xfd]
const code = (body: number[], tail: number[] = trailer(1)) => Uint8Array.from([...body, ...tail])
const compiled = (bytes: Uint8Array, masks: { start: number; length: number }[] = []) => ({ code: bytes, masks })

describe("splitMetadata", () => {
  it("separates solc's CBOR trailer from the executable body", () => {
    const { body, metadata } = splitMetadata(code(BODY))
    expect([...body]).toEqual(BODY)
    expect(metadata.length).toBe(trailer(1).length)
  })

  it("treats code without a recognisable trailer as all body", () => {
    expect(splitMetadata(Uint8Array.from(BODY)).metadata.length).toBe(0)
    // The last two bytes read as a plausible length, but what precedes them is not solc's CBOR.
    const lookalike = Uint8Array.from([...BODY, ...Array<number>(8).fill(0x5b), 0x00, 0x08])
    expect(splitMetadata(lookalike).metadata.length).toBe(0)
    expect(splitMetadata(new Uint8Array()).metadata.length).toBe(0)
  })
})

describe("compareRuntime", () => {
  it("is a full match when everything is identical, metadata hash included", () => {
    expect(compareRuntime(code(BODY), compiled(code(BODY)))).toEqual({ verdict: "full_match" })
  })

  it("is a partial match when only the metadata hash differs", () => {
    const result = compareRuntime(code(BODY, trailer(1)), compiled(code(BODY, trailer(2))))
    expect(result.verdict).toBe("partial_match")
  })

  it("is only a partial match when identical bytecode carries no metadata hash", () => {
    const hashless = code(BODY, versionOnlyTrailer)
    expect(compareRuntime(hashless, compiled(hashless)).verdict).toBe("partial_match")
    const bare = Uint8Array.from(BODY)
    expect(compareRuntime(bare, compiled(bare)).verdict).toBe("partial_match")
  })

  it("is a mismatch when the executable code differs, and says where", () => {
    const changed = [...BODY]
    changed[5] = 0x35
    const result = compareRuntime(code(BODY), compiled(code(changed)))
    expect(result.verdict).toBe("mismatch")
    expect(result.message).toContain("differs at byte 5")
  })

  it("is a mismatch when the code is a different length", () => {
    expect(compareRuntime(code(BODY), compiled(code([...BODY, 0x00]))).verdict).toBe("mismatch")
    expect(compareRuntime(code(BODY), compiled(new Uint8Array())).verdict).toBe("mismatch")
  })

  it("does not call a difference at the end of trailer-less code a metadata difference", () => {
    const a = Uint8Array.from([...BODY, ...Array<number>(8).fill(0x5b), 0x00, 0x08])
    const b = Uint8Array.from([...BODY, ...Array<number>(8).fill(0x5c), 0x00, 0x08])
    expect(compareRuntime(a, compiled(b)).verdict).toBe("mismatch")
  })

  it("ignores immutables and linked library addresses, which are set at deployment", () => {
    const blank = [...BODY]
    const deployed = [...BODY]
    for (let index = 4; index < 12; index++) {
      blank[index] = 0
      deployed[index] = 0xee
    }
    const masks = [
      { start: 4, length: 4 },
      { start: 8, length: 4 },
    ]
    expect(compareRuntime(code(deployed), compiled(code(blank), masks)).verdict).toBe("full_match")
    expect(compareRuntime(code(deployed), compiled(code(blank))).verdict).toBe("mismatch")
    expect(compareRuntime(code(deployed, trailer(2)), compiled(code(blank), masks)).verdict).toBe("partial_match")
  })

  it("does not let a mask hide a difference outside its range", () => {
    const deployed = [...BODY]
    deployed[4] = 0xee
    deployed[12] = 0xee
    expect(compareRuntime(code(deployed), compiled(code(BODY), [{ start: 4, length: 1 }])).verdict).toBe("mismatch")
  })

  it("ignores the address a library embeds in its own call protection", () => {
    const rest = [0x30, 0x14, 0x60, 0x80]
    const blank = code([0x73, ...Array<number>(20).fill(0), ...rest])
    const deployed = code([0x73, ...Array<number>(20).fill(0xab), ...rest])
    expect(compareRuntime(deployed, compiled(blank)).verdict).toBe("full_match")
    // A real PUSH20 of a non-zero constant is ordinary code and must still be compared.
    const constant = code([0x73, ...Array<number>(20).fill(0x11), ...rest])
    expect(compareRuntime(deployed, compiled(constant)).verdict).toBe("mismatch")
  })

  it("leaves its inputs untouched", () => {
    const onchain = code([...BODY.slice(0, 4), 0xee, ...BODY.slice(5)])
    const before = [...onchain]
    compareRuntime(onchain, compiled(code(BODY), [{ start: 4, length: 1 }]))
    expect([...onchain]).toEqual(before)
  })
})
