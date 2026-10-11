// The only data sources this app has: the public Arkiv RPC, read straight from the browser.
import { arkivHttp, type LiveStatus, mayBe, watchLive } from "@arkify/core"
import { createPublicClient, type EntityCreatedEvent, type EntityEvent } from "@arkiv-network/sdk"
import { tiramisu } from "@arkiv-network/sdk/chains"

export const RPC_URL = tiramisu.rpcUrls.default.http[0]
export const WS_URL = tiramisu.rpcUrls.default.webSocket[0]
export const ARKIV_EXPLORER = "https://tiramisu.explorer.arkiv.network"
/** Tiramisu produces a block every two seconds. */
export const BLOCK_SECONDS = 2

export const reader = createPublicClient({ chain: tiramisu, transport: arkivHttp(RPC_URL) })

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
