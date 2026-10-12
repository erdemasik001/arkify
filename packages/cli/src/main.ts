#!/usr/bin/env -S npx tsx
// arkify: read a contract's verification status straight from Arkiv. No Arkify server is involved,
// because there is none: this talks to the Arkiv RPC and to a public RPC of the contract's chain.
//
//   pnpm arkify check 11155111 0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e
//   pnpm arkify check 11155111 0x… --trusted 0xB5F1…,0xcF73… --threshold 1 --json
//
// Exit status: 0 verified, 1 not verified, 2 disputed, 3 could not answer.
import { parseArgs } from "node:util"
import {
  arkivHttp,
  computeVerdict,
  DEFAULT_THRESHOLD,
  DEFAULT_TRUSTED_VERIFIERS,
  decodeAll,
  decodeSource,
  EVM_CHAINS,
  explainError,
  fetchAttestations,
  isEvmChainId,
  readAll,
  type SourceRecord,
  sourcesWithAnyHash,
  trustedAttestations,
} from "@arkify/core"
import { createPublicClient } from "@arkiv-network/sdk"
import { tiramisu } from "@arkiv-network/sdk/chains"
import { type Address, createPublicClient as createEvmClient, getAddress, http, isAddress, keccak256 } from "viem"
import { exitCodeFor, type Report, renderJson, renderReport } from "./report"

const USAGE = `usage: arkify check <chainId> <address> [options]

  --trusted a,b,c   accounts whose attestations count (default: the three Arkify team verifiers)
  --threshold n     how many of them must match one source (default: ${DEFAULT_THRESHOLD})
  --json            print the answer as JSON

Chains: ${Object.entries(EVM_CHAINS)
  .map(([id, { name }]) => `${id} (${name})`)
  .join(", ")}
Endpoints: ARKIV_RPC_URL, SEPOLIA_RPC_URL and MAINNET_RPC_URL override the public defaults.`

function fail(message: string): never {
  console.error(message)
  process.exit(3)
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    trusted: { type: "string" },
    threshold: { type: "string" },
    json: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
})
const [command, chain, rawAddress] = positionals
if (values.help || command !== "check" || chain === undefined || rawAddress === undefined) fail(USAGE)
if (!isEvmChainId(chain)) fail(`Chain ${chain} is not one Arkify reads. ${USAGE.slice(USAGE.indexOf("Chains:"))}`)
if (!isAddress(rawAddress, { strict: false })) fail(`${rawAddress} is not a contract address.`)

const trusted: Address[] =
  values.trusted === undefined
    ? [...DEFAULT_TRUSTED_VERIFIERS]
    : values.trusted.split(",").map((entry) => {
        const candidate = entry.trim()
        if (!isAddress(candidate, { strict: false })) fail(`--trusted: ${candidate} is not an address.`)
        return getAddress(candidate)
      })
const threshold = values.threshold === undefined ? DEFAULT_THRESHOLD : Number(values.threshold)
if (!Number.isInteger(threshold) || threshold < 1) fail("--threshold must be a whole number, 1 or more.")

const address = getAddress(rawAddress)
const evmRpc = { "11155111": process.env.SEPOLIA_RPC_URL, "1": process.env.MAINNET_RPC_URL }[chain] ?? EVM_CHAINS[chain].rpc
const arkiv = createPublicClient({
  chain: tiramisu,
  transport: arkivHttp(process.env.ARKIV_RPC_URL ?? tiramisu.rpcUrls.default.http[0]),
})

try {
  const code = (await createEvmClient({ transport: http(evmRpc) }).getCode({ address })) ?? "0x"
  const target = { chainId: BigInt(chain), address, codeHash: keccak256(code) }
  const attestations = await fetchAttestations(arkiv, target, trusted)
  const all = [...attestations.trusted, ...attestations.others]
  const hashes = [...new Set(all.map(({ sourceHash }) => sourceHash))].sort()
  const sources = new Map<string, SourceRecord>()
  if (hashes.length > 0) {
    for (const record of decodeAll(await readAll(arkiv, sourcesWithAnyHash(hashes)), decodeSource)) {
      if (!sources.has(record.sourceHash.toLowerCase())) sources.set(record.sourceHash.toLowerCase(), record)
    }
  }
  const report: Report = {
    chainId: chain,
    address,
    codeHash: target.codeHash,
    codeSize: (code.length - 2) / 2,
    trusted,
    assessment: computeVerdict(all, { trusted, threshold, codeHash: target.codeHash }),
    sources,
    query: trusted.length === 0 ? undefined : trustedAttestations(target, trusted).toString(),
    now: BigInt(Math.floor(Date.now() / 1000)),
  }
  console.log(values.json ? renderJson(report) : renderReport(report))
  process.exit(report.codeSize === 0 ? 1 : exitCodeFor(report.assessment.status))
} catch (error) {
  fail(`Could not answer: ${explainError(error)}`)
}
