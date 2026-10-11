// Phase 0 spike. Exercises every Arkiv feature Arkify relies on against Tiramisu and records what
// actually happened, so arkiv/schema.md and arkiv/friction.md are built on measurements.
//
//   pnpm spike
//
// Needs REQUESTER_PRIVATE_KEY and VERIFIER_A_PRIVATE_KEY in .env, both funded from the Hub faucet.
// Every entity it writes carries app = "arkify-spike" and a per-run tag, and lives for hours at most.
import { randomBytes } from "node:crypto"
import { writeFileSync } from "node:fs"
import {
  createPublicClient,
  createWalletClient,
  type EntityCreatedEvent,
  ExpirationTime,
  jsonToPayload,
  NoEntityFoundError,
} from "@arkiv-network/sdk"
import {
  addr,
  bytes32,
  i32,
  key,
  MAX_ATTRIBUTES,
  MAX_NAME_BYTES,
  MAX_PAYLOAD_BYTES,
  MAX_STRING_BYTES,
  u64,
} from "@arkiv-network/sdk/attr"
import { tiramisu } from "@arkiv-network/sdk/chains"
import { eq, exists, gt, hasType, lt, ne, not, or, startsWith } from "@arkiv-network/sdk/query"
import { formatEther, type Hex, http, keccak256, toHex, webSocket } from "viem"
import { getGasPrice } from "viem/actions"
import { accountFromEnv, rpcUrl, wsUrl } from "./env"

// The public RPC meters anonymous traffic: a request limit and a cost budget for arkiv_query.
// Reads fail fast instead of retrying into the limit, and the headers are tallied for the report.
const quota = { arkivQueries: 0, arkivCost: 0, http429: 0, lowestRemaining: {} as Record<string, number> }
const transport = (retryCount: number) =>
  http(rpcUrl, {
    retryCount,
    onFetchResponse(response) {
      const queryCost = Number(response.headers.get("arkiv-cost") ?? 0)
      if (queryCost > 0) {
        quota.arkivQueries++
        quota.arkivCost += queryCost
      }
      if (response.status === 429) quota.http429++
      const [, limit, remaining] =
        /limit=(\d+), remaining=(\d+)/.exec(response.headers.get("ratelimit") ?? "") ?? []
      if (limit !== undefined && remaining !== undefined) {
        const label = `limit=${limit}`
        quota.lowestRemaining[label] = Math.min(quota.lowestRemaining[label] ?? Infinity, Number(remaining))
      }
    },
  })

const pub = createPublicClient({ chain: tiramisu, transport: transport(0) })
const requester = createWalletClient({
  chain: tiramisu,
  transport: transport(3),
  account: accountFromEnv("REQUESTER_PRIVATE_KEY"),
  pollingInterval: 1_000,
})
const verifier = createWalletClient({
  chain: tiramisu,
  transport: transport(3),
  account: accountFromEnv("VERIFIER_A_PRIVATE_KEY"),
  pollingInterval: 1_000,
})
const A = requester.account.address
const B = verifier.account.address

const run = Date.now().toString(36)
const base = { app: "arkify-spike", run }
const SAMPLE_CHAIN = 11155111n
const SAMPLE_ADDRESS = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"
const SAMPLE_CODE_HASH = keccak256(toHex(`arkify-spike-code-${run}`))

type Detail = Record<string, unknown>
type StepResult = { id: string; title: string; status: "pass" | "fail"; ms: number; detail: Detail }
const results: StepResult[] = []
const costs: { label: string; txHash: Hex; gasUsed: bigint; feeGlm: string }[] = []

const replacer = (_: string, value: unknown) => (typeof value === "bigint" ? value.toString() : value)
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

async function step(id: string, title: string, fn: () => Promise<Detail>): Promise<void> {
  const started = Date.now()
  let status: StepResult["status"] = "pass"
  let detail: Detail
  try {
    detail = await fn()
  } catch (error) {
    status = "fail"
    detail = { error: messageOf(error) }
  }
  const ms = Date.now() - started
  results.push({ id, title, status, ms, detail })
  console.log(`\n[${status.toUpperCase()}] ${id} ${title} (${ms} ms)`)
  console.log(JSON.stringify(detail, replacer, 2))
}

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`check failed: ${message}`)
}

/** Resolves with the error message of a call that is expected to fail. */
async function failureOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn()
  } catch (error) {
    return messageOf(error)
  }
  throw new Error("expected the call to fail, but it succeeded")
}

/** Records what a call did without failing the step: the limits the node enforces are findings. */
async function outcomeOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn()
    return "accepted"
  } catch (error) {
    let cause = error as { name?: string; status?: number; cause?: unknown } | undefined
    for (let depth = 0; cause !== undefined && depth < 8; depth++) {
      if (cause.name === "HttpRequestError") return `rejected (HTTP ${cause.status}): ${messageOf(error)}`
      cause = cause.cause as typeof cause
    }
    return `rejected: ${messageOf(error)}`
  }
}

async function cost(label: string, txHash: Hex) {
  const receipt = await pub.getTransactionReceipt({ hash: txHash })
  const entry = {
    label,
    txHash,
    gasUsed: receipt.gasUsed,
    feeGlm: formatEther(receipt.gasUsed * receipt.effectiveGasPrice),
  }
  costs.push(entry)
  return { txHash, block: receipt.blockNumber, gasUsed: receipt.gasUsed, feeGlm: entry.feeGlm }
}

const hours = ExpirationTime.fromHours
let mainKey: Hex = "0x"
let mainVerifiedAt = 0n

await step("0", "preflight", async () => {
  const [chainId, timing, entityCount, gasPrice, balanceA, balanceB, latest] = await Promise.all([
    pub.getChainId(),
    pub.getBlockTiming(),
    pub.getEntityCount(),
    getGasPrice(pub),
    pub.getBalance({ address: A }),
    pub.getBalance({ address: B }),
    pub.getBlock(),
  ])
  const earlier = await pub.getBlock({ blockNumber: latest.number - 200n })
  if (balanceA === 0n || balanceB === 0n) {
    console.error(`\nFund both wallets from https://hub.arkiv.network first:\n  ${A}\n  ${B}`)
    process.exit(2)
  }
  return {
    run,
    chainId,
    timing,
    measuredBlockSeconds: Number(latest.timestamp - earlier.timestamp) / 200,
    blockGasLimit: latest.gasLimit,
    entityCount,
    gasPriceWei: gasPrice,
    requester: { address: A, balanceGlm: formatEther(balanceA) },
    verifier: { address: B, balanceGlm: formatEther(balanceB) },
  }
})

await step("1", "createEntity with typed attributes", async () => {
  mainVerifiedAt = BigInt(Math.floor(Date.now() / 1000))
  const created = await requester.createEntity({
    payload: jsonToPayload({ note: "arkify spike", engine: "evm-solcjs" }),
    contentType: "application/json",
    attributes: {
      ...base,
      type: "arkify.spike",
      chain_id: u64(SAMPLE_CHAIN),
      address: addr(SAMPLE_ADDRESS),
      code_hash: bytes32(SAMPLE_CODE_HASH),
      verdict: "full_match",
      verified_at: u64(mainVerifiedAt),
      score: i32(-5),
      live: true,
    },
    expires: hours(1),
  })
  mainKey = created.entityKey
  return { ...created, ...(await cost("create (10 attributes, 46 B payload)", created.txHash)) }
})

await step("2", "getEntity reads back every field", async () => {
  const entity = await pub.getEntity(mainKey)
  check(entity.creator === A, "creator is the signer")
  check(entity.owner === A, "owner is the signer")
  return {
    key: entity.key,
    owner: entity.owner,
    creator: entity.creator,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
    expiresAt: entity.expiresAt,
    creationFlags: entity.creationFlags,
    contentType: entity.contentType,
    attributeSchema: entity.attributeSchema,
    attributes: entity.attributes,
    payloadJson: entity.toJson(),
  }
})

await step("3", "compound query, createdBy, ranges, trusted-creator OR", async () => {
  const scoped = [eq("run", run), eq("type", "arkify.spike")]
  const runFilter = eq("run", run).toString()
  const select = { select: { key: true } } as const
  const compound = pub
    .select({ key: true, creator: true })
    .where(
      ...scoped,
      eq("chain_id", u64(SAMPLE_CHAIN)),
      eq("address", addr(SAMPLE_ADDRESS)),
      eq("code_hash", bytes32(SAMPLE_CODE_HASH)),
      gt("verified_at", u64(mainVerifiedAt - 60n)),
      lt("verified_at", u64(mainVerifiedAt + 60n)),
    )
    .createdBy(A)
  const compoundText = compound.toString()
  const compoundPage = await compound.fetch()
  check(compoundPage.entities.length === 1, "compound query finds exactly the spike entity")
  check(compoundPage.entities[0]?.key === mainKey, "compound query returns the right key")

  const wrongCreator = await pub.select({ key: true }).where(scoped).createdBy(B).fetch()
  check(wrongCreator.entities.length === 0, "createdBy(other) finds nothing")

  const trusted = pub
    .select({ key: true, creator: true })
    .where(...scoped, or(eq("$creator", addr(A)), eq("$creator", addr(B))))
  const trustedText = trusted.toString()
  const trustedPage = await trusted.fetch()
  check(trustedPage.entities.length === 1, "OR over $creator finds the entity")

  const raw = await pub.query(compoundText, { select: { key: true } })
  check(raw.entities.length === 1, "the rendered query text works as a raw arkiv_query")

  const block = await pub.getBlockNumber()
  const expiryRange = await pub
    .select({ key: true, expiresAt: true })
    .where(...scoped, gt("$expiresAt", u64(block)))
    .fetch()
  check(expiryRange.entities.length === 1, "$expiresAt supports a range filter")

  const misc = await pub
    .select({ key: true })
    .where(
      ...scoped,
      lt("score", i32(0)),
      not(eq("verdict", "mismatch")),
      startsWith("verdict", "full"),
    )
    .fetch()
  check(misc.entities.length === 1, "negative i32 range / not / startsWith")

  // Operators the SDK exports. What the node makes of each is recorded, not assumed.
  const nodeVerdict = (expression: { toString(): string }) =>
    pub
      .query(`${runFilter} AND ${expression.toString()}`, select)
      .then((result) => `accepted, ${result.entities.length} result(s)`)
      .catch((error: unknown) => {
        const data = (error as { data?: { message?: string } }).data
        return `rejected by the node: ${data?.message ?? messageOf(error)}`
      })
  const exportedOperators = {
    exists: await nodeVerdict(exists("score")),
    ne: await nodeVerdict(ne("verdict", "mismatch")),
    hasType: await nodeVerdict(hasType("score", "i32")),
  }

  // The builder refuses $createdAt; the node accepts it in a raw query string.
  const createdAtBuilder = await failureOf(async () => gt("$createdAt", u64(0n)))
  const [createdUpToNow, createdInFuture] = await Promise.all([
    pub.query(`${runFilter} AND $createdAt <= u64(${block})`, select),
    pub.query(`${runFilter} AND $createdAt > u64(${block + 100_000n})`, select),
  ])
  check(createdUpToNow.entities.length === 1, "raw $createdAt range finds the entity")
  check(createdInFuture.entities.length === 0, "raw $createdAt range excludes it when out of range")

  const untypedLiteral = await pub.query("$expiresAt > 0").catch((error: unknown) => ({
    sdkMessage: messageOf(error),
    nodeData: (error as { data?: unknown }).data,
  }))

  return {
    compoundText,
    trustedText,
    queryBlock: compoundPage.blockNumber,
    createdAtViaBuilder: createdAtBuilder,
    createdAtViaRawQuery: "accepted and applied",
    untypedLiteral,
    exportedOperators,
  }
})

await step("4", "cursor pagination", async () => {
  const batch = await requester.executeBatch({
    creates: [0, 1, 2, 3, 4].map((seq) => ({
      payload: new Uint8Array(),
      contentType: "application/octet-stream",
      attributes: { ...base, kind: "page", seq: i32(seq) },
      expires: hours(1),
    })),
  })
  check(batch.createdEntities.length === 5, "batch created five entities")

  const builder = () =>
    pub
      .select({ key: true, attributes: { seq: true } })
      .where(eq("run", run), eq("kind", "page"))
      .limit(2)
  const pages: number[][] = []
  const keys = new Set<string>()
  let page = await builder().fetch()
  for (;;) {
    pages.push(page.entities.map((entity) => Number(entity.attributes.seq?.value)))
    for (const entity of page.entities) keys.add(entity.key)
    if (!page.hasNextPage()) break
    page = await page.next()
  }
  check(keys.size === 5, "paging returns all five entities exactly once")

  let iterated = 0
  for await (const _ of builder()) iterated++
  check(iterated === 5, "for-await walks every page")

  const tooLarge = await failureOf(() => builder().limit(201).fetch())
  return {
    ...(await cost("batch of 5 creates (2 attributes, empty payload)", batch.txHash)),
    pages,
    cursorSample: page.cursor ?? "(last page has no cursor)",
    limit201: tooLarge,
  }
})

await step("5", "extendEntity sets a new expiry and refuses to shorten", async () => {
  const before = (await pub.getEntity(mainKey)).expiresAt
  const extended = await requester.extendEntity({ entityKey: mainKey, expires: hours(2) })
  const after = (await pub.getEntity(mainKey)).expiresAt
  check(after > before, "expiry moved later")
  const shorter = await failureOf(() =>
    requester.extendEntity({ entityKey: mainKey, expires: ExpirationTime.fromMinutes(30) }),
  )
  return {
    ...(await cost("extend", extended.txHash)),
    expiresAtBefore: before,
    expiresAtAfter: after,
    blocksAdded: after - before,
    sdkEstimate: extended.expiresAt,
    shorterExtension: shorter,
  }
})

await step("6", "patchEntity changes attributes only, owner-only", async () => {
  const before = await pub.getEntity(mainKey)
  const patched = await requester.patchEntity({
    entityKey: mainKey,
    set: { verdict: "partial_match", note: "patched" },
    unset: ["score"],
  })
  const after = await pub.getEntity(mainKey)
  check(after.attributes.verdict?.value === "partial_match", "attribute overwritten")
  check(after.attributes.note?.value === "patched", "attribute added")
  check(after.attributes.score === undefined, "attribute removed")
  check(after.expiresAt === before.expiresAt, "patch leaves the expiry alone")
  check(keccak256(after.payload) === keccak256(before.payload), "patch leaves the payload alone")
  const stranger = await failureOf(() =>
    verifier.patchEntity({ entityKey: mainKey, set: { verdict: "full_match" } }),
  )
  return {
    ...(await cost("patch (set 2, unset 1)", patched.txHash)),
    updatedAtBefore: before.updatedAt,
    updatedAtAfter: after.updatedAt,
    strangerPatch: stranger,
  }
})

await step("7", "readonly + permissionlessExtension flags", async () => {
  const frozen = await requester.createEntity({
    payload: jsonToPayload({ frozen: true }),
    contentType: "application/json",
    attributes: { ...base, kind: "frozen" },
    expires: hours(1),
    flags: { readonly: true, permissionlessExtension: true },
  })
  const strangerExtend = await verifier.extendEntity({ entityKey: frozen.entityKey, expires: hours(2) })
  const strangerPatch = await failureOf(() =>
    verifier.patchEntity({ entityKey: frozen.entityKey, set: { kind: "tampered" } }),
  )
  const ownerPatch = await failureOf(() =>
    requester.patchEntity({ entityKey: frozen.entityKey, set: { kind: "tampered" } }),
  )
  const ownerExtend = await requester.extendEntity({ entityKey: frozen.entityKey, expires: hours(3) })
  const entity = await pub.getEntity(frozen.entityKey)
  check(entity.owner === A, "a stranger's extension does not change the owner")
  check(entity.attributes.kind?.value === "frozen", "contents unchanged")
  const control = await failureOf(() =>
    verifier.extendEntity({ entityKey: mainKey, expires: hours(6) }),
  )
  return {
    entityKey: frozen.entityKey,
    creationFlags: entity.creationFlags,
    create: await cost("create (readonly + permissionlessExtension)", frozen.txHash),
    strangerExtend: await cost("extend by a non-owner", strangerExtend.txHash),
    ownerExtend: await cost("extend readonly entity by owner", ownerExtend.txHash),
    strangerPatch,
    ownerPatch,
    strangerExtendWithoutFlag: control,
  }
})

await step("8", "executeBatch: heartbeat, predicted keys, atomic revert", async () => {
  const beat = await requester.executeBatch({
    patches: [{ entityKey: mainKey, set: { last_beat: u64(BigInt(Math.floor(Date.now() / 1000))) } }],
    extensions: [{ entityKey: mainKey, expires: hours(4) }],
  })

  const [source] = await pub.predictEntityKeys({ owner: A, count: 1 })
  const linked = await requester.executeBatch({
    creates: [
      {
        payload: jsonToPayload({ sources: "..." }),
        contentType: "application/json",
        attributes: { ...base, kind: "source" },
        expires: hours(1),
        salt: source.salt,
        flags: { readonly: true, permissionlessExtension: true },
      },
      {
        payload: jsonToPayload({ verdict: "full_match" }),
        contentType: "application/json",
        attributes: { ...base, kind: "attestation", source_key: key(source.key) },
        expires: hours(1),
      },
    ],
  })
  check(linked.createdEntities[0] === source.key, "predicted key matches the minted key")
  const bySource = await pub
    .select({ key: true })
    .where(eq("run", run), eq("source_key", key(source.key)))
    .fetch()
  check(bySource.entities[0]?.key === linked.createdEntities[1], "key attribute is queryable")

  // A fixed gas limit skips estimation, so the failing batch is really mined and reverted.
  const missing = keccak256(toHex(`arkify-spike-missing-${run}`))
  const reverted = await failureOf(() =>
    requester.executeBatch(
      {
        creates: [
          {
            payload: new Uint8Array(),
            contentType: "application/octet-stream",
            attributes: { ...base, kind: "atomic" },
            expires: hours(1),
          },
        ],
        patches: [{ entityKey: missing, set: { note: "never applied" } }],
      },
      { gas: 400_000n },
    ),
  )
  const leftovers = await pub.select({ key: true }).where(eq("run", run), eq("kind", "atomic")).fetch()
  check(leftovers.entities.length === 0, "the create in the reverted batch was not applied")

  return {
    heartbeat: await cost("batch: patch + extend (heartbeat)", beat.txHash),
    linked: await cost("batch: 2 creates linked by a predicted key", linked.txHash),
    predictedKey: source.key,
    revertedBatch: reverted,
  }
})

await step("9", "watchEntityEvents over WebSocket", async () => {
  const ws = createPublicClient({ chain: tiramisu, transport: webSocket(wsUrl) })
  const seen: { event: EntityCreatedEvent; at: number }[] = []
  const errors: string[] = []
  const unwatch = ws.watchEntityEvents({
    onEntityCreated: (event) => seen.push({ event, at: Date.now() }),
    onError: (error) => errors.push(error.message),
  })
  try {
    await sleep(2_000)
    const sentAt = Date.now()
    const created = await requester.createEntity({
      payload: new Uint8Array(),
      contentType: "application/octet-stream",
      attributes: { ...base, kind: "event" },
      expires: hours(1),
    })
    const receiptAt = Date.now()
    let ours = seen.find(({ event }) => event.entityKey === created.entityKey)
    for (let waited = 0; ours === undefined && waited < 20_000; waited += 250) {
      await sleep(250)
      ours = seen.find(({ event }) => event.entityKey === created.entityKey)
    }
    if (ours === undefined) throw new Error(`no EntityCreated event within 20 s; errors: ${errors}`)
    const hydrated = await pub.getEntity(ours.event.entityKey)
    return {
      transport: ws.transport.type,
      ...(await cost("create (2 attributes, empty payload)", created.txHash)),
      eventFields: Object.keys(ours.event),
      event: ours.event,
      msFromSendToEvent: ours.at - sentAt,
      msFromReceiptToEvent: ours.at - receiptAt,
      createdEventsSeenFromAllApps: seen.length,
      attributesNeedGetEntity: Object.keys(hydrated.attributes),
      errors,
    }
  } finally {
    unwatch()
    await ws.transport
      .getRpcClient()
      .then((socket) => socket.close())
      .catch(() => {})
  }
})

await step("10", "changeOwnership moves $owner, never $creator", async () => {
  const moved = await requester.changeOwnership({ entityKey: mainKey, newOwner: B })
  const entity = await pub.getEntity(mainKey)
  check(entity.owner === B, "owner is the new owner")
  check(entity.creator === A, "creator is still the original signer")
  const oldOwnerPatch = await failureOf(() =>
    requester.patchEntity({ entityKey: mainKey, set: { note: "old owner" } }),
  )
  const newOwnerPatch = await verifier.patchEntity({ entityKey: mainKey, set: { note: "new owner" } })
  const scoped = [eq("run", run), eq("type", "arkify.spike")]
  const [byCreator, byNewOwner, byOldOwner] = await Promise.all([
    pub.select({ key: true }).where(scoped).createdBy(A).fetch(),
    pub.select({ key: true }).where(scoped).ownedBy(B).fetch(),
    pub.select({ key: true }).where(scoped).ownedBy(A).fetch(),
  ])
  check(byCreator.entities.length === 1, "createdBy(original) still finds it")
  check(byNewOwner.entities.length === 1, "ownedBy(new) finds it")
  check(byOldOwner.entities.length === 0, "ownedBy(old) no longer finds it")
  return {
    transfer: await cost("changeOwnership", moved.txHash),
    newOwnerPatch: await cost("patch by the new owner", newOwnerPatch.txHash),
    owner: entity.owner,
    creator: entity.creator,
    oldOwnerPatch,
  }
})

await step("M1", "payload size: what the SDK allows and what the RPC accepts", async () => {
  const createWith = (payload: Uint8Array) =>
    requester.createEntity({
      payload,
      contentType: "application/octet-stream",
      attributes: { ...base, kind: "payload", size: i32(payload.length) },
      expires: hours(1),
    })
  const sizes: Detail = {}
  for (const size of [1024, 32 * 1024, 120 * 1024]) {
    const payload = new Uint8Array(randomBytes(size))
    const created = await createWith(payload)
    const readStarted = Date.now()
    const entity = await pub.getEntity(created.entityKey)
    check(keccak256(entity.payload) === keccak256(payload), `${size} B payload reads back intact`)
    sizes[`${size} B`] = {
      ...(await cost(`create with ${size} B random payload`, created.txHash)),
      readMs: Date.now() - readStarted,
    }
  }
  return {
    MAX_PAYLOAD_BYTES,
    sizes,
    atSdkLimit: await outcomeOf(() => createWith(new Uint8Array(randomBytes(MAX_PAYLOAD_BYTES)))),
    overSdkLimit: await failureOf(() => createWith(new Uint8Array(MAX_PAYLOAD_BYTES + 1))),
  }
})

await step("M2", "lifetime does or does not change the fee", async () => {
  const payload = new Uint8Array(randomBytes(1024))
  const lifetimes = {
    "1 hour": hours(1),
    "180 days": ExpirationTime.fromDays(180),
    "100 years": ExpirationTime.fromYears(100),
    permanent: ExpirationTime.permanent(),
  }
  const out: Detail = {}
  for (const [label, expires] of Object.entries(lifetimes)) {
    out[label] = await requester
      .createEntity({
        payload,
        contentType: "application/octet-stream",
        attributes: { ...base, kind: "lifetime", label },
        expires,
      })
      .then(async (created) => ({
        ...(await cost(`create, 1024 B payload, lifetime ${label}`, created.txHash)),
        entityKey: created.entityKey,
        expiresAt: (await pub.getEntity(created.entityKey)).expiresAt,
      }))
      .catch((error: unknown) => ({ rejected: messageOf(error) }))
  }
  return out
})

await step("M3", "attribute count, name length and string length limits", async () => {
  const userSlots = MAX_ATTRIBUTES - 2
  const longName = "n".repeat(MAX_NAME_BYTES)
  const longValue = "v".repeat(MAX_STRING_BYTES)
  const filler = Object.fromEntries(
    Array.from({ length: userSlots - 4 }, (_, index) => [`a${String(index).padStart(2, "0")}`, i32(index)]),
  )
  const full = { ...base, kind: "limits", [longName]: longValue, ...filler }
  check(Object.keys(full).length === userSlots, "the test entity fills every user slot")
  const created = await requester.createEntity({
    payload: jsonToPayload({ limits: true }),
    contentType: "application/json",
    attributes: full,
    expires: hours(1),
  })
  const entity = await pub.getEntity(created.entityKey)
  check(Object.keys(entity.attributes).length === userSlots, "all user attributes read back")
  check(entity.attributes[longName]?.value === longValue, "longest name and value read back")
  const create = (attributes: Record<string, string | ReturnType<typeof i32>>) =>
    failureOf(() =>
      requester.createEntity({
        payload: jsonToPayload({ limits: true }),
        contentType: "application/json",
        attributes,
        expires: hours(1),
      }),
    )
  return {
    ...(await cost(`create with ${userSlots} attributes`, created.txHash)),
    userAttributeSlots: userSlots,
    MAX_NAME_BYTES,
    MAX_STRING_BYTES,
    oneAttributeTooMany: await create({ ...full, extra: "x" }),
    nameTooLong: await create({ ...base, [`${longName}n`]: "x" }),
    valueTooLong: await create({ ...base, long: `${longValue}v` }),
    reservedName: await create({ ...base, key: "x" }),
    upperCaseName: await outcomeOf(() =>
      requester.createEntity({
        payload: jsonToPayload({ limits: true }),
        contentType: "application/json",
        attributes: { ...base, chainId: "x" },
        expires: hours(1),
      }),
    ),
  }
})

await step("M4", "an expired entity disappears, its creation tx does not", async () => {
  const created = await requester.createEntity({
    payload: jsonToPayload({ shortLived: true }),
    contentType: "application/json",
    attributes: { ...base, kind: "short" },
    expires: ExpirationTime.fromBlocks(3),
  })
  const createdBlock = (await pub.getTransactionReceipt({ hash: created.txHash })).blockNumber
  const started = Date.now()
  let goneAtBlock: bigint | undefined
  let lastError = ""
  while (goneAtBlock === undefined && Date.now() - started < 60_000) {
    await sleep(1_000)
    try {
      await pub.getEntity(created.entityKey)
    } catch (error) {
      if (!(error instanceof NoEntityFoundError)) throw error
      lastError = error.message
      goneAtBlock = await pub.getBlockNumber()
    }
  }
  if (goneAtBlock === undefined) throw new Error("entity was still readable 60 s after its expiry")
  const queried = await pub.select({ key: true }).where(eq("run", run), eq("kind", "short")).fetch()
  const receipt = await pub.getTransactionReceipt({ hash: created.txHash })
  return {
    ...(await cost("create, lifetime 3 blocks", created.txHash)),
    entityKey: created.entityKey,
    createdBlock,
    expiresAt: created.expiresAt,
    firstSeenGoneAtBlock: goneAtBlock,
    secondsUntilGone: (Date.now() - started) / 1000,
    getEntityAfterExpiry: lastError,
    queryAfterExpiry: queried.entities.length,
    creationReceiptStillAvailable: receipt.status,
    creationLogs: receipt.logs.length,
  }
})

await step("M5", "cost and RPC quota summary", async () => {
  const [balanceA, balanceB, gasPrice] = await Promise.all([
    pub.getBalance({ address: A }),
    pub.getBalance({ address: B }),
    getGasPrice(pub),
  ])
  return {
    gasPriceWei: gasPrice,
    requesterBalanceGlm: formatEther(balanceA),
    verifierBalanceGlm: formatEther(balanceB),
    rpcQuota: quota,
    costs,
  }
})

const failed = results.filter((result) => result.status === "fail")
const summary = {
  ranAt: new Date().toISOString(),
  run,
  sdk: "@arkiv-network/sdk@0.8.1",
  chainId: tiramisu.id,
  wallets: { requester: A, verifier: B },
  results,
}
writeFileSync(new URL("../arkiv/spike-run.json", import.meta.url), `${JSON.stringify(summary, replacer, 2)}\n`)
console.log(`\n${results.length - failed.length}/${results.length} steps passed. Wrote arkiv/spike-run.json`)
if (failed.length > 0) console.log(`Failed: ${failed.map((result) => result.id).join(", ")}`)
process.exit(failed.length > 0 ? 1 : 0)
