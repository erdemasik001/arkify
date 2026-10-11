import type { Address, Hex } from "viem"
import { describe, expect, it } from "vitest"
import { type AttestationRecord, computeVerdict, Status, Verdict } from "../src"

const A = "0x00000000000000000000000000000000000000aA" as Address
const B = "0x00000000000000000000000000000000000000bb" as Address
const C = "0x00000000000000000000000000000000000000cC" as Address
const EVIL = "0x000000000000000000000000000000000000e111" as Address
const CODE = `0x${"c0".repeat(32)}` as Hex
const OLD_CODE = `0x${"0d".repeat(32)}` as Hex
const REAL = `0x${"11".repeat(32)}` as Hex
const FAKE = `0x${"22".repeat(32)}` as Hex

let clock = 1_000n
function attestation(
  creator: Address,
  verdict: Verdict,
  sourceHash: Hex = REAL,
  overrides: Partial<AttestationRecord> = {},
): AttestationRecord {
  clock += 1n
  return {
    key: `0x${clock.toString(16).padStart(64, "0")}`,
    creator,
    owner: creator,
    createdAt: clock,
    expiresAt: clock + 1_000n,
    chainId: 11155111n,
    address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    codeHash: CODE,
    sourceHash,
    sourceKey: sourceHash,
    verdict,
    verifiedAt: clock,
    ...overrides,
  }
}

const trusted = [A, B, C]

describe("computeVerdict", () => {
  it("is unverified when nobody has said anything", () => {
    const result = computeVerdict([], { trusted })
    expect(result.status).toBe(Status.Unverified)
    expect(result.decisive).toBeUndefined()
    expect(result.threshold).toBe(2)
  })

  it("is verified once the threshold of distinct trusted verifiers match", () => {
    const result = computeVerdict(
      [attestation(A, Verdict.FullMatch), attestation(B, Verdict.FullMatch)],
      { trusted },
    )
    expect(result.status).toBe(Status.Verified)
    expect(result.decisive?.match).toBe("full")
    expect(result.decisive?.matches).toHaveLength(2)
  })

  it("reports a partial match when not enough verifiers saw a full one", () => {
    const result = computeVerdict(
      [attestation(A, Verdict.FullMatch), attestation(B, Verdict.PartialMatch)],
      { trusted },
    )
    expect(result.status).toBe(Status.Verified)
    expect(result.decisive?.match).toBe("partial")
  })

  it("is weakly verified below the threshold", () => {
    const result = computeVerdict([attestation(A, Verdict.FullMatch)], { trusted })
    expect(result.status).toBe(Status.WeaklyVerified)
    expect(result.decisive?.match).toBe("full")
  })

  it("does not let one verifier reach the threshold by attesting twice", () => {
    const result = computeVerdict(
      [attestation(A, Verdict.FullMatch), attestation(A, Verdict.FullMatch)],
      { trusted },
    )
    expect(result.status).toBe(Status.WeaklyVerified)
    expect(result.decisive?.matches).toHaveLength(1)
  })

  it("honours a custom threshold", () => {
    const one = [attestation(A, Verdict.FullMatch)]
    expect(computeVerdict(one, { trusted, threshold: 1 }).status).toBe(Status.Verified)
    const two = [...one, attestation(B, Verdict.FullMatch)]
    expect(computeVerdict(two, { trusted, threshold: 3 }).status).toBe(Status.WeaklyVerified)
  })

  it("is a mismatch when the submitted source matched for nobody", () => {
    const result = computeVerdict(
      [attestation(A, Verdict.Mismatch, FAKE), attestation(B, Verdict.Mismatch, FAKE)],
      { trusted },
    )
    expect(result.status).toBe(Status.Mismatch)
    expect(result.decisive?.match).toBeUndefined()
  })

  it("is disputed when trusted verifiers contradict each other about one source", () => {
    const result = computeVerdict(
      [
        attestation(A, Verdict.Mismatch, FAKE),
        attestation(B, Verdict.Mismatch, FAKE),
        attestation(EVIL, Verdict.FullMatch, FAKE),
      ],
      { trusted: [...trusted, EVIL] },
    )
    expect(result.status).toBe(Status.Disputed)
    expect(result.decisive?.matches.map(({ creator }) => creator)).toEqual([EVIL])
    expect(result.decisive?.mismatches).toHaveLength(2)
  })

  it("keeps a lying verifier out of the count while it is not trusted", () => {
    const result = computeVerdict(
      [
        attestation(A, Verdict.Mismatch, FAKE),
        attestation(B, Verdict.Mismatch, FAKE),
        attestation(EVIL, Verdict.FullMatch, FAKE),
      ],
      { trusted },
    )
    expect(result.status).toBe(Status.Mismatch)
    expect(result.untrusted.map(({ creator }) => creator)).toEqual([EVIL])
  })

  it("never counts untrusted attestations, however many there are", () => {
    const sybils = Array.from({ length: 50 }, (_, index) =>
      attestation(`0x${(index + 1).toString(16).padStart(40, "0")}` as Address, Verdict.FullMatch, FAKE),
    )
    const result = computeVerdict(sybils, { trusted })
    expect(result.status).toBe(Status.Unverified)
    expect(result.sources).toHaveLength(0)
    expect(result.untrusted).toHaveLength(50)
  })

  it("does not treat a mismatch on one source as a dispute about another", () => {
    const result = computeVerdict(
      [
        attestation(A, Verdict.FullMatch, REAL),
        attestation(B, Verdict.FullMatch, REAL),
        attestation(C, Verdict.Mismatch, FAKE),
      ],
      { trusted },
    )
    expect(result.status).toBe(Status.Verified)
    expect(result.decisive?.sourceHash).toBe(REAL)
    expect(result.sources.map(({ status }) => status)).toEqual([Status.Verified, Status.Mismatch])
  })

  it("lets a dispute about any source outrank a verified one", () => {
    const result = computeVerdict(
      [
        attestation(A, Verdict.FullMatch, REAL),
        attestation(B, Verdict.FullMatch, REAL),
        attestation(A, Verdict.Mismatch, FAKE),
        attestation(C, Verdict.FullMatch, FAKE),
      ],
      { trusted },
    )
    expect(result.status).toBe(Status.Disputed)
    expect(result.decisive?.sourceHash).toBe(FAKE)
  })

  it("uses a verifier's latest word about a source", () => {
    const earlier = attestation(A, Verdict.Mismatch)
    const later = attestation(A, Verdict.FullMatch)
    const result = computeVerdict([later, earlier, attestation(B, Verdict.FullMatch)], { trusted })
    expect(result.status).toBe(Status.Verified)
  })

  it("ignores errors when counting, but reports them", () => {
    const result = computeVerdict(
      [attestation(A, Verdict.Error), attestation(B, Verdict.FullMatch)],
      { trusted },
    )
    expect(result.status).toBe(Status.WeaklyVerified)
    expect(result.decisive?.errors).toHaveLength(1)

    const onlyErrors = computeVerdict([attestation(A, Verdict.Error)], { trusted })
    expect(onlyErrors.status).toBe(Status.Unverified)
    expect(onlyErrors.decisive).toBeUndefined()
    expect(onlyErrors.sources).toHaveLength(1)
  })

  it("ignores attestations about code that is no longer deployed", () => {
    const stale = [
      attestation(A, Verdict.FullMatch, REAL, { codeHash: OLD_CODE }),
      attestation(B, Verdict.FullMatch, REAL, { codeHash: OLD_CODE }),
    ]
    expect(computeVerdict(stale, { trusted, codeHash: CODE }).status).toBe(Status.Unverified)
    expect(computeVerdict(stale, { trusted, codeHash: OLD_CODE }).status).toBe(Status.Verified)
  })

  it("matches trusted addresses regardless of checksum casing", () => {
    const result = computeVerdict(
      [attestation(A, Verdict.FullMatch), attestation(B, Verdict.FullMatch)],
      { trusted: [A.toLowerCase() as Address, B.toUpperCase().replace("0X", "0x") as Address] },
    )
    expect(result.status).toBe(Status.Verified)
  })
})
