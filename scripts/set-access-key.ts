// Puts an Arkiv access key into .env by appending it to ARKIV_RPC_URL and ARKIV_WS_URL.
// The key is read from the clipboard (or the first argument), so it never has to be typed into a
// file or a chat. Any text that contains the key works: the key itself, a URL or a curl command
// copied from https://hub.arkiv.network/access-keys.
//
//   pnpm set-access-key            # after pressing a copy button on the Hub
//   pnpm set-access-key --remove   # go back to the public, keyless endpoints
import { execFileSync } from "node:child_process"
import { chmodSync, readFileSync, writeFileSync } from "node:fs"

const ENDPOINTS = {
  ARKIV_RPC_URL: "https://rpc.tiramisu.db-chain.testnet.arkiv.network",
  ARKIV_WS_URL: "wss://rpc.tiramisu.db-chain.testnet.arkiv.network",
}
const envPath = new URL("../.env", import.meta.url)

const argument = process.argv[2]
let key: string | undefined
if (argument !== "--remove") {
  const text = argument ?? execFileSync("pbpaste", { encoding: "utf8" })
  key = /ark_live_[A-Za-z0-9_-]{16,}/.exec(text)?.[0]
  if (key === undefined) {
    console.error("No access key found. Press a copy button on https://hub.arkiv.network/access-keys, then run this again.")
    process.exit(2)
  }
}

const lines = readFileSync(envPath, "utf8").split("\n")
for (const [name, base] of Object.entries(ENDPOINTS)) {
  const value = key === undefined ? base : `${base}/${key}`
  const index = lines.findIndex((line) => line.startsWith(`${name}=`))
  if (index === -1) lines.push(`${name}=${value}`)
  else lines[index] = `${name}=${value}`
}
writeFileSync(envPath, lines.join("\n"), { mode: 0o600 })
chmodSync(envPath, 0o600)
console.log(
  key === undefined
    ? "Removed the access key from .env; the public endpoints are used."
    : `Access key ${key.slice(0, 12)}…${key.slice(-3)} written to .env (ARKIV_RPC_URL, ARKIV_WS_URL).`,
)
