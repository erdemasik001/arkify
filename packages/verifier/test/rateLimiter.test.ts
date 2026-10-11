import { describe, expect, it } from "vitest"
import { RateLimiter } from "../src/rateLimiter"

describe("RateLimiter", () => {
  it("allows up to the limit inside the window, per key", () => {
    const limiter = new RateLimiter(2, 1_000)
    expect(limiter.allow("0xA", 0)).toBe(true)
    expect(limiter.allow("0xA", 10)).toBe(true)
    expect(limiter.allow("0xA", 20)).toBe(false)
    expect(limiter.allow("0xB", 20)).toBe(true)
  })

  it("forgets events once they leave the window", () => {
    const limiter = new RateLimiter(1, 1_000)
    expect(limiter.allow("0xA", 0)).toBe(true)
    expect(limiter.allow("0xA", 999)).toBe(false)
    expect(limiter.allow("0xA", 1_000)).toBe(true)
  })

  it("treats differently cased addresses as one account, and does not count refusals", () => {
    const limiter = new RateLimiter(1, 1_000)
    expect(limiter.allow("0xAbC", 0)).toBe(true)
    expect(limiter.allow("0xaBc", 1)).toBe(false)
    expect(limiter.allow("0xABC", 2)).toBe(false)
    expect(limiter.allow("0xabc", 1_000)).toBe(true)
  })
})
