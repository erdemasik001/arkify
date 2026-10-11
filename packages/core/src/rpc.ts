// Talking to the public Arkiv RPC without being put to sleep by it.
//
// The gateway meters anonymous reads: about 100 `arkiv_query` calls an hour per client address.
// Past that it answers HTTP 429 with a `Retry-After` that can be most of an hour, and viem's HTTP
// transport honours that header before retrying, so a client with retries on goes silent for as
// long as the header says (arkiv/friction.md, F-013). Reads here never retry; they fail at once
// with an error that says how long the wait is.
import { http } from "viem"

/** The HTTP transport every Arkify reader uses. */
export const arkivHttp = (url: string) => http(url, { retryCount: 0 })

/** The gateway has paused this client's reads. Nothing is wrong with the data. */
export class ArkivBudgetError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60))
    super(
      "Arkiv's public RPC allows a limited number of anonymous queries per hour from one address, " +
        `and this address has used them. It will answer again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`,
    )
    this.name = "ArkivBudgetError"
  }
}

/** Recognises the gateway's HTTP 429 anywhere in an error's cause chain. */
export function budgetErrorOf(error: unknown): ArkivBudgetError | undefined {
  let current = error as { name?: string; status?: number; headers?: { get(name: string): string | null }; cause?: unknown } | undefined
  for (let depth = 0; current !== undefined && current !== null && depth < 8; depth++) {
    if (current instanceof ArkivBudgetError) return current
    if (current.name === "HttpRequestError" && current.status === 429) {
      const seconds = Number.parseInt(current.headers?.get("retry-after") ?? "", 10)
      return new ArkivBudgetError(Number.isFinite(seconds) ? seconds : 60)
    }
    current = current.cause as typeof current
  }
  return undefined
}

/** An error as one sentence for a person, with rate limiting explained rather than leaked. */
export function explainError(error: unknown): string {
  const budget = budgetErrorOf(error)
  if (budget !== undefined) return budget.message
  return error instanceof Error ? error.message : String(error)
}
