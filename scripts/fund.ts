// Tops up the other demo wallets from the requester wallet, so one faucet claim funds them all.
// Claim testnet GLM at https://hub.arkiv.network/faucet, get it to the requester address, then:
//
//   pnpm fund          # top each wallet up to a fifth of the requester's balance
//   pnpm fund 0.5      # top each wallet up to 0.5 GLM
import { createWalletClient } from "@arkiv-network/sdk"
import { tiramisu } from "@arkiv-network/sdk/chains"
import { formatEther, http, parseEther } from "viem"
import { getBalance } from "viem/actions"
import { accountFromEnv, rpcUrl } from "./env"

const OTHERS = [
  "VERIFIER_A_PRIVATE_KEY",
  "VERIFIER_B_PRIVATE_KEY",
  "VERIFIER_C_PRIVATE_KEY",
  "EVIL_PRIVATE_KEY",
]

const client = createWalletClient({
  chain: tiramisu,
  transport: http(rpcUrl),
  account: accountFromEnv("REQUESTER_PRIVATE_KEY"),
  pollingInterval: 1_000,
})
const requester = client.account.address
const available = await getBalance(client, { address: requester })
const amount = process.argv[2]
const target = amount === undefined ? available / 5n : parseEther(amount)
if (target === 0n) {
  console.error(`The requester wallet ${requester} is empty. Fund it first.`)
  process.exit(2)
}

console.log(`requester ${requester} has ${formatEther(available)} GLM`)
for (const name of OTHERS) {
  const to = accountFromEnv(name).address
  const balance = await getBalance(client, { address: to })
  if (balance >= target) {
    console.log(`${to} already has ${formatEther(balance)} GLM`)
    continue
  }
  const hash = await client.sendTransaction({ to, value: target - balance })
  await client.waitForTransactionReceipt({ hash })
  console.log(`${to} +${formatEther(target - balance)} GLM (${hash})`)
}
