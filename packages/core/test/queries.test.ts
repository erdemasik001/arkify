// The exact text of every query. arkiv/schema.md quotes these strings, so a change here is a
// change to the documented data contract.
import type { Address, Hex } from "viem"
import { describe, expect, it } from "vitest"
import {
  attestationsFor,
  attestationsOfSource,
  attestationsVerifiedSince,
  createdByAnyOf,
  otherAttestations,
  requests,
  requestsCreatedAfter,
  requestsFor,
  sourcesWithHash,
  trustedAttestations,
  verifiers,
  verifiersSeenSince,
} from "../src"

const A = "0xB5F160b92c066f9613fb05227744c604683cB590" as Address
const B = "0xcF73f570D2F15C5A814D0D9D63164c4f99012E0E" as Address
const CODE = `0x${"c0".repeat(32)}` as Hex
const SOURCE = `0x${"11".repeat(32)}` as Hex
const target = {
  chainId: 11155111n,
  address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" as Address,
  codeHash: CODE,
}
const ATTESTATIONS =
  "type = str('arkify.attestation') AND schema_version = i32(1) AND chain_id = u64(11155111) " +
  `AND address = addr(0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2) AND code_hash = bytes32(${CODE})`

describe("queries", () => {
  it("attestations for the code deployed at an address", () => {
    expect(attestationsFor(target).toString()).toBe(ATTESTATIONS)
  })

  it("filters trust on $creator, with an OR across the trusted list", () => {
    expect(createdByAnyOf([A]).toString()).toBe(`$creator = addr(${A})`)
    expect(trustedAttestations(target, [A, B]).toString()).toBe(
      `${ATTESTATIONS} AND ($creator = addr(${A}) OR $creator = addr(${B}))`,
    )
    expect(() => trustedAttestations(target, [])).toThrow()
  })

  it("everyone else's attestations are the complement of the trusted list", () => {
    expect(otherAttestations(target, [A, B]).toString()).toBe(
      `${ATTESTATIONS} AND NOT ($creator = addr(${A}) OR $creator = addr(${B}))`,
    )
    expect(otherAttestations(target, [A]).toString()).toBe(`${ATTESTATIONS} AND NOT $creator = addr(${A})`)
    expect(otherAttestations(target, []).toString()).toBe(ATTESTATIONS)
  })

  it("a single (code, source) pair", () => {
    expect(attestationsOfSource({ ...target, sourceHash: SOURCE }).toString()).toBe(
      `${ATTESTATIONS} AND source_hash = bytes32(${SOURCE})`,
    )
  })

  it("recent attestations by a numeric range", () => {
    expect(attestationsVerifiedSince(1791739187n).toString()).toBe(
      "type = str('arkify.attestation') AND schema_version = i32(1) AND verified_at > u64(1791739187)",
    )
  })

  it("verifiers, live and recently seen", () => {
    expect(verifiers().toString()).toBe("type = str('arkify.verifier') AND schema_version = i32(1)")
    expect(verifiersSeenSince(1791739187n).toString()).toBe(
      "type = str('arkify.verifier') AND schema_version = i32(1) AND last_beat > u64(1791739187)",
    )
  })

  it("requests, for one contract and since a block", () => {
    expect(requests().toString()).toBe("type = str('arkify.request') AND schema_version = i32(1)")
    expect(requestsFor(target).toString()).toBe(
      "type = str('arkify.request') AND schema_version = i32(1) AND chain_id = u64(11155111) " +
        "AND address = addr(0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2)",
    )
    expect(requestsCreatedAfter(444000n)).toBe(
      "type = str('arkify.request') AND schema_version = i32(1) AND $createdAt > u64(444000)",
    )
  })

  it("sources by content hash", () => {
    expect(sourcesWithHash(SOURCE).toString()).toBe(
      `type = str('arkify.source') AND schema_version = i32(1) AND source_hash = bytes32(${SOURCE})`,
    )
  })
})
