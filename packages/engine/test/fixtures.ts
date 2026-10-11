// Contracts deployed on Sepolia that the engine is tested against. Their sources are not vendored:
// the tests fetch each candidate source from Sourcify and the deployed code from a public RPC,
// then expect the engine to reach the verdict below on its own.
import type { Verdict } from "@arkify/core"
import type { Address } from "viem"

export const SEPOLIA = 11155111n

export const fixtures: { name: string; address: Address; expected: Verdict; covers: string }[] = [
  {
    name: "Multicall3",
    address: "0xcA11bde05977b3631167028862bE2a173976CA11",
    expected: "full_match",
    covers: "solc 0.8.12, one file, optimizer with 10,000,000 runs",
  },
  {
    name: "ENSRegistryWithFallback",
    address: "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e",
    expected: "full_match",
    covers: "solc 0.8.17, three files with inheritance",
  },
  {
    name: "Safe 1.4.1",
    address: "0x41675C099F32341bf84BFc5382aF534df5C7461a",
    expected: "full_match",
    covers: "solc 0.7.6, sixteen files, optimizer off",
  },
  {
    name: "WETH9",
    address: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14",
    expected: "full_match",
    covers: "solc 0.4.19 (an asm.js compiler build), Swarm metadata hash",
  },
  {
    name: "EntryPoint 0.7",
    address: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
    expected: "full_match",
    covers: "solc 0.8.23 through the IR pipeline, one immutable",
  },
  {
    name: "WETH (Uniswap deployment)",
    address: "0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9",
    expected: "partial_match",
    covers: "same executable code, different metadata hash",
  },
  {
    name: "CreateX",
    address: "0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed",
    expected: "partial_match",
    covers: "byte-identical code built with bytecodeHash none, so no metadata hash to prove the source",
  },
]
