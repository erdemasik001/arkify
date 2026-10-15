import { createHash } from "node:crypto"
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { fetchVerified } from "../src"

describe("fetchVerified", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("lets verifiers that share a cache download the same build at the same time", async () => {
    const bytes = new TextEncoder().encode("module.exports = {}")
    const build = {
      path: "soljson-v0.0.0+commit.00000000.js",
      sha256: `0x${createHash("sha256").update(bytes).digest("hex")}`,
    }
    vi.stubGlobal("fetch", vi.fn(async () => new Response(bytes)))
    const dir = await mkdtemp(join(tmpdir(), "arkify-solc-"))
    try {
      const files = await Promise.all([1, 2, 3, 4].map(() => fetchVerified(build, dir)))
      expect(new Set(files).size).toBe(1)
      expect(await readFile(files[0] ?? "")).toEqual(Buffer.from(bytes))
      expect(await readdir(dir)).toEqual(["soljson-v0.0.0+commit.00000000.cjs"])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
