// Shared .env access for the scripts. Private keys are read here and nowhere else.
import { tiramisu } from "@arkiv-network/sdk/chains"
import { config } from "dotenv"
import type { Hex } from "viem"
import { privateKeyToAccount } from "viem/accounts"

config({ quiet: true })

export const rpcUrl = process.env.ARKIV_RPC_URL ?? tiramisu.rpcUrls.default.http[0]
export const wsUrl = process.env.ARKIV_WS_URL ?? tiramisu.rpcUrls.default.webSocket[0]

export function accountFromEnv(name: string) {
  const value = process.env[name]
  if (value === undefined || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${name} is missing from .env. Run \`pnpm gen-wallets\` first.`)
  }
  return privateKeyToAccount(value as Hex)
}
