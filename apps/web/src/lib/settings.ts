// Who this user trusts. It is a local preference: kept in this browser, never sent anywhere.
import { DEFAULT_THRESHOLD, DEFAULT_TRUSTED_VERIFIERS } from "@arkify/core"
import { useSyncExternalStore } from "react"
import { type Address, getAddress, isAddress } from "viem"

export type Settings = { trusted: Address[]; threshold: number }

const STORAGE_KEY = "arkify.settings.v1"
const defaults: Settings = { trusted: [...DEFAULT_TRUSTED_VERIFIERS], threshold: DEFAULT_THRESHOLD }

function load(): Settings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === null) return defaults
    const parsed = JSON.parse(raw) as Partial<Settings>
    const trusted = Array.isArray(parsed.trusted)
      ? parsed.trusted.filter((value): value is Address => typeof value === "string" && isAddress(value)).map((value) => getAddress(value))
      : defaults.trusted
    const threshold = Number.isInteger(parsed.threshold) && (parsed.threshold ?? 0) >= 1 ? (parsed.threshold as number) : defaults.threshold
    return { trusted, threshold }
  } catch {
    // Storage can be blocked or hold something unreadable; the defaults always work.
    return defaults
  }
}

let current = load()
const subscribers = new Set<() => void>()

function update(next: Settings): void {
  current = next
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Not persisted, but still applied for this visit.
  }
  subscribers.forEach((notify) => notify())
}

export const isDefault = (settings: Settings) =>
  settings.threshold === defaults.threshold &&
  settings.trusted.length === defaults.trusted.length &&
  settings.trusted.every((address, index) => address === defaults.trusted[index])

export function setTrusted(address: Address, trusted: boolean): void {
  const normalised = getAddress(address)
  const without = current.trusted.filter((entry) => entry !== normalised)
  update({ ...current, trusted: trusted ? [...without, normalised] : without })
}

export const setThreshold = (threshold: number) => update({ ...current, threshold: Math.max(1, Math.floor(threshold)) })
export const resetSettings = () => update(defaults)

export function useSettings(): Settings {
  return useSyncExternalStore(
    (notify) => {
      subscribers.add(notify)
      return () => subscribers.delete(notify)
    },
    () => current,
  )
}
