import { type AttestationRecord, computeVerdict, DEFAULT_TRUSTED_VERIFIERS, type SourceRecord, Status, Verdict } from "@arkify/core"
import type { Address, Hex } from "viem"
import { describe, expect, it } from "vitest"
import { exitCodeFor, type Report, renderJson, renderReport } from "../src/report"

const [A, B, C] = DEFAULT_TRUSTED_VERIFIERS as [Address, Address, Address]
const EVIL = "0x0288268E6dD0F64F97dE427527f0EADa636c33C3" as Address
const CODE = `0x${"c0".repeat(32)}` as Hex
const REAL = `0x${"11".repeat(32)}` as Hex
const FAKE = `0x${"22".repeat(32)}` as Hex
const NOW = 2_000_000n

let serial = 0n
function attestation(creator: Address, verdict: Verdict, sourceHash: Hex, message?: string): AttestationRecord {
  serial += 1n
  return {
    key: `0x${serial.toString(16).padStart(64, "0")}`,
    creator,
    owner: creator,
    createdAt: serial,
    expiresAt: serial + 1_000n,
    chainId: 11155111n,
    address: "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e",
    codeHash: CODE,
    sourceHash,
    sourceKey: sourceHash,
    verdict,
    verifiedAt: NOW - 3_600n,
    ...(message !== undefined && { details: { engine: "evm-solcjs", engineVersion: "0.1.0", durationMs: 1, message } }),
  }
}

function report(attestations: AttestationRecord[], trusted: readonly Address[] = DEFAULT_TRUSTED_VERIFIERS): Report {
  const source: SourceRecord = {
    key: REAL,
    creator: A,
    owner: A,
    createdAt: 1n,
    expiresAt: 2n,
    sourceHash: REAL,
    compilerVersion: "0.8.17+commit.8df45f5f",
    contractName: "ENSRegistryWithFallback",
  }
  return {
    chainId: "11155111",
    address: "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e",
    codeHash: CODE,
    codeSize: 3174,
    trusted,
    assessment: computeVerdict(attestations, { trusted, codeHash: CODE }),
    sources: new Map([[REAL.toLowerCase(), source]]),
    query: "type = str('arkify.attestation')",
    now: NOW,
  }
}

const honest = [
  attestation(A, Verdict.FullMatch, REAL),
  attestation(B, Verdict.FullMatch, REAL),
  attestation(C, Verdict.Mismatch, FAKE, "Runtime bytecode differs at byte 965."),
  attestation(EVIL, Verdict.FullMatch, FAKE),
]

describe("renderReport", () => {
  it("leads with the status and says how it was reached", () => {
    const text = renderReport(report(honest))
    expect(text).toContain("VERIFIED  (full match)")
    expect(text).toContain("2 of 3 trusted verifiers matched one source; verified needs 2.")
    expect(text).toContain("ENSRegistryWithFallback, solc 0.8.17+commit.8df45f5f  [verified]")
    expect(text).toContain("3,174 bytes")
  })

  it("names team verifiers, shows the engine's reason, and sets untrusted accounts apart", () => {
    const text = renderReport(report(honest))
    expect(text).toMatch(/full_match\s+verifier-a\s+0xB5F160b92c066f9613fb05227744c604683cB590\s+60 min ago/)
    expect(text).toContain("Runtime bytecode differs at byte 965.")
    const [counted, uncounted] = text.split("Not counted")
    expect(counted).not.toContain(EVIL)
    expect(uncounted).toContain(EVIL)
  })

  it("prints the query so the answer can be reproduced without this tool", () => {
    expect(renderReport(report(honest))).toContain("type = str('arkify.attestation')")
  })

  it("reports a dispute without calling either side a match", () => {
    const text = renderReport(report(honest, [...DEFAULT_TRUSTED_VERIFIERS, EVIL]))
    expect(text).toContain("DISPUTED\n")
    expect(text).not.toContain("DISPUTED  (")
    expect(text).toContain("contradict each other about one source: 1 say it matches, 1 say it does not.")
  })

  it("says so when there is no code or no attestation", () => {
    expect(renderReport({ ...report([]), codeSize: 0 })).toContain("no contract code at this address")
    expect(renderReport(report([]))).toContain("UNVERIFIED\nNo trusted verifier has attested to this code.")
  })
})

describe("renderJson", () => {
  it("is valid JSON with big numbers as strings", () => {
    const parsed = JSON.parse(renderJson(report(honest))) as { assessment: { status: string; sources: { matches: { verifiedAt: string }[] }[] } }
    expect(parsed.assessment.status).toBe("verified")
    expect(parsed.assessment.sources[0]?.matches[0]?.verifiedAt).toBe((NOW - 3_600n).toString())
  })
})

describe("exitCodeFor", () => {
  it("lets a script tell verified, disputed and everything else apart", () => {
    expect(exitCodeFor(Status.Verified)).toBe(0)
    expect(exitCodeFor(Status.Disputed)).toBe(2)
    for (const status of [Status.WeaklyVerified, Status.Mismatch, Status.Unverified]) expect(exitCodeFor(status)).toBe(1)
  })
})
