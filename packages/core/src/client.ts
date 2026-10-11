// The reads and writes every Arkify client shares, on top of the SDK's clients.
// Nothing here talks to an Arkify server: there is none. It is Arkiv, plus local decoding.
import type { PublicArkivClient, WalletArkivClient } from "@arkiv-network/sdk"
import type { Expression } from "@arkiv-network/sdk/query"
import type { Address, Hash, Hex } from "viem"
import { otherAttestations, sourcesWithHash, trustedAttestations } from "./queries"
import {
  type AttestationRecord,
  decodeAll,
  decodeAttestation,
  decodeSource,
  type EntityLike,
  RECORD_SELECTION,
  requestDraft,
  type SourceRecord,
  sourceDraft,
  type Target,
} from "./records"
import {
  type Compression,
  contractNameOf,
  packSource,
  type SourceBundle,
  unpackSource,
} from "./source"

/** Any SDK public client; only its entity reads are used. */
export type Reader = Pick<PublicArkivClient, "select" | "predictEntityKeys">
/** Any SDK wallet client with an account. */
export type Writer = Pick<WalletArkivClient, "executeBatch"> & { account: { address: Address } }

/** Upper bound on entities read for one question, so a flood of entities cannot stall a client. */
const MAX_ENTITIES = 1_000

/** Reads every page of a query with the fields records decode from, and optionally the payloads. */
export async function readAll(
  reader: Reader,
  where: Expression,
  options: { creator?: Address; payload?: boolean } = {},
): Promise<EntityLike[]> {
  const builder = reader
    .select({ ...RECORD_SELECTION, payload: options.payload === true })
    .where(where)
    .limit(200)
  if (options.creator !== undefined) builder.createdBy(options.creator)
  const entities: EntityLike[] = []
  for await (const entity of builder) {
    entities.push(entity)
    if (entities.length >= MAX_ENTITIES) break
  }
  return entities
}

export type FoundSource = {
  record: SourceRecord
  bundle: SourceBundle
  /** The compressed payload as stored, for re-publishing a copy. */
  payload: Uint8Array
}

/**
 * Finds a copy of a source bundle whose content really hashes to `sourceHash`.
 *
 * Copies are content-addressed and anyone can publish one, so every candidate is decompressed and
 * re-hashed; a copy that fails is skipped, not trusted. `preferredKey` is tried first.
 */
export async function findSource(
  reader: Reader,
  sourceHash: Hex,
  compression: Compression,
  preferredKey?: Hex,
): Promise<FoundSource | undefined> {
  const page = await reader
    .select({ ...RECORD_SELECTION, payload: true })
    .where(sourcesWithHash(sourceHash))
    .limit(20)
    .fetch()
  const candidates = [...page.entities].sort(
    (a, b) => Number(b.key === preferredKey) - Number(a.key === preferredKey),
  )
  for (const entity of candidates) {
    const record = decodeSource(entity)
    if (record === undefined) continue
    try {
      const bundle = await unpackSource(entity.payload, sourceHash, compression)
      return { record, bundle, payload: entity.payload }
    } catch {
      // A copy that does not match its hash, or is not a bundle. Try the next one.
    }
  }
  return undefined
}

export type SubmittedRequest = {
  txHash: Hash
  requestKey: Hex
  sourceKey: Hex
  sourceHash: Hex
  /** Whether this call published the source, or found a valid copy already on Arkiv. */
  publishedSource: boolean
}

/**
 * Asks the verifiers to check a contract against a source bundle.
 *
 * A new source and its request land in one atomic batch: the source's key is predicted first and
 * stored on the request, so a request can never name a source that failed to be written.
 */
export async function submitRequest(
  clients: { reader: Reader; writer: Writer },
  input: { target: Target; bundle: SourceBundle; compression: Compression },
): Promise<SubmittedRequest> {
  const { reader, writer } = clients
  const packed = await packSource(input.bundle, input.compression)
  const existing = await findSource(reader, packed.sourceHash, input.compression)

  if (existing !== undefined) {
    const sourceKey = existing.record.key
    const batch = await writer.executeBatch({
      creates: [requestDraft({ ...input.target, sourceHash: packed.sourceHash, sourceKey })],
    })
    const [requestKey] = batch.createdEntities
    if (requestKey === undefined) throw new Error("the request was not created")
    return { txHash: batch.txHash, requestKey, sourceKey, sourceHash: packed.sourceHash, publishedSource: false }
  }

  const [predicted] = await reader.predictEntityKeys({ owner: writer.account.address, count: 1 })
  const batch = await writer.executeBatch({
    creates: [
      {
        ...sourceDraft({
          sourceHash: packed.sourceHash,
          compilerVersion: input.bundle.compilerVersion,
          contractName: contractNameOf(input.bundle.contract),
          payload: packed.payload,
        }),
        salt: predicted.salt,
      },
      requestDraft({ ...input.target, sourceHash: packed.sourceHash, sourceKey: predicted.key }),
    ],
  })
  const [sourceKey, requestKey] = batch.createdEntities
  if (sourceKey === undefined || requestKey === undefined) throw new Error("the request was not created")
  return { txHash: batch.txHash, requestKey, sourceKey, sourceHash: packed.sourceHash, publishedSource: true }
}

/**
 * Reads the attestations about the code deployed at an address, split by who signed them.
 *
 * Both queries filter on `$creator` on the node, so the trusted set is complete no matter how many
 * attestations other accounts have written.
 */
export async function fetchAttestations(
  reader: Reader,
  target: Target & { codeHash: Hex },
  trusted: readonly Address[],
): Promise<{ trusted: AttestationRecord[]; others: AttestationRecord[] }> {
  const [fromTrusted, fromOthers] = await Promise.all([
    trusted.length === 0 ? [] : readAll(reader, trustedAttestations(target, trusted), { payload: true }),
    readAll(reader, otherAttestations(target, trusted), { payload: true }),
  ])
  return {
    trusted: decodeAll(fromTrusted, decodeAttestation),
    others: decodeAll(fromOthers, decodeAttestation),
  }
}
