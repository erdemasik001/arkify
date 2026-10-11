// Reads deployed bytecode from the EVM chain a contract lives on, over a public RPC.
import { type Address, createPublicClient, type Hex, http, keccak256 } from "viem"

export const CHAINS = {
  "11155111": {
    name: "Sepolia",
    rpc: "https://ethereum-sepolia-rpc.publicnode.com",
    explorer: "https://sepolia.etherscan.io",
  },
  "1": {
    name: "Ethereum",
    rpc: "https://ethereum-rpc.publicnode.com",
    explorer: "https://etherscan.io",
  },
} as const

export type ChainId = keyof typeof CHAINS
export const isChainId = (value: string): value is ChainId => value in CHAINS

const clients = new Map<string, ReturnType<typeof createPublicClient>>()

/** The hash of the code deployed right now. Attestations about any other code do not apply. */
export async function readCodeHash(chainId: ChainId, address: Address): Promise<{ codeHash: Hex; size: number }> {
  const { rpc } = CHAINS[chainId]
  let client = clients.get(rpc)
  if (client === undefined) {
    client = createPublicClient({ transport: http(rpc) })
    clients.set(rpc, client)
  }
  const code = (await client.getCode({ address })) ?? "0x"
  return { codeHash: keccak256(code), size: (code.length - 2) / 2 }
}

export function codeHashCurl(chainId: ChainId, address: Address): string {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getCode", params: [address, "latest"] })
  return `curl -s ${CHAINS[chainId].rpc} -H 'content-type: application/json' --data '${body}'`
}
