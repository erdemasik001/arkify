// Turns Arkify records into Arkiv create parameters and Arkiv entities back into records.
// Anyone can write an entity with our `type`, so decoding never trusts the shape: a malformed
// entity decodes to `undefined` instead of throwing. Who wrote it is a separate question, answered
// by `creator` (the on-chain `$creator`), never by an attribute.
import type { CreateEntityParameters } from "@arkiv-network/sdk"
import {
  type AnyArkivValue,
  type Attributes,
  addr,
  bytes32,
  i32,
  key,
  type TypeTag,
  u64,
} from "@arkiv-network/sdk/attr"
import { jsonToPayload } from "@arkiv-network/sdk/utils"
import { type Address, getAddress, type Hex, isAddress } from "viem"
import {
  Attr,
  ContentType,
  EntityType,
  Flags,
  Lifetime,
  SCHEMA_VERSION,
  Verdict,
} from "./schema"

/** The fields every query must select for a record to decode. */
export const RECORD_SELECTION = {
  key: true,
  owner: true,
  creator: true,
  createdAt: true,
  expiresAt: true,
  attributes: true,
} as const

/** What a decoder needs from an entity. Matches the result of `select(RECORD_SELECTION)`. */
export type EntityLike = {
  key?: Hex | undefined
  owner?: Hex | undefined
  creator?: Hex | undefined
  createdAt?: bigint | undefined
  expiresAt?: bigint | undefined
  attributes?: Attributes | undefined
  payload?: Uint8Array | undefined
}

/** A contract on an EVM chain. */
export type Target = { chainId: bigint; address: Address }

type Meta = {
  key: Hex
  /** The account that signed the create. Immutable; the only field trust is built on. */
  creator: Address
  owner: Address
  /** Block heights. */
  createdAt: bigint
  expiresAt: bigint
}

export type VerifierRecord = Meta & {
  name: string
  engine: string
  engineVersion: string
  /** Unix seconds of the last heartbeat. */
  lastBeat: bigint
}

export type RequestRecord = Meta & Target & { sourceHash: Hex; sourceKey: Hex }

export type SourceRecord = Meta & {
  sourceHash: Hex
  compilerVersion: string
  contractName: string
}

export type AttestationRecord = Meta &
  Target & {
    /** keccak256 of the runtime bytecode the verifier read from the chain. */
    codeHash: Hex
    sourceHash: Hex
    sourceKey: Hex
    verdict: Verdict
    /** Unix seconds. */
    verifiedAt: bigint
  }

/** The non-queryable part of an attestation, stored as its JSON payload. */
export type AttestationDetails = {
  engine: string
  engineVersion: string
  durationMs: number
  /** keccak256 of the bytecode the verifier compiled, after normalisation. */
  compiledCodeHash?: Hex
  /** Why the verdict is what it is, for `mismatch` and `error`. */
  message?: string
}

const typed = (type: EntityType) => ({ [Attr.type]: type, [Attr.schemaVersion]: i32(SCHEMA_VERSION) })

export function verifierDraft(input: {
  name: string
  engine: string
  engineVersion: string
  now: bigint
  description?: string
}): CreateEntityParameters {
  return {
    payload: jsonToPayload({ description: input.description ?? "" }),
    contentType: ContentType.json,
    attributes: {
      ...typed(EntityType.Verifier),
      [Attr.name]: input.name,
      [Attr.engine]: input.engine,
      [Attr.engineVersion]: input.engineVersion,
      [Attr.lastBeat]: u64(input.now),
    },
    expires: Lifetime.verifierLease,
    flags: Flags.verifier,
  }
}

/** The attribute a heartbeat patches, in the same batch that renews the lease. */
export function heartbeatAttributes(now: bigint) {
  return { [Attr.lastBeat]: u64(now) }
}

export function requestDraft(input: Target & { sourceHash: Hex; sourceKey: Hex }): CreateEntityParameters {
  return {
    payload: new Uint8Array(),
    contentType: "application/octet-stream",
    attributes: {
      ...typed(EntityType.Request),
      [Attr.chainId]: u64(input.chainId),
      [Attr.address]: addr(input.address),
      [Attr.sourceHash]: bytes32(input.sourceHash),
      [Attr.sourceKey]: key(input.sourceKey),
    },
    expires: Lifetime.request,
    flags: Flags.request,
  }
}

export function sourceDraft(input: {
  sourceHash: Hex
  compilerVersion: string
  contractName: string
  /** The compressed bundle from `packSource`. */
  payload: Uint8Array
}): CreateEntityParameters {
  return {
    payload: input.payload,
    contentType: ContentType.source,
    attributes: {
      ...typed(EntityType.Source),
      [Attr.sourceHash]: bytes32(input.sourceHash),
      [Attr.compilerVersion]: input.compilerVersion,
      [Attr.contractName]: input.contractName,
    },
    expires: Lifetime.source,
    flags: Flags.source,
  }
}

export function attestationDraft(
  input: Target & {
    codeHash: Hex
    sourceHash: Hex
    sourceKey: Hex
    verdict: Verdict
    verifiedAt: bigint
    details: AttestationDetails
  },
): CreateEntityParameters {
  return {
    payload: jsonToPayload(input.details),
    contentType: ContentType.json,
    attributes: {
      ...typed(EntityType.Attestation),
      [Attr.chainId]: u64(input.chainId),
      [Attr.address]: addr(input.address),
      [Attr.codeHash]: bytes32(input.codeHash),
      [Attr.sourceHash]: bytes32(input.sourceHash),
      [Attr.sourceKey]: key(input.sourceKey),
      [Attr.verdict]: input.verdict,
      [Attr.verifiedAt]: u64(input.verifiedAt),
    },
    expires: input.verdict === Verdict.Error ? Lifetime.failedAttestation : Lifetime.attestation,
    flags: Flags.attestation,
  }
}

type ValueTypes = { [value in AnyArkivValue as value["type"]]: value["value"] }

/** Reads attributes by name and expected type; a wrong type reads as absent. */
function reader(attributes: Attributes | undefined) {
  return <tag extends TypeTag>(name: string, tag: tag): ValueTypes[tag] | undefined => {
    const value = attributes?.[name]
    return value?.type === tag ? (value.value as ValueTypes[tag]) : undefined
  }
}

function metaOf(entity: EntityLike, type: EntityType): Meta | undefined {
  const read = reader(entity.attributes)
  if (read(Attr.type, "str") !== type || read(Attr.schemaVersion, "i32") !== SCHEMA_VERSION) {
    return undefined
  }
  const { key: entityKey, creator, owner, createdAt, expiresAt } = entity
  if (entityKey === undefined || createdAt === undefined || expiresAt === undefined) return undefined
  if (creator === undefined || owner === undefined || !isAddress(creator) || !isAddress(owner)) {
    return undefined
  }
  return { key: entityKey, creator: getAddress(creator), owner: getAddress(owner), createdAt, expiresAt }
}

function targetOf(read: ReturnType<typeof reader>): Target | undefined {
  const chainId = read(Attr.chainId, "u64")
  const address = read(Attr.address, "addr")
  if (chainId === undefined || address === undefined) return undefined
  return { chainId, address: getAddress(address) }
}

export function decodeVerifier(entity: EntityLike): VerifierRecord | undefined {
  const meta = metaOf(entity, EntityType.Verifier)
  const read = reader(entity.attributes)
  const name = read(Attr.name, "str")
  const engine = read(Attr.engine, "str")
  const engineVersion = read(Attr.engineVersion, "str")
  const lastBeat = read(Attr.lastBeat, "u64")
  if (!meta || name === undefined || engine === undefined) return undefined
  if (engineVersion === undefined || lastBeat === undefined) return undefined
  return { ...meta, name, engine, engineVersion, lastBeat }
}

export function decodeRequest(entity: EntityLike): RequestRecord | undefined {
  const meta = metaOf(entity, EntityType.Request)
  const read = reader(entity.attributes)
  const target = targetOf(read)
  const sourceHash = read(Attr.sourceHash, "bytes32")
  const sourceKey = read(Attr.sourceKey, "key")
  if (!meta || !target || sourceHash === undefined || sourceKey === undefined) return undefined
  return { ...meta, ...target, sourceHash, sourceKey }
}

export function decodeSource(entity: EntityLike): SourceRecord | undefined {
  const meta = metaOf(entity, EntityType.Source)
  const read = reader(entity.attributes)
  const sourceHash = read(Attr.sourceHash, "bytes32")
  const compilerVersion = read(Attr.compilerVersion, "str")
  const contractName = read(Attr.contractName, "str")
  if (!meta || sourceHash === undefined) return undefined
  if (compilerVersion === undefined || contractName === undefined) return undefined
  return { ...meta, sourceHash, compilerVersion, contractName }
}

const VERDICTS: ReadonlySet<string> = new Set(Object.values(Verdict))

export function decodeAttestation(entity: EntityLike): AttestationRecord | undefined {
  const meta = metaOf(entity, EntityType.Attestation)
  const read = reader(entity.attributes)
  const target = targetOf(read)
  const codeHash = read(Attr.codeHash, "bytes32")
  const sourceHash = read(Attr.sourceHash, "bytes32")
  const sourceKey = read(Attr.sourceKey, "key")
  const verdict = read(Attr.verdict, "str")
  const verifiedAt = read(Attr.verifiedAt, "u64")
  if (!meta || !target || codeHash === undefined || sourceHash === undefined) return undefined
  if (sourceKey === undefined || verifiedAt === undefined) return undefined
  if (verdict === undefined || !VERDICTS.has(verdict)) return undefined
  return { ...meta, ...target, codeHash, sourceHash, sourceKey, verdict: verdict as Verdict, verifiedAt }
}

/** Decodes every well-formed entity and silently drops the rest. */
export function decodeAll<T>(entities: readonly EntityLike[], decode: (entity: EntityLike) => T | undefined): T[] {
  return entities.map(decode).filter((record): record is T => record !== undefined)
}
