// A WebSocket subscription to Arkiv entity events that stays alive.
//
// The public endpoint caps concurrent WebSocket connections and refuses the handshake beyond the
// cap, after which the SDK's watcher is silent for good (arkiv/friction.md, F-015). This owns the
// connection instead: on an error, or when a chain that is never quiet goes quiet, it is rebuilt
// with a backoff. Used by the verifier and by the web app.
import { createPublicClient, type EntityCreatedEvent, type EntityEvent } from "@arkiv-network/sdk"
import { tiramisu } from "@arkiv-network/sdk/chains"
import { webSocket } from "viem"

export type LiveStatus = "connecting" | "live" | "reconnecting"

export type LiveOptions = {
  wsUrl: string
  onCreated?: (event: EntityCreatedEvent) => void
  onEvent?: (event: EntityEvent) => void
  /** Called after every reconnect, so the caller can read what it missed. */
  onReconnect?: () => void
  onStatus?: (status: LiveStatus, detail?: string) => void
  /** Silence longer than this means a dead socket. Tiramisu sees a create every second or two. */
  quietMs?: number
}

/** Starts the subscription and returns a function that stops it. */
export function watchLive(options: LiveOptions): () => void {
  const quietMs = options.quietMs ?? 60_000
  let connection: { close(): void } | undefined
  let retry: ReturnType<typeof setTimeout> | undefined
  let failures = 0
  let lastEventAt = Date.now()
  let live = false
  let stopped = false

  function connect(): void {
    const client = createPublicClient({
      chain: tiramisu,
      transport: webSocket(options.wsUrl, { keepAlive: true, reconnect: false }),
    })
    const unwatch = client.watchEntityEvents({
      onEvent: (event) => {
        lastEventAt = Date.now()
        failures = 0
        if (!live) {
          live = true
          options.onStatus?.("live")
        }
        options.onEvent?.(event)
      },
      ...(options.onCreated !== undefined && { onEntityCreated: options.onCreated }),
      onError: (error) => reconnect(error.message),
    })
    lastEventAt = Date.now()
    connection = {
      close() {
        unwatch()
        void client.transport
          .getRpcClient()
          .then((socket) => socket.close())
          .catch(() => undefined)
      },
    }
  }

  function reconnect(reason: string): void {
    if (stopped || retry !== undefined) return
    connection?.close()
    connection = undefined
    live = false
    const delay = Math.min(30_000, 1_000 * 2 ** failures) + Math.random() * 1_000
    failures++
    options.onStatus?.("reconnecting", `${reason}; retrying in ${Math.round(delay / 1000)} s`)
    retry = setTimeout(() => {
      retry = undefined
      connect()
      options.onReconnect?.()
    }, delay)
  }

  options.onStatus?.("connecting")
  connect()
  const watchdog = setInterval(() => {
    if (Date.now() - lastEventAt > quietMs) reconnect("no events for a while")
  }, quietMs / 4)

  return () => {
    stopped = true
    clearInterval(watchdog)
    clearTimeout(retry)
    connection?.close()
    connection = undefined
  }
}
