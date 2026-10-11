// Measures whether real solc standard-JSON inputs fit Arkiv's payload limit, raw and compressed.
// Inputs come from Sourcify's public API, as `chainId:address` arguments.
//
//   pnpm measure-sources
//   pnpm measure-sources 1:0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2
import { brotliCompressSync, constants, gzipSync } from "node:zlib"
import { MAX_PAYLOAD_BYTES } from "@arkiv-network/sdk/attr"

const DEFAULTS = [
  "1:0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH9
  "1:0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D", // UniswapV2Router02
  "1:0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45", // SwapRouter02
  "1:0x1F98431c8aD98523631AE4a59f267346ea31F984", // UniswapV3Factory
]

type SourcifyContract = {
  stdJsonInput: { sources: Record<string, unknown> }
  compilation: { name: string; compilerVersion: string }
}

const args = process.argv.slice(2)
const rows = []
for (const target of args.length > 0 ? args : DEFAULTS) {
  const [chainId, address] = target.split(":")
  const response = await fetch(
    `https://sourcify.dev/server/v2/contract/${chainId}/${address}?fields=stdJsonInput,compilation`,
  )
  if (!response.ok) {
    rows.push({ target, error: `HTTP ${response.status}` })
    continue
  }
  const { stdJsonInput, compilation } = (await response.json()) as SourcifyContract
  const raw = Buffer.from(JSON.stringify(stdJsonInput))
  const gzip = gzipSync(raw, { level: 9 })
  const brotli = brotliCompressSync(raw, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
      [constants.BROTLI_PARAM_SIZE_HINT]: raw.length,
    },
  })
  rows.push({
    contract: compilation.name,
    compiler: compilation.compilerVersion,
    files: Object.keys(stdJsonInput.sources).length,
    rawBytes: raw.length,
    gzipBytes: gzip.length,
    brotliBytes: brotli.length,
    fits: [raw, gzip, brotli].map((bytes) => (bytes.length <= MAX_PAYLOAD_BYTES ? "yes" : "no")).join(" / "),
  })
}
console.log(`Arkiv payload limit: ${MAX_PAYLOAD_BYTES} bytes. "fits" is raw / gzip / brotli.`)
console.table(rows)
