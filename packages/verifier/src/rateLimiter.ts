/** A sliding-window limit per key, so one account cannot keep a verifier busy by itself. */
export class RateLimiter {
  private readonly events = new Map<string, number[]>()

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Records an event for `key` and returns whether it is within the limit. */
  allow(key: string, at = Date.now()): boolean {
    const id = key.toLowerCase()
    const recent = (this.events.get(id) ?? []).filter((time) => at - time < this.windowMs)
    const allowed = recent.length < this.limit
    if (allowed) recent.push(at)
    this.events.set(id, recent)
    return allowed
  }
}
