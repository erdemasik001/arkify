// Reads deployed bytecode from EVM chains over public JSON-RPC.
import type { Target } from "@arkify/core"
import { createPublicClient, type Hex, http } from "viem"

/** Returns the runtime bytecode at a contract address, `0x` if there is none. */
export type CodeReader = (target: Target) => Promise<Hex>

export class UnsupportedChainError extends Error {
  constructor(readonly chainId: bigint) {
    super(`No RPC endpoint is configured for chain ${chainId}.`)
    this.name = "UnsupportedChainError"
  }
}

/** Chain IDs mapped to RPC URLs, from the environment: Sepolia and Ethereum mainnet. */
export function rpcUrlsFromEnv(env: Record<string, string | undefined> = process.env) {
  return {
    "11155111": env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com",
    "1": env.MAINNET_RPC_URL ?? "https://ethereum-rpc.publicnode.com",
  }
}

export function rpcCodeReader(rpcUrls: Record<string, string> = rpcUrlsFromEnv()): CodeReader {
  const clients = new Map<string, ReturnType<typeof createPublicClient>>()
  return async ({ chainId, address }) => {
    const url = rpcUrls[chainId.toString()]
    if (url === undefined) throw new UnsupportedChainError(chainId)
    let client = clients.get(url)
    if (client === undefined) {
      client = createPublicClient({ transport: http(url) })
      clients.set(url, client)
    }
    return (await client.getCode({ address })) ?? "0x"
  }
}
