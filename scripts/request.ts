// Asks the verifiers to check a contract, the way the web app's Request page does: fetches a
// candidate source from Sourcify and writes the source and the request to Arkiv in one batch,
// signed by the requester wallet from .env.
//
//   pnpm request 11155111 0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e
import { arkivHttp, fetchSourcifyBundle, isEvmChainId, submitRequest } from "@arkify/core"
import { nodeBrotli } from "@arkify/engine"
import { createPublicClient, createWalletClient } from "@arkiv-network/sdk"
import { tiramisu } from "@arkiv-network/sdk/chains"
import { getAddress, http, isAddress } from "viem"
import { accountFromEnv, rpcUrl } from "./env"

const [chainId, address] = process.argv.slice(2)
if (chainId === undefined || !isEvmChainId(chainId) || address === undefined || !isAddress(address, { strict: false })) {
  console.error("usage: pnpm request <chainId> <address>")
  process.exit(2)
}
const target = { chainId: BigInt(chainId), address: getAddress(address) }
const bundle = await fetchSourcifyBundle(target)
console.log(`${bundle.contract}, solc ${bundle.compilerVersion}, ${Object.keys(bundle.input.sources).length} file(s)`)

const reader = createPublicClient({ chain: tiramisu, transport: arkivHttp(rpcUrl) })
const writer = createWalletClient({
  chain: tiramisu,
  transport: http(rpcUrl),
  account: accountFromEnv("REQUESTER_PRIVATE_KEY"),
  pollingInterval: 1_000,
})
const submitted = await submitRequest({ reader, writer }, { target, bundle, compression: nodeBrotli })
console.log(`request ${submitted.requestKey}`)
console.log(`source  ${submitted.sourceHash} (${submitted.publishedSource ? "published" : "already on Arkiv"})`)
console.log(`tx      ${submitted.txHash}`)
