// Generates the demo wallets and stores their private keys in .env (gitignored).
// Keys already present in .env are kept, so the script is safe to re-run.
// Only addresses are printed; private keys never leave .env.
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import type { Hex } from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"

const ROLES = {
  REQUESTER_PRIVATE_KEY: "requester",
  VERIFIER_A_PRIVATE_KEY: "verifier-a",
  VERIFIER_B_PRIVATE_KEY: "verifier-b",
  VERIFIER_C_PRIVATE_KEY: "verifier-c",
  EVIL_PRIVATE_KEY: "evil (demo-only dishonest verifier)",
} as const

const envPath = new URL("../.env", import.meta.url)
const examplePath = new URL("../.env.example", import.meta.url)
const lines = readFileSync(existsSync(envPath) ? envPath : examplePath, "utf8").split("\n")

for (const [name, role] of Object.entries(ROLES)) {
  const index = lines.findIndex((line) => line.startsWith(`${name}=`))
  let key = index === -1 ? "" : (lines[index] ?? "").slice(name.length + 1).trim()
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    key = generatePrivateKey()
    if (index === -1) lines.push(`${name}=${key}`)
    else lines[index] = `${name}=${key}`
  }
  console.log(`${role.padEnd(38)} ${privateKeyToAccount(key as Hex).address}`)
}

writeFileSync(envPath, lines.join("\n"), { mode: 0o600 })
chmodSync(envPath, 0o600)
