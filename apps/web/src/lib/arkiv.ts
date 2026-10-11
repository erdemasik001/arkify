// The only data sources this app has: the public Arkiv RPC, read straight from the browser.
import { type LiveStatus, mayBe, watchLive } from "@arkify/core"
import { createPublicClient, type EntityCreatedEvent, type EntityEvent } from "@arkiv-network/sdk"
import { tiramisu } from "@arkiv-network/sdk/chains"
import { http } from "viem"

export const RPC_URL = tiramisu.rpcUrls.default.http[0]
export const WS_URL = tiramisu.rpcUrls.default.webSocket[0]
export const ARKIV_EXPLORER = "https://tiramisu.explorer.arkiv.network"
/** Tiramisu produces a block every two seconds. */
export const BLOCK_SECONDS = 2

// Reads are metered (about 100 queries an hour per address), so identical queries made within a
// short while are answered from this tab's memory: going back to a page does not ask Arkiv again.
// Anything that must be fresh calls `forgetQueries()` first.
const CACHE_MS = import.meta.env.DEV ? 10 * 60_000 : 20_000
const cache = new Map<string, { at: number; body: string }>()

async function cachedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let key: string | undefined
  let id: unknown
  try {
    const request = JSON.parse(String(init?.body)) as { id?: unknown; method?: string; params?: unknown }
    if (request.method === "arkiv_query") {
      key = JSON.stringify(request.params)
      id = request.id
    }
  } catch {
    // Not a single JSON-RPC call; pass it through untouched.
  }
  const hit = key === undefined ? undefined : cache.get(key)
  if (hit !== undefined && Date.now() - hit.at < CACHE_MS) {
    const body = JSON.stringify({ ...(JSON.parse(hit.body) as object), id })
    return new Response(body, { status: 200, headers: { "content-type": "application/json" } })
  }
  const response = await fetch(input, init)
  if (key !== undefined && response.ok) {
    const body = await response.clone().text()
    if (!body.includes('"error"')) cache.set(key, { at: Date.now(), body })
  }
  return response
}

export const forgetQueries = () => cache.clear()

export const reader = createPublicClient({
  chain: tiramisu,
  transport: http(RPC_URL, { retryCount: 0, fetchFn: cachedFetch }),
})

/** The plain JSON-RPC call that returns what a query returns, for people who would rather not trust this page. */
export function curlFor(query: string): string {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "arkiv_query",
    params: [query, { select: { key: true, creator: true, expiresAt: true, attributes: true } }],
  })
  return `curl -s ${RPC_URL} -H 'content-type: application/json' --data @- <<'JSON'\n${body}\nJSON`
}

// One WebSocket connection per tab, shared by every component that wants live events.
type Listener = { onCreated?: (event: EntityCreatedEvent) => void; onEvent?: (event: EntityEvent) => void }
const listeners = new Set<Listener>()
const statusListeners = new Set<(status: LiveStatus) => void>()
let status: LiveStatus = "connecting"
let stop: (() => void) | undefined

function ensureConnection(): void {
  stop ??= watchLive({
    wsUrl: WS_URL,
    onCreated: (event) => listeners.forEach((listener) => listener.onCreated?.(event)),
    onEvent: (event) => listeners.forEach((listener) => listener.onEvent?.(event)),
    onStatus: (next) => {
      status = next
      statusListeners.forEach((listener) => listener(next))
    },
  })
}

export function subscribeLive(listener: Listener): () => void {
  listeners.add(listener)
  ensureConnection()
  return () => {
    listeners.delete(listener)
  }
}

export function subscribeStatus(listener: (status: LiveStatus) => void): () => void {
  statusListeners.add(listener)
  ensureConnection()
  return () => {
    statusListeners.delete(listener)
  }
}

export const liveStatus = () => status
export { mayBe }
