// Recognising Arkify entities from `EntityCreated` events alone.
//
// The event carries no attributes (arkiv/friction.md, F-005), and a subscription sees every create
// on the chain. Reading each one back to learn its type would cost a query per foreign entity. But
// the event does carry the creation flags and the expiry, and each Arkify type is created with a
// fixed combination of the two, so anything with another shape can be dropped without a read.
import type { CreationFlags } from "@arkiv-network/sdk"
import { EntityType, Flags, Lifetime } from "./schema"

/** The part of an `EntityCreated` event the shape test reads. */
export type CreatedShape = {
  blockNumber: bigint
  expiresAt: bigint
  creationFlags: { readonly: boolean; permissionlessExtension: boolean }
}

const SHAPES: Record<EntityType, { flags: CreationFlags; lifetimes: bigint[] }> = {
  [EntityType.Verifier]: { flags: Flags.verifier, lifetimes: [Lifetime.verifierLease.minLifetime] },
  [EntityType.Request]: { flags: Flags.request, lifetimes: [Lifetime.request.minLifetime] },
  [EntityType.Source]: { flags: Flags.source, lifetimes: [Lifetime.source.minLifetime] },
  [EntityType.Attestation]: {
    flags: Flags.attestation,
    lifetimes: [Lifetime.attestation.minLifetime, Lifetime.failedAttestation.minLifetime],
  },
}

/**
 * Whether a newly created entity could be of the given Arkify type. `false` is certain for
 * entities written through `records.ts`; `true` only means it is worth reading the entity.
 */
export function mayBe(type: EntityType, event: CreatedShape): boolean {
  const { flags, lifetimes } = SHAPES[type]
  return (
    event.creationFlags.readonly === (flags.readonly ?? false) &&
    event.creationFlags.permissionlessExtension === (flags.permissionlessExtension ?? false) &&
    lifetimes.includes(event.expiresAt - event.blockNumber)
  )
}
