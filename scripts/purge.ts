// Deletes the demo wallets' own Arkify entities about one contract: their requests, their
// attestations, and the source copies those refer to. Entities owned by anyone else are untouched.
//
//   pnpm purge-demo 11155111 0xcA11bde05977b3631167028862bE2a173976CA11           # lists what would go
//   pnpm purge-demo 11155111 0xcA11bde05977b3631167028862bE2a173976CA11 --yes     # deletes it
//
// For removing demo data that should not have been stored, for example a source whose comments
// turn out to contain personal data. Deletion removes an entity from Arkiv's state; the
// transaction that created it stays in the chain's history.
import {
  arkivHttp,
  Attr,
  decodeAll,
  decodeAttestation,
  decodeRequest,
  decodeSource,
  EntityType,
  readAll,
  requestsFor,
  SCHEMA_VERSION,
  sourcesWithAnyHash,
} from "@arkify/core"
import { createPublicClient, createWalletClient } from "@arkiv-network/sdk"
import { addr, i32, u64 } from "@arkiv-network/sdk/attr"
import { tiramisu } from "@arkiv-network/sdk/chains"
import { and, eq } from "@arkiv-network/sdk/query"
import { getAddress, type Hex, http } from "viem"
import { accountFromEnv, rpcUrl } from "./env"

const [chainId, address, flag] = process.argv.slice(2)
if (chainId === undefined || address === undefined) {
  console.error("usage: pnpm purge-demo <chainId> <address> [--yes]")
  process.exit(2)
}
const target = { chainId: BigInt(chainId), address: getAddress(address) }
const WALLETS = [
  "REQUESTER_PRIVATE_KEY",
  "VERIFIER_A_PRIVATE_KEY",
  "VERIFIER_B_PRIVATE_KEY",
  "VERIFIER_C_PRIVATE_KEY",
  "EVIL_PRIVATE_KEY",
]
const reader = createPublicClient({ chain: tiramisu, transport: arkivHttp(rpcUrl) })

// Every attestation about the address, whatever code it was about.
const attestations = decodeAll(
  await readAll(
    reader,
    and(
      eq(Attr.type, EntityType.Attestation),
      eq(Attr.schemaVersion, i32(SCHEMA_VERSION)),
      eq(Attr.chainId, u64(target.chainId)),
      eq(Attr.address, addr(target.address)),
    ),
  ),
  decodeAttestation,
)
const requests = decodeAll(await readAll(reader, requestsFor(target)), decodeRequest)
const hashes = [...new Set([...attestations, ...requests].map(({ sourceHash }) => sourceHash))]
const sources = hashes.length === 0 ? [] : decodeAll(await readAll(reader, sourcesWithAnyHash(hashes)), decodeSource)

let total = 0
for (const name of WALLETS) {
  const account = accountFromEnv(name)
  const mine: { key: Hex; what: string }[] = [
    ...requests.map((record) => ({ ...record, what: "request" })),
    ...attestations.map((record) => ({ ...record, what: `attestation (${record.verdict})` })),
    ...sources.map((record) => ({ ...record, what: `source ${record.contractName}` })),
  ]
    .filter(({ owner }) => owner === account.address)
    .map(({ key, what }) => ({ key, what }))
  if (mine.length === 0) continue
  total += mine.length
  console.log(`${account.address} owns ${mine.length}:`)
  for (const { key, what } of mine) console.log(`  ${key}  ${what}`)
  if (flag !== "--yes") continue
  const wallet = createWalletClient({ chain: tiramisu, transport: http(rpcUrl), account, pollingInterval: 1_000 })
  const { txHash } = await wallet.executeBatch({ deletes: mine.map(({ key }) => ({ entityKey: key })) })
  console.log(`  deleted in ${txHash}`)
}
console.log(
  total === 0
    ? "Nothing to delete."
    : flag === "--yes"
      ? `Deleted ${total} entities.`
      : `${total} entities would be deleted. Run again with --yes to delete them.`,
)
