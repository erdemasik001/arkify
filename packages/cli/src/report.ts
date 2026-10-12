// Turns an assessment into text for a terminal. Pure, so it is tested without a network.
import {
  type Assessment,
  type AttestationRecord,
  EVM_CHAINS,
  type EvmChainId,
  knownVerifierName,
  type SourceRecord,
  Status,
} from "@arkify/core"
import type { Address, Hex } from "viem"

export type Report = {
  chainId: EvmChainId
  address: Address
  codeHash: Hex
  codeSize: number
  trusted: readonly Address[]
  assessment: Assessment
  /** Source records by lowercased source hash, for names. */
  sources: ReadonlyMap<string, SourceRecord>
  /** The Arkiv query the trusted attestations came from. */
  query: string | undefined
  /** Unix seconds, for "ago". */
  now: bigint
}

const HEADLINE: Record<Status, string> = {
  [Status.Verified]: "VERIFIED",
  [Status.WeaklyVerified]: "WEAKLY VERIFIED",
  [Status.Disputed]: "DISPUTED",
  [Status.Mismatch]: "MISMATCH",
  [Status.Unverified]: "UNVERIFIED",
}

/** What a script should conclude: 0 verified, 2 disputed, 1 anything else. */
export function exitCodeFor(status: Status): number {
  if (status === Status.Verified) return 0
  return status === Status.Disputed ? 2 : 1
}

const short = (hex: string) => `${hex.slice(0, 8)}…${hex.slice(-4)}`

function ago(now: bigint, then: bigint): string {
  const seconds = Number(now - then)
  if (seconds < 90) return `${Math.max(0, seconds)} s ago`
  if (seconds < 90 * 60) return `${Math.round(seconds / 60)} min ago`
  if (seconds < 36 * 3600) return `${Math.round(seconds / 3600)} h ago`
  return `${Math.round(seconds / 86400)} days ago`
}

function line(now: bigint, attestation: AttestationRecord): string {
  const name = knownVerifierName(attestation.creator) ?? "(unnamed)"
  const note = attestation.details?.message === undefined ? "" : `\n      ${attestation.details.message}`
  return `    ${attestation.verdict.padEnd(14)}${name.padEnd(12)}${attestation.creator}  ${ago(now, attestation.verifiedAt)}${note}`
}

function summary({ assessment, trusted }: Report): string {
  const matches = assessment.decisive?.matches.length ?? 0
  const mismatches = assessment.decisive?.mismatches.length ?? 0
  switch (assessment.status) {
    case Status.Verified:
    case Status.WeaklyVerified:
      return `${matches} of ${trusted.length} trusted verifiers matched one source; verified needs ${assessment.threshold}.`
    case Status.Disputed:
      return `Trusted verifiers contradict each other about one source: ${matches} say it matches, ${mismatches} say it does not.`
    case Status.Mismatch:
      return `${mismatches} of ${trusted.length} trusted verifiers compiled the submitted source; it does not produce this code.`
    case Status.Unverified:
      return "No trusted verifier has attested to this code."
  }
}

export function renderReport(report: Report): string {
  const { assessment, now } = report
  const decisive = assessment.decisive
  const out: string[] = [
    `Contract   ${report.address} on ${EVM_CHAINS[report.chainId].name}`,
    `Code hash  ${report.codeHash} (${report.codeSize.toLocaleString("en")} bytes)`,
    "",
  ]
  if (report.codeSize === 0) {
    out.push("There is no contract code at this address, so there is nothing to verify.")
    return out.join("\n")
  }

  const kind = decisive?.match === undefined || assessment.status === Status.Disputed ? "" : `  (${decisive.match} match)`
  out.push(`${HEADLINE[assessment.status]}${kind}`)
  out.push(summary(report))

  for (const source of assessment.sources) {
    const record = report.sources.get(source.sourceHash.toLowerCase())
    const label = record === undefined ? "" : `  ${record.contractName}, solc ${record.compilerVersion}`
    out.push("", `Source ${short(source.sourceHash)}${label}  [${source.status}]`)
    for (const attestation of [...source.matches, ...source.mismatches, ...source.errors]) out.push(line(now, attestation))
  }
  if (assessment.untrusted.length > 0) {
    out.push("", "Not counted: signed by accounts outside the trusted list")
    for (const attestation of assessment.untrusted) out.push(line(now, attestation))
  }
  if (report.query !== undefined) {
    out.push("", "The Arkiv query behind this answer (send it to arkiv_query yourself):", `  ${report.query}`)
  }
  return out.join("\n")
}

/** The same answer for programs. Block heights and timestamps are decimal strings. */
export function renderJson(report: Report): string {
  const { sources: _, now: __, ...rest } = report
  return JSON.stringify(rest, (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value), 2)
}
