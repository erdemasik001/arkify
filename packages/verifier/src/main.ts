// Runs one verifier.
//
//   pnpm verifier --name verifier-a --key-env VERIFIER_A_PRIVATE_KEY
//   pnpm verifier --name evil --key-env EVIL_PRIVATE_KEY --evil      # demo only
//
// Without flags it reads VERIFIER_NAME and VERIFIER_PRIVATE_KEY (and VERIFIER_EVIL=1 for the demo
// instance), which is how a deployed instance is configured. The key is only ever read from the
// environment.
import { parseArgs } from "node:util"
import { budgetErrorOf } from "@arkify/core"
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

const name = values.name ?? process.env.VERIFIER_NAME ?? "verifier"
const start = () =>
  startVerifier({
    account: privateKeyToAccount(key as Hex),
    name,
    rpcUrl: process.env.ARKIV_RPC_URL ?? tiramisu.rpcUrls.default.http[0],
    wsUrl: process.env.ARKIV_WS_URL ?? tiramisu.rpcUrls.default.webSocket[0],
    evil: values.evil || process.env.VERIFIER_EVIL === "1",
    verifyTimeoutSeconds: Number(process.env.ARKIFY_VERIFY_TIMEOUT_SECONDS ?? 180),
    verifyMemoryMb: Number(process.env.ARKIFY_VERIFY_MEMORY_MB ?? 768),
  })

// Start-up reads Arkiv. If the RPC has paused this address's reads, wait for it rather than exit.
let verifier: Awaited<ReturnType<typeof start>>
for (;;) {
  try {
    verifier = await start()
    break
  } catch (error) {
    const budget = budgetErrorOf(error)
    if (budget === undefined) throw error
    console.log(`[${name}] reads paused by the RPC; starting in ${budget.retryAfterSeconds} s`)
    await new Promise((resolve) => setTimeout(resolve, (budget.retryAfterSeconds + 5) * 1000))
  }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void verifier.stop().finally(() => process.exit(0))
  })
}
