// Needs the network: downloads solc builds, and for the Sepolia cases reads deployed code from a
// public RPC and candidate sources from Sourcify. Run with `pnpm test:network`.
import type { SourceBundle } from "@arkify/core"
import { bytesToHex, type Hex } from "viem"
import { describe, expect, it } from "vitest"
import { compileBundle, fetchSourcifyBundle, rpcCodeReader, verify } from "../src"
import { fixtures, SEPOLIA } from "./fixtures"

const TIMEOUT = 300_000
const target = { chainId: SEPOLIA, address: "0x000000000000000000000000000000000000c0de" } as const

const COUNTER = `// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

contract Counter {
    uint256 public count;
    uint256 public immutable step;

    constructor(uint256 step_) {
        step = step_;
    }

    function bump() external {
        count += step;
    }
}
`

function counterBundle(source = COUNTER, overrides: Partial<SourceBundle> = {}): SourceBundle {
  return {
    compilerVersion: "0.8.24+commit.e11b9ed9",
    contract: "Counter.sol:Counter",
    input: {
      language: "Solidity",
      sources: { "Counter.sol": { content: source } },
      settings: { optimizer: { enabled: true, runs: 200 } },
    },
    ...overrides,
  }
}

/** Runtime code as a deployment would leave it: the immutable filled in with a real value. */
async function deployedCounter(): Promise<Hex> {
  const { code, masks } = await compileBundle(counterBundle())
  expect(masks.length).toBeGreaterThan(0)
  const deployed = Uint8Array.from(code)
  for (const { start, length } of masks) deployed.fill(0, start, start + length).fill(0x2a, start + length - 1, start + length)
  return bytesToHex(deployed)
}

describe("verify, against code compiled here", () => {
  const check = async (bundle: SourceBundle, code?: Hex) =>
    verify({ target, bundle }, { readCode: async () => code ?? (await deployedCounter()) })

  it("fully matches the true source despite a deployed immutable", async () => {
    const result = await check(counterBundle())
    expect(result.verdict).toBe("full_match")
    expect(result.codeHash).toMatch(/^0x[0-9a-f]{64}$/)
    expect(result.details.engine).toBe("evm-solcjs")
  }, TIMEOUT)

  it("partially matches when only a comment changed", async () => {
    const result = await check(counterBundle(COUNTER.replace("contract Counter", "// harmless\ncontract Counter")))
    expect(result.verdict).toBe("partial_match")
  }, TIMEOUT)

  it("mismatches when one operator changed", async () => {
    const result = await check(counterBundle(COUNTER.replace("count += step", "count -= step")))
    expect(result.verdict).toBe("mismatch")
    expect(result.details.message).toContain("differs at byte")
  }, TIMEOUT)

  it("mismatches when compiler settings differ", async () => {
    const bundle = counterBundle()
    bundle.input.settings = { optimizer: { enabled: false, runs: 200 } }
    expect((await check(bundle)).verdict).toBe("mismatch")
  }, TIMEOUT)

  it("mismatches a source that does not compile", async () => {
    const result = await check(counterBundle(COUNTER.replace("count += step;", "count += ;")))
    expect(result.verdict).toBe("mismatch")
    expect(result.details.message).toContain("does not compile")
  }, TIMEOUT)

  it("mismatches when the named contract is not in the source", async () => {
    const result = await check(counterBundle(COUNTER, { contract: "Counter.sol:Vault" }))
    expect(result.verdict).toBe("mismatch")
    expect(result.details.message).toContain("Counter.sol:Vault")
  }, TIMEOUT)

  it("mismatches a compiler version that is not an official release", async () => {
    for (const compilerVersion of ["0.8.24+commit.deadbeef", "../../../etc/passwd", "latest"]) {
      const result = await check(counterBundle(COUNTER, { compilerVersion }))
      expect(result.verdict).toBe("mismatch")
      expect(result.details.message).toContain("not an official solc release")
    }
  }, TIMEOUT)

  it("mismatches an address without code", async () => {
    const result = await check(counterBundle(), "0x")
    expect(result.verdict).toBe("mismatch")
    expect(result.codeHash).toBe("0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470")
  }, TIMEOUT)

  it("refuses to answer when the chain cannot be read", async () => {
    const unreachable = async (): Promise<Hex> => {
      throw new Error("RPC down")
    }
    await expect(verify({ target, bundle: counterBundle() }, { readCode: unreachable })).rejects.toThrow("RPC down")
  })
})

describe("verify, against contracts deployed on Sepolia", () => {
  const readCode = rpcCodeReader()

  for (const fixture of fixtures) {
    it(`${fixture.name}: ${fixture.expected} (${fixture.covers})`, async () => {
      const contract = { chainId: SEPOLIA, address: fixture.address }
      const bundle = await fetchSourcifyBundle(contract)
      expect((await verify({ target: contract, bundle }, { readCode })).verdict).toBe(fixture.expected)
    }, TIMEOUT)
  }

  it("catches a one-token change to a real contract's source", async () => {
    const contract = { chainId: SEPOLIA, address: fixtures[0]?.address ?? "0x" }
    const bundle = await fetchSourcifyBundle(contract)
    const [file, source] = Object.entries(bundle.input.sources)[0] ?? []
    if (file === undefined || source?.content === undefined) throw new Error("fixture has no source")
    expect(source.content).toContain("block.number")
    bundle.input.sources[file] = { content: source.content.replace("block.number", "block.timestamp") }
    expect((await verify({ target: contract, bundle }, { readCode })).verdict).toBe("mismatch")
  }, TIMEOUT)
})
