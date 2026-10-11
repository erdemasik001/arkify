// Turns attestations into one answer. Pure, so the web app, the CLI and the verifier agree.
//
// An attestation speaks about one (code, source) pair, so attestations are judged per source: a
// `mismatch` on source A does not contradict a `full_match` on source B. Two trusted verifiers
// disagreeing about the same source is a dispute, and a dispute outranks everything else.
import type { Address, Hex } from "viem"
import type { AttestationRecord } from "./records"
import { DEFAULT_THRESHOLD, Verdict } from "./schema"

export const Status = {
  /** Trusted verifiers contradict each other about the same source. */
  Disputed: "disputed",
  /** At least `threshold` trusted verifiers matched the same source. */
  Verified: "verified",
  /** Fewer than `threshold` trusted verifiers matched a source, and none objected. */
  WeaklyVerified: "weakly_verified",
  /** Trusted verifiers checked the submitted sources and none matched. */
  Mismatch: "mismatch",
  /** No trusted verifier has said anything about this code. */
  Unverified: "unverified",
} as const
export type Status = (typeof Status)[keyof typeof Status]

export type SourceAssessment = {
  sourceHash: Hex
  sourceKey: Hex
  status: Status
  /** How strong the match is, when there is one. `full` includes the metadata hash. */
  match: "full" | "partial" | undefined
  /** At most one attestation per verifier: its latest about this source. */
  matches: AttestationRecord[]
  mismatches: AttestationRecord[]
  errors: AttestationRecord[]
}

export type Assessment = {
  status: Status
  threshold: number
  /** The source that decided `status`. */
  decisive: SourceAssessment | undefined
  sources: SourceAssessment[]
  /** Attestations from accounts outside the trusted list. Reported, never counted. */
  untrusted: AttestationRecord[]
}

export type VerdictOptions = {
  /** Accounts whose attestations count, compared against each attestation's on-chain creator. */
  trusted: readonly Address[]
  threshold?: number
  /** When given, attestations about any other code are ignored. */
  codeHash?: Hex
}

const RANK: Record<Status, number> = {
  [Status.Disputed]: 0,
  [Status.Verified]: 1,
  [Status.WeaklyVerified]: 2,
  [Status.Mismatch]: 3,
  [Status.Unverified]: 4,
}

export function computeVerdict(
  attestations: readonly AttestationRecord[],
  options: VerdictOptions,
): Assessment {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD
  const trusted = new Set(options.trusted.map((address) => address.toLowerCase()))
  const codeHash = options.codeHash?.toLowerCase()

  const untrusted: AttestationRecord[] = []
  // source hash -> verifier -> that verifier's latest attestation about the source
  const bySource = new Map<string, Map<string, AttestationRecord>>()
  for (const attestation of attestations) {
    if (codeHash !== undefined && attestation.codeHash.toLowerCase() !== codeHash) continue
    const creator = attestation.creator.toLowerCase()
    if (!trusted.has(creator)) {
      untrusted.push(attestation)
      continue
    }
    const source = attestation.sourceHash.toLowerCase()
    const perVerifier = bySource.get(source) ?? new Map<string, AttestationRecord>()
    const previous = perVerifier.get(creator)
    if (previous === undefined || isNewer(attestation, previous)) perVerifier.set(creator, attestation)
    bySource.set(source, perVerifier)
  }

  const sources = [...bySource.values()]
    .map((perVerifier) => assessSource([...perVerifier.values()], threshold))
    .sort(
      (a, b) =>
        RANK[a.status] - RANK[b.status] ||
        Number(b.match === "full") - Number(a.match === "full") ||
        b.matches.length - a.matches.length ||
        (a.sourceHash < b.sourceHash ? -1 : 1),
    )
  const decisive = sources[0]?.status === Status.Unverified ? undefined : sources[0]
  return {
    status: decisive?.status ?? Status.Unverified,
    threshold,
    decisive,
    sources,
    untrusted,
  }
}

function isNewer(a: AttestationRecord, b: AttestationRecord): boolean {
  return a.verifiedAt !== b.verifiedAt ? a.verifiedAt > b.verifiedAt : a.createdAt > b.createdAt
}

function assessSource(latest: AttestationRecord[], threshold: number): SourceAssessment {
  const [first] = latest
  if (first === undefined) throw new Error("a source group cannot be empty")
  const matches = latest.filter(
    ({ verdict }) => verdict === Verdict.FullMatch || verdict === Verdict.PartialMatch,
  )
  const mismatches = latest.filter(({ verdict }) => verdict === Verdict.Mismatch)
  const errors = latest.filter(({ verdict }) => verdict === Verdict.Error)

  let status: Status = Status.Unverified
  if (matches.length > 0 && mismatches.length > 0) status = Status.Disputed
  else if (matches.length >= threshold) status = Status.Verified
  else if (matches.length > 0) status = Status.WeaklyVerified
  else if (mismatches.length > 0) status = Status.Mismatch

  // `full` needs as many full matches as the status itself needed matches.
  const full = matches.filter(({ verdict }) => verdict === Verdict.FullMatch).length
  const match =
    matches.length === 0 ? undefined : full >= Math.min(threshold, matches.length) ? "full" : "partial"

  return {
    sourceHash: first.sourceHash,
    sourceKey: first.sourceKey,
    status,
    match,
    matches,
    mismatches,
    errors,
  }
}
