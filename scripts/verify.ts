// Runs the verification engine once, without touching Arkiv: fetches a candidate source from
// Sourcify, compiles it and compares it with the code on chain.
//
//   pnpm verify 11155111 0xcA11bde05977b3631167028862bE2a173976CA11
import { fetchSourcifyBundle } from "@arkify/core"
import { rpcCodeReader, verify } from "@arkify/engine"
import { getAddress } from "viem"
import "./env"

const [chainId, address] = process.argv.slice(2)
if (chainId === undefined || address === undefined) {
  console.error("usage: pnpm verify <chainId> <address>")
  process.exit(2)
}
const target = { chainId: BigInt(chainId), address: getAddress(address) }
const bundle = await fetchSourcifyBundle(target)
console.log(`${bundle.contract}  solc ${bundle.compilerVersion}  ${Object.keys(bundle.input.sources).length} file(s)`)
const result = await verify({ target, bundle }, { readCode: rpcCodeReader() })
console.log(JSON.stringify(result, null, 2))
