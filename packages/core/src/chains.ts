// The EVM chains Arkify reads deployed bytecode from, and the public endpoints it uses by default.
export const EVM_CHAINS = {
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

export type EvmChainId = keyof typeof EVM_CHAINS
export const isEvmChainId = (value: string): value is EvmChainId => value in EVM_CHAINS
