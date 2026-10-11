// Every query Arkify runs, in one place. The web app, the CLI and the verifier build their
// queries here, and arkiv/schema.md lists the text each one renders to.
//
// Only operators the Tiramisu node supports are used: `exists`, `ne` and `hasType` are exported by
// the SDK but rejected by the node (arkiv/friction.md, F-012).
import { addr, bytes32, i32, u64 } from "@arkiv-network/sdk/attr"
import { and, type Expression, eq, gt, not, or } from "@arkiv-network/sdk/query"
import type { Address, Hex } from "viem"
import type { Target } from "./records"
import { Attr, EntityType, SCHEMA_VERSION } from "./schema"

const ofType = (type: EntityType): Expression[] => [
  eq(Attr.type, type),
  eq(Attr.schemaVersion, i32(SCHEMA_VERSION)),
]

const forTarget = ({ chainId, address }: Target): Expression[] => [
  eq(Attr.chainId, u64(chainId)),
  eq(Attr.address, addr(address)),
]

/**
 * Entities signed by any of the given accounts.
 *
 * This is the trust filter. It tests `$creator`, which the chain sets and nobody can write, and it
 * runs on the node: entities from anyone else are never returned, so they cannot crowd a trusted
 * verifier out of a result page. `createdBy()` takes a single address, hence the `OR`.
 */
export function createdByAnyOf(creators: readonly Address[]): Expression {
  return or(creators.map((creator) => eq("$creator", addr(creator))))
}

/** All attestations about the code currently deployed at a contract address. */
export function attestationsFor(target: Target & { codeHash: Hex }): Expression {
  return and(
    ...ofType(EntityType.Attestation),
    ...forTarget(target),
    eq(Attr.codeHash, bytes32(target.codeHash)),
  )
}

/** The attestations a verdict is computed from: those signed by a trusted verifier. */
export function trustedAttestations(
  target: Target & { codeHash: Hex },
  trusted: readonly Address[],
): Expression {
  return and(attestationsFor(target), createdByAnyOf(trusted))
}

/** Attestations from everyone else. Shown in an "untrusted" section, never counted. */
export function otherAttestations(
  target: Target & { codeHash: Hex },
  trusted: readonly Address[],
): Expression {
  if (trusted.length === 0) return attestationsFor(target)
  return and(attestationsFor(target), not(createdByAnyOf(trusted)))
}

/**
 * One (code, source) pair. A verifier adds `.createdBy(self)` to find the attestation it already
 * wrote and extends that instead of writing a duplicate.
 */
export function attestationsOfSource(target: Target & { codeHash: Hex; sourceHash: Hex }): Expression {
  return and(attestationsFor(target), eq(Attr.sourceHash, bytes32(target.sourceHash)))
}

/** Attestations verified after a point in time (Unix seconds), for the live feed's first page. */
export function attestationsVerifiedSince(seconds: bigint): Expression {
  return and(...ofType(EntityType.Attestation), gt(Attr.verifiedAt, u64(seconds)))
}

/** Every verifier whose lease has not run out. An expired lease simply is not returned. */
export function verifiers(): Expression {
  return and(ofType(EntityType.Verifier))
}

/** Verifiers whose last heartbeat is newer than a point in time (Unix seconds). */
export function verifiersSeenSince(seconds: bigint): Expression {
  return and(...ofType(EntityType.Verifier), gt(Attr.lastBeat, u64(seconds)))
}

/** Every request that is still alive. A verifier scans these when it starts. */
export function requests(): Expression {
  return and(ofType(EntityType.Request))
}

export function requestsFor(target: Target): Expression {
  return and(...ofType(EntityType.Request), ...forTarget(target))
}

/**
 * Requests created after a block, for a verifier catching up after downtime.
 *
 * Returned as text for `client.query(text)`: the node filters on `$createdAt`, but the SDK's
 * builder refuses to (arkiv/friction.md, F-008).
 */
export function requestsCreatedAfter(block: bigint): string {
  return `${requests().toString()} AND $createdAt > u64(${block})`
}

/** Candidate copies of a source bundle. Each must still pass `unpackSource`. */
export function sourcesWithHash(sourceHash: Hex): Expression {
  return and(...ofType(EntityType.Source), eq(Attr.sourceHash, bytes32(sourceHash)))
}

/** Source entities for several hashes at once, so a page of attestations costs one source query. */
export function sourcesWithAnyHash(sourceHashes: readonly Hex[]): Expression {
  return and(
    ...ofType(EntityType.Source),
    or(sourceHashes.map((sourceHash) => eq(Attr.sourceHash, bytes32(sourceHash)))),
  )
}
