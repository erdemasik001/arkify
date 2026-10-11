// Runs one verifier.
//
//   pnpm verifier --name verifier-a --key-env VERIFIER_A_PRIVATE_KEY
//   pnpm verifier --name evil --key-env EVIL_PRIVATE_KEY --evil      # demo only
//
// Without flags it reads VERIFIER_NAME and VERIFIER_PRIVATE_KEY, which is how a deployed instance
// is configured. The key is only ever read from the environment.
import { parseArgs } from "node:util"
import { tiramisu } from "@arkiv-network/sdk/chains"
import { config } from "dotenv"
import type { Hex } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { startVerifier } from "./verifier"

config({ quiet: true })

const { values } = parseArgs({
  options: {
    name: { type: "string" },
    "key-env": { type: "string" },
    evil: { type: "boolean", default: false },
  },
})
const keyEnv = values["key-env"] ?? "VERIFIER_PRIVATE_KEY"
const key = process.env[keyEnv]
if (key === undefined || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
  console.error(`${keyEnv} is not set to a private key. Run \`pnpm gen-wallets\` or set it in the environment.`)
  process.exit(2)
}

const verifier = await startVerifier({
  account: privateKeyToAccount(key as Hex),
  name: values.name ?? process.env.VERIFIER_NAME ?? "verifier",
  rpcUrl: process.env.ARKIV_RPC_URL ?? tiramisu.rpcUrls.default.http[0],
  wsUrl: process.env.ARKIV_WS_URL ?? tiramisu.rpcUrls.default.webSocket[0],
  evil: values.evil,
  verifyTimeoutSeconds: Number(process.env.ARKIFY_VERIFY_TIMEOUT_SECONDS ?? 180),
})

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void verifier.stop().finally(() => process.exit(0))
  })
}
