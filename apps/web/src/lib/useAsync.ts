import { explainError } from "@arkify/core"
import { useCallback, useEffect, useRef, useState } from "react"

export type AsyncState<T> = { data: T | undefined; error: string | undefined; loading: boolean; reload(): void }

/** Runs an async loader when its dependencies change; a stale answer never overwrites a newer one. */
export function useAsync<T>(load: () => Promise<T>, dependencies: readonly unknown[]): AsyncState<T> {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true })
  const [nonce, setNonce] = useState(0)
  const latest = useRef(0)

  // The caller lists what the loader reads; `nonce` forces a reload.
  useEffect(() => {
    const run = ++latest.current
    setState((previous) => ({ ...previous, loading: true }))
    load().then(
      (data) => run === latest.current && setState({ data, loading: false }),
      (error: unknown) => run === latest.current && setState({ error: explainError(error), loading: false }),
    )
  }, [...dependencies, nonce])

  const reload = useCallback(() => setNonce((value) => value + 1), [])
  return { data: state.data, error: state.error, loading: state.loading, reload }
}
