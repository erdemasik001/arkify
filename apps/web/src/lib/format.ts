import { BLOCK_SECONDS } from "./arkiv"

export const shortHex = (hex: string, head = 6, tail = 4) =>
  hex.length <= head + tail + 2 ? hex : `${hex.slice(0, head + 2)}…${hex.slice(-tail)}`

function duration(seconds: number): string {
  if (seconds < 90) return `${Math.max(0, Math.round(seconds))} s`
  if (seconds < 90 * 60) return `${Math.round(seconds / 60)} min`
  if (seconds < 36 * 3600) return `${Math.round(seconds / 3600)} h`
  return `${Math.round(seconds / 86400)} days`
}

export const timeAgo = (unixSeconds: bigint) => `${duration(Date.now() / 1000 - Number(unixSeconds))} ago`

/** How long until an entity expires, from its expiry block and the current head. */
export function expiresIn(expiresAt: bigint, head: bigint): string {
  const blocks = Number(expiresAt - head)
  return blocks <= 0 ? "expired" : duration(blocks * BLOCK_SECONDS)
}

export const dateTime = (unixSeconds: bigint) =>
  new Date(Number(unixSeconds) * 1000).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" })
