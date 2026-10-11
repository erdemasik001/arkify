// An Arkify verifier: watches Arkiv for verification requests, re-compiles the source, and
// publishes what it found as an attestation signed by its own wallet.
//
// Nothing is kept on disk. After a restart the work queue is rebuilt from the requests still alive
// on Arkiv and the attestations this wallet has already written.
import {
  arkivHttp,
  attestationDraft,
  attestationsOfSource,
  attestationsVerifiedSince,
  budgetErrorOf,
  contractNameOf,
  decodeAll,
  decodeAttestation,
  decodeRequest,
  decodeSource,
  decodeVerifier,
  EntityType,
  type FoundSource,
  findSource,
  HEARTBEAT_SECONDS,
  heartbeatAttributes,
  Lifetime,
  mayBe,
  RECORD_SELECTION,
  type RequestRecord,
  readAll,
  requests,
  requestsCreatedAfter,
  sourceDraft,
  sourcesWithHash,
  type Target,
  Verdict,
  verifierDraft,
  verifiers,
  watchLive,
} from "@arkify/core"
import {
  ENGINE,
  ENGINE_VERSION,
  nodeBrotli,
  rpcCodeReader,
  rpcUrlsFromEnv,
  type Verification,
} from "@arkify/engine"
import { createPublicClient, createWalletClient, NoEntityFoundError } from "@arkiv-network/sdk"
import { tiramisu } from "@arkiv-network/sdk/chains"
import { type Address, type Hex, http, keccak256, type PrivateKeyAccount } from "viem"
import { IsolatedEngine, VerificationAbortedError } from "./isolatedEngine"
import { RateLimiter } from "./rateLimiter"

export type VerifierOptions = {
  account: PrivateKeyAccount
  /** The label shown beside this verifier's address. */
  name: string
  rpcUrl: string
  wsUrl: string
  /** Demo only: attest `full_match` to everything without compiling anything. */
  evil?: boolean
  heartbeatSeconds?: number
  /** How long one verification may run before it is stopped and reported as an `error`. */
  verifyTimeoutSeconds?: number
  log?: (line: string) => void
}

export type RunningVerifier = {
  address: Address
  /** The key of this verifier's registration entity. */
  registration: Hex
  stop(): Promise<void>
}

/** How many requests one account may have verified per hour before the rest are ignored. */
const REQUESTS_PER_CREATOR_PER_HOUR = 30
const MAX_ATTEMPTS = 3
const DAY_SECONDS = 24n * 60n * 60n

const now = () => BigInt(Math.floor(Date.now() / 1000))
const short = (hex: string) => `${hex.slice(0, 10)}…`
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))
const pairKey = (target: Target, sourceHash: Hex) =>
  `${target.chainId}:${target.address.toLowerCase()}:${sourceHash.toLowerCase()}`

export async function startVerifier(options: VerifierOptions): Promise<RunningVerifier> {
  const { account, name, evil = false } = options
  const self = account.address
  const log = options.log ?? ((line: string) => console.log(`[${name}] ${line}`))
  const rpcUrls = rpcUrlsFromEnv()
  const readCode = rpcCodeReader(rpcUrls)
  const engine = new IsolatedEngine((options.verifyTimeoutSeconds ?? 180) * 1000)
  const heartbeatMs = (options.heartbeatSeconds ?? HEARTBEAT_SECONDS) * 1000

  const pub = createPublicClient({ chain: tiramisu, transport: arkivHttp(options.rpcUrl) })
  const wallet = createWalletClient({
    chain: tiramisu,
    transport: http(options.rpcUrl),
    account,
    pollingInterval: 1_000,
  })
  // One wallet, one nonce sequence: heartbeats and attestations must not race each other.
  let lastWrite: Promise<unknown> = Promise.resolve()
  function write<T>(send: () => Promise<T>): Promise<T> {
    const sent = lastWrite.then(send, send)
    lastWrite = sent.catch(() => undefined)
    return sent
  }

  const registrationOf = () =>
    verifierDraft({
      name,
      engine: evil ? "none (demo-only dishonest verifier)" : ENGINE,
      engineVersion: ENGINE_VERSION,
      now: now(),
      description: evil
        ? "Demo only. Attests full_match to everything, to show that trust filtering catches it."
        : "Re-compiles Solidity sources with solc-js and compares runtime bytecode.",
    })

  async function register(): Promise<Hex> {
    const mine = decodeAll(await readAll(pub, verifiers(), { creator: self }), decodeVerifier)
    const existing = mine.find((record) => record.owner === self)
    if (existing === undefined) {
      const created = await write(() => wallet.createEntity(registrationOf()))
      log(`registered ${short(created.entityKey)}`)
      return created.entityKey
    }
    // Renew the lease already held, and correct the label if this instance was reconfigured.
    await write(() =>
      wallet.executeBatch({
        patches: [{ entityKey: existing.key, set: registrationOf().attributes ?? {} }],
        extensions: [{ entityKey: existing.key, expires: Lifetime.verifierLease }],
      }),
    )
    log(`resumed registration ${short(existing.key)}`)
    return existing.key
  }

  let registration = await register()

  /** The heartbeat: `last_beat` and the lease move together, in one atomic batch. */
  async function beat(): Promise<void> {
    try {
      await write(() =>
        wallet.executeBatch({
          patches: [{ entityKey: registration, set: heartbeatAttributes(now()) }],
          extensions: [{ entityKey: registration, expires: Lifetime.verifierLease }],
        }),
      )
    } catch (error) {
      // The lease ran out while this process was stalled: the entity is gone, so start a new one.
      log(`heartbeat failed (${messageOf(error)}); registering again`)
      registration = await register()
    }
  }

  // Requests this process has taken on, by key, and (contract, source) pairs it has answered.
  const taken = new Set<Hex>()
  const attempts = new Map<Hex, number>()
  const answered = new Set<string>()
  const limiter = new RateLimiter(REQUESTS_PER_CREATOR_PER_HOUR, 60 * 60 * 1000)
  const queue: RequestRecord[] = []
  let draining: Promise<void> | undefined
  let stopped = false

  function enqueue(request: RequestRecord): void {
    if (stopped || taken.has(request.key)) return
    taken.add(request.key)
    queue.push(request)
    draining ??= drain().finally(() => {
      draining = undefined
    })
  }

  // When the RPC has paused this address's reads, work waits instead of failing over and over.
  let pausedUntil = 0
  function pauseFor(error: unknown): boolean {
    const budget = budgetErrorOf(error)
    if (budget === undefined) return false
    pausedUntil = Date.now() + budget.retryAfterSeconds * 1000
    log(`reads paused by the RPC for ${budget.retryAfterSeconds} s (anonymous query budget used up)`)
    return true
  }
  const waitOutPause = async () => {
    while (!stopped && Date.now() < pausedUntil) await new Promise((resolve) => setTimeout(resolve, 5_000))
  }

  async function drain(): Promise<void> {
    for (let request = queue.shift(); request !== undefined && !stopped; request = queue.shift()) {
      await waitOutPause()
      try {
        await handle(request)
      } catch (error) {
        if (pauseFor(error)) {
          queue.unshift(request)
          continue
        }
        // Most likely the chain or Arkiv was unreachable. The next scan offers the request again.
        const tried = (attempts.get(request.key) ?? 0) + 1
        attempts.set(request.key, tried)
        if (tried < MAX_ATTEMPTS) taken.delete(request.key)
        log(`request ${short(request.key)} failed, attempt ${tried}: ${messageOf(error)}`)
      }
    }
  }

  async function handle(request: RequestRecord): Promise<void> {
    if (!limiter.allow(request.creator)) {
      log(`request ${short(request.key)} ignored: ${request.creator} is over the hourly limit`)
      return
    }
    if (!(request.chainId.toString() in rpcUrls)) {
      log(`request ${short(request.key)} ignored: chain ${request.chainId} is not one this verifier reads`)
      return
    }
    const target: Target = { chainId: request.chainId, address: request.address }
    const source = await findSource(pub, request.sourceHash, nodeBrotli, request.sourceKey)

    // A result reached without the engine: read the deployed code here, so the attestation is
    // still tied to the code it was (not) checked against.
    const withoutEngine = async (verdict: Verdict, message: string): Promise<Verification> => ({
      verdict,
      codeHash: keccak256(await readCode(target)),
      details: { engine: evil ? "none" : ENGINE, engineVersion: ENGINE_VERSION, durationMs: 0, message },
    })

    let verification: Verification
    if (evil) {
      verification = await withoutEngine(Verdict.FullMatch, "Demo-only dishonest verifier: nothing was compiled.")
    } else if (source === undefined) {
      verification = await withoutEngine(
        Verdict.Error,
        "The source bundle this request names is not on Arkiv, or does not match its hash.",
      )
    } else {
      try {
        verification = await engine.verify({ target, bundle: source.bundle })
      } catch (error) {
        if (!(error instanceof VerificationAbortedError)) throw error
        verification = await withoutEngine(Verdict.Error, error.message)
      }
    }
    const outcome = await publish(request, source, verification)
    answered.add(pairKey(target, request.sourceHash))
    log(`request ${short(request.key)} ${outcome} ${verification.verdict}`)
  }

  async function publish(
    request: RequestRecord,
    source: FoundSource | undefined,
    verification: Verification,
  ): Promise<"attested" | "extended"> {
    const { verdict, codeHash, details } = verification
    const pair = {
      chainId: request.chainId,
      address: request.address,
      codeHash,
      sourceHash: request.sourceHash,
    }
    const lifetime = verdict === Verdict.Error ? Lifetime.failedAttestation : Lifetime.attestation

    // Asked again about code and a source this wallet has already judged the same way: the answer
    // on Arkiv is still right, so its life is extended rather than a duplicate written.
    const mine = decodeAll(await readAll(pub, attestationsOfSource(pair), { creator: self }), decodeAttestation)
    const latest = mine.sort((a, b) => Number(b.verifiedAt - a.verifiedAt))[0]
    if (latest !== undefined && latest.verdict === verdict) {
      await write(() => wallet.extendEntity({ entityKey: latest.key, expires: lifetime }))
      return "extended"
    }

    const attestation = (sourceKey: Hex) =>
      attestationDraft({ ...pair, sourceKey, verdict, verifiedAt: now(), details })
    const matched = verdict === Verdict.FullMatch || verdict === Verdict.PartialMatch
    if (source === undefined || evil || !matched) {
      await write(() => wallet.createEntity(attestation(source?.record.key ?? request.sourceKey)))
      return "attested"
    }

    // A source that matched is worth keeping, and its submitter could delete their copy. So this
    // verifier holds its own, and points its attestation at that.
    const copies = decodeAll(await readAll(pub, sourcesWithHash(request.sourceHash), { creator: self }), decodeSource)
    const copy = copies.find((record) => record.owner === self)
    if (copy !== undefined) {
      await write(() =>
        wallet.executeBatch({
          creates: [attestation(copy.key)],
          extensions: [{ entityKey: copy.key, expires: Lifetime.source }],
        }),
      )
      return "attested"
    }
    // The copy and the attestation that points at it are written together or not at all.
    await write(async () => {
      const [predicted] = await pub.predictEntityKeys({ owner: self, count: 1 })
      return wallet.executeBatch({
        creates: [
          {
            ...sourceDraft({
              sourceHash: request.sourceHash,
              compilerVersion: source.bundle.compilerVersion,
              contractName: contractNameOf(source.bundle.contract),
              payload: source.payload,
            }),
            salt: predicted.salt,
          },
          attestation(predicted.key),
        ],
      })
    })
    return "attested"
  }

  /**
   * Offers every live request this verifier has not answered. Run at start-up to catch up on what
   * arrived while it was down, and again with each heartbeat as a net under the live subscription.
   */
  let scannedTo: bigint | undefined
  async function scan(): Promise<void> {
    if (Date.now() < pausedUntil) return
    const text = scannedTo === undefined ? requests().toString() : requestsCreatedAfter(scannedTo)
    let page = await pub.query(text, { select: RECORD_SELECTION, limit: 200 })
    const head = page.blockNumber
    for (;;) {
      for (const request of decodeAll(page.entities, decodeRequest)) {
        if (!answered.has(pairKey(request, request.sourceHash))) enqueue(request)
      }
      if (page.cursor === undefined) break
      page = await pub.query(text, { select: RECORD_SELECTION, limit: 200, cursor: page.cursor })
    }
    scannedTo = head
  }

  const reportScanFailure = (error: unknown) => {
    if (!pauseFor(error)) log(`scan failed: ${messageOf(error)}`)
  }

  // What this wallet answered in the last day, so start-up does not redo it.
  const recent = await readAll(pub, attestationsVerifiedSince(now() - DAY_SECONDS - 3_600n), { creator: self })
  for (const attestation of decodeAll(recent, decodeAttestation)) {
    answered.add(pairKey(attestation, attestation.sourceHash))
  }

  // Live path: a WebSocket subscription, no polling. Events carry no attributes, so only creates
  // shaped like a request are read back. `watchLive` keeps the connection alive, and whatever was
  // created while it was down is picked up by a scan.
  const stopWatching = watchLive({
    wsUrl: options.wsUrl,
    onCreated: (event) => {
      if (!mayBe(EntityType.Request, event)) return
      void readRequest(event.entityKey).then(
        (request) => request !== undefined && enqueue(request),
        (error) => pauseFor(error) || log(`could not read ${short(event.entityKey)}: ${messageOf(error)}`),
      )
    },
    onReconnect: () => void scan().catch(reportScanFailure),
    onStatus: (status, detail) => status === "reconnecting" && log(`subscription lost (${detail})`),
  })

  async function readRequest(entityKey: Hex, retry = true): Promise<RequestRecord | undefined> {
    try {
      return decodeRequest(await pub.getEntity(entityKey))
    } catch (error) {
      if (!(error instanceof NoEntityFoundError) || !retry) throw error
      await new Promise((resolve) => setTimeout(resolve, 1_500))
      return readRequest(entityKey, false)
    }
  }

  await scan()
  const timer = setInterval(() => {
    void beat().then(scan).catch(reportScanFailure)
  }, heartbeatMs)
  log(`ready as ${self}${evil ? " (EVIL demo mode)" : ""}`)

  return {
    address: self,
    get registration() {
      return registration
    },
    async stop() {
      stopped = true
      clearInterval(timer)
      stopWatching()
      await draining?.catch(() => undefined)
      await lastWrite
      await engine.close()
    },
  }
}
