// The verifier registry: every registration whose lease is still alive, read once and shared.
import { decodeAll, decodeVerifier, explainError, readAll, type VerifierRecord, verifiers } from "@arkify/core"
import { useEffect, useState } from "react"
import { forgetQueries, reader } from "./arkiv"

export type Registry = {
  records: VerifierRecord[]
  /** The newest live registration per signing address, lowercased. */
  byCreator: Map<string, VerifierRecord>
  /** The Arkiv block the registry was read at, for "expires in" arithmetic. */
  head: bigint
  /** When it was read, in milliseconds, to estimate the head since. */
  readAt: number
}

const MAX_AGE_MS = 20_000
let cached: { at: number; value: Promise<Registry> } | undefined

export function loadRegistry(force = false): Promise<Registry> {
  if (!force && cached !== undefined && Date.now() - cached.at < MAX_AGE_MS) return cached.value
  const value = Promise.all([readAll(reader, verifiers()), reader.getBlockNumber()]).then(([entities, head]) => {
    const records = decodeAll(entities, decodeVerifier).sort((a, b) => Number(b.lastBeat - a.lastBeat))
    const byCreator = new Map<string, VerifierRecord>()
    for (const record of records) {
      const key = record.creator.toLowerCase()
      if (!byCreator.has(key)) byCreator.set(key, record)
    }
    return { records, byCreator, head, readAt: Date.now() }
  })
  cached = { at: Date.now(), value }
  value.catch(() => {
    if (cached?.value === value) cached = undefined
  })
  return value
}

export function useRegistry(): { registry: Registry | undefined; error: string | undefined; reload(): void } {
  const [registry, setRegistry] = useState<Registry>()
  const [error, setError] = useState<string>()
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    let current = true
    loadRegistry(nonce > 0).then(
      (value) => current && setRegistry(value),
      (reason: unknown) => current && setError(explainError(reason)),
    )
    return () => {
      current = false
    }
  }, [nonce])
  return {
    registry,
    error,
    reload: () => {
      forgetQueries()
      setNonce((value) => value + 1)
    },
  }
}
