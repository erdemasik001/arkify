// The Arkify data contract: entity types, attribute names, lifetimes and creation flags.
// arkiv/schema.md is the prose version of this file; change them together.
import { type CreationFlags, ExpirationTime } from "@arkiv-network/sdk"

export const SCHEMA_VERSION = 1

export const EntityType = {
  Verifier: "arkify.verifier",
  Request: "arkify.request",
  Source: "arkify.source",
  Attestation: "arkify.attestation",
} as const
export type EntityType = (typeof EntityType)[keyof typeof EntityType]

// The engine only accepts lowercase attribute names (arkiv/friction.md, F-010).
export const Attr = {
  type: "type",
  schemaVersion: "schema_version",
  chainId: "chain_id",
  address: "address",
  codeHash: "code_hash",
  sourceHash: "source_hash",
  sourceKey: "source_key",
  verdict: "verdict",
  verifiedAt: "verified_at",
  name: "name",
  engine: "engine",
  engineVersion: "engine_version",
  lastBeat: "last_beat",
  compilerVersion: "compiler_version",
  contractName: "contract_name",
} as const

export const Verdict = {
  FullMatch: "full_match",
  PartialMatch: "partial_match",
  Mismatch: "mismatch",
  Error: "error",
} as const
export type Verdict = (typeof Verdict)[keyof typeof Verdict]

/** How often a verifier renews its lease, and how long the lease lasts: three missed beats. */
export const HEARTBEAT_SECONDS = 300

export const Lifetime = {
  /** Renewed by every heartbeat. A dead worker drops out of the registry by itself. */
  verifierLease: ExpirationTime.fromSeconds(HEARTBEAT_SECONDS * 3),
  /** An unanswered request should not linger; anyone may keep a stuck one alive. */
  request: ExpirationTime.fromHours(24),
  /** Sources outlive the attestations that point at them. */
  source: ExpirationTime.fromDays(180),
  /** Renewed whenever the same verifier re-checks the same code against the same source. */
  attestation: ExpirationTime.fromDays(90),
  /** A failed run says nothing lasting about the contract. */
  failedAttestation: ExpirationTime.fromHours(24),
} as const

const frozen: CreationFlags = { readonly: true, permissionlessExtension: true }

export const Flags = {
  /** Patched on every heartbeat, so neither flag. */
  verifier: {} as CreationFlags,
  request: frozen,
  source: frozen,
  attestation: frozen,
} as const

export const ContentType = {
  json: "application/json",
  /** A brotli-compressed source bundle. */
  source: "application/vnd.arkify.source+br",
} as const

/** The public RPC refuses bodies over ~256 KiB, which caps a payload near 129 KB (F-011). */
export const MAX_SOURCE_PAYLOAD_BYTES = 120 * 1024

export const DEFAULT_THRESHOLD = 2
