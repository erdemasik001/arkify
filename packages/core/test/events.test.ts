import { describe, expect, it } from "vitest"
import { EntityType, Flags, Lifetime, mayBe } from "../src"

const created = (lifetime: bigint, flags: { readonly?: boolean; permissionlessExtension?: boolean }) => ({
  blockNumber: 444_000n,
  expiresAt: 444_000n + lifetime,
  creationFlags: { readonly: flags.readonly ?? false, permissionlessExtension: flags.permissionlessExtension ?? false },
})

describe("mayBe", () => {
  it("recognises each Arkify type by the lifetime and flags it is created with", () => {
    expect(mayBe(EntityType.Request, created(Lifetime.request.minLifetime, Flags.request))).toBe(true)
    expect(mayBe(EntityType.Source, created(Lifetime.source.minLifetime, Flags.source))).toBe(true)
    expect(mayBe(EntityType.Verifier, created(Lifetime.verifierLease.minLifetime, Flags.verifier))).toBe(true)
    expect(mayBe(EntityType.Attestation, created(Lifetime.attestation.minLifetime, Flags.attestation))).toBe(true)
    expect(mayBe(EntityType.Attestation, created(Lifetime.failedAttestation.minLifetime, Flags.attestation))).toBe(true)
  })

  it("drops creates with another lifetime or other flags without a read", () => {
    expect(mayBe(EntityType.Request, created(Lifetime.request.minLifetime + 1n, Flags.request))).toBe(false)
    expect(mayBe(EntityType.Request, created(Lifetime.request.minLifetime, {}))).toBe(false)
    expect(mayBe(EntityType.Request, created(Lifetime.request.minLifetime, { readonly: true }))).toBe(false)
    expect(mayBe(EntityType.Request, created(Lifetime.source.minLifetime, Flags.source))).toBe(false)
    expect(mayBe(EntityType.Verifier, created(Lifetime.verifierLease.minLifetime, Flags.request))).toBe(false)
  })

  it("the lifetimes are the block counts the schema documents", () => {
    expect(Lifetime.verifierLease.minLifetime).toBe(450n) // 15 minutes
    expect(Lifetime.request.minLifetime).toBe(43_200n) // 24 hours
    expect(Lifetime.attestation.minLifetime).toBe(3_888_000n) // 90 days
    expect(Lifetime.source.minLifetime).toBe(7_776_000n) // 180 days
  })
})
