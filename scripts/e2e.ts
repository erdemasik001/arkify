// End-to-end run on Tiramisu and Sepolia: three honest verifiers and one dishonest one, a real
// contract (the ENS registry on Sepolia), its true source and a tampered copy. The contract was
// picked because its source carries no author names or e-mail addresses: sources are stored on
// Arkiv byte for byte, so the demo only stores ones without personal data.
//
//   pnpm e2e
//
// The attestations it leaves behind are true statements by the project's verifier wallets, plus the
// dishonest verifier's claims, which is exactly the data the demo shows.
import { type ChildProcess, spawn } from "node:child_process"
import {
  arkivHttp,
  computeVerdict,
  decodeAll,
  decodeSource,
  decodeVerifier,
  fetchAttestations,
  fetchSourcifyBundle,
  packSource,
  readAll,
  type SourceBundle,
  Status,
  sourcesWithHash,
  submitRequest,
  verifiers,
} from "@arkify/core"
import { nodeBrotli, rpcCodeReader } from "@arkify/engine"
import { createPublicClient, createWalletClient } from "@arkiv-network/sdk"
import { tiramisu } from "@arkiv-network/sdk/chains"
import { http, keccak256 } from "viem"
import { accountFromEnv, rpcUrl } from "./env"

const target = { chainId: 11155111n, address: "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e" } as const
/** The one-token change the tampered copy makes: who is allowed to change a record. */
const TAMPER = { from: "owner == msg.sender", to: "owner == tx.origin" }
const INSTANCES = [
  { name: "verifier-a", keyEnv: "VERIFIER_A_PRIVATE_KEY", evil: false },
  { name: "verifier-b", keyEnv: "VERIFIER_B_PRIVATE_KEY", evil: false },
  { name: "verifier-c", keyEnv: "VERIFIER_C_PRIVATE_KEY", evil: false },
  { name: "evil", keyEnv: "EVIL_PRIVATE_KEY", evil: true },
]
const honest = INSTANCES.filter(({ evil }) => !evil).map(({ keyEnv }) => accountFromEnv(keyEnv).address)
const evil = accountFromEnv("EVIL_PRIVATE_KEY").address

const reader = createPublicClient({ chain: tiramisu, transport: arkivHttp(rpcUrl) })
const writer = createWalletClient({
  chain: tiramisu,
  transport: http(rpcUrl),
  account: accountFromEnv("REQUESTER_PRIVATE_KEY"),
  pollingInterval: 1_000,
})

const lines: string[] = []
const children: ChildProcess[] = []
function launch({ name, keyEnv, evil: dishonest }: (typeof INSTANCES)[number]): void {
  const args = ["exec", "tsx", "packages/verifier/src/main.ts", "--name", name, "--key-env", keyEnv]
  const child = spawn("pnpm", dishonest ? [...args, "--evil"] : args, { stdio: ["ignore", "pipe", "pipe"] })
  const record = (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n").filter(Boolean)) {
      lines.push(line)
      console.log(`    ${line}`)
    }
  }
  child.stdout?.on("data", record)
  child.stderr?.on("data", record)
  children.push(child)
}
const stopAll = () => children.forEach((child) => child.kill("SIGTERM"))

async function waitForLines(what: string, pattern: RegExp, count: number, timeoutMs: number): Promise<string[]> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const matching = lines.filter((line) => pattern.test(line))
    if (matching.length >= count) return matching
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what} (${matching.length}/${count})`)
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

let passed = 0
function check(condition: boolean, what: string): void {
  if (!condition) throw new Error(`FAILED: ${what}`)
  passed++
  console.log(`ok  ${what}`)
}

async function request(label: string, bundle: SourceBundle) {
  const submitted = await submitRequest({ reader, writer }, { target, bundle, compression: nodeBrotli })
  console.log(`\n${label}: request ${submitted.requestKey} (source ${submitted.publishedSource ? "published" : "already on Arkiv"})`)
  const handled = new RegExp(`request ${submitted.requestKey.slice(0, 10)}… (attested|extended)`)
  const outcomes = await waitForLines(`all verifiers to answer the ${label}`, handled, INSTANCES.length, 180_000)
  return { ...submitted, outcomes }
}

try {
  console.log("starting verifiers")
  for (const instance of INSTANCES) {
    launch(instance)
    await new Promise((resolve) => setTimeout(resolve, 1_500))
  }
  await waitForLines("verifiers to be ready", /ready as 0x/, INSTANCES.length, 120_000)

  const genuine = await fetchSourcifyBundle(target)
  const [file, source] =
    Object.entries(genuine.input.sources).find(([, { content }]) => content?.includes(TAMPER.from)) ?? []
  if (file === undefined || source?.content === undefined) throw new Error("no source to tamper with")
  const tampered: SourceBundle = {
    ...genuine,
    input: {
      ...genuine.input,
      sources: { ...genuine.input.sources, [file]: { content: source.content.replace(TAMPER.from, TAMPER.to) } },
    },
  }
  const tamperedHash = (await packSource(tampered, nodeBrotli)).sourceHash

  const first = await request("true source", genuine)
  const second = await request("tampered source", tampered)
  const again = await request("true source, asked again", genuine)
  check(
    again.outcomes.every((line) => line.includes("extended")),
    "a repeated request extends the existing attestations instead of duplicating them",
  )
  check(!again.publishedSource, "the repeated request reused the source already on Arkiv")

  console.log("\nreading the result back from Arkiv")
  const codeHash = keccak256(await rpcCodeReader()(target))
  const lookup = { ...target, codeHash }
  const trusting = await fetchAttestations(reader, lookup, honest)
  check(trusting.trusted.length === 6, "three honest verifiers wrote exactly two attestations each")
  check(
    trusting.others.length === 2 && trusting.others.every(({ creator }) => creator === evil),
    "the dishonest verifier's two attestations come back only in the untrusted set",
  )

  const verdict = computeVerdict([...trusting.trusted, ...trusting.others], { trusted: honest })
  check(verdict.status === Status.Verified, "trusting the honest verifiers: verified")
  check(
    verdict.decisive?.sourceHash === first.sourceHash && verdict.decisive.match === "full" && verdict.decisive.matches.length === 3,
    "the true source is a full match for all three",
  )
  const judgedTampered = verdict.sources.find(({ sourceHash }) => sourceHash === tamperedHash)
  check(
    judgedTampered?.status === Status.Mismatch && judgedTampered.mismatches.length === 3,
    "the tampered source is a mismatch for all three",
  )
  check(second.sourceHash === tamperedHash, "the tampered request named the tampered source")

  const gullible = computeVerdict([...trusting.trusted, ...trusting.others], { trusted: [...honest, evil] })
  check(
    gullible.status === Status.Disputed && gullible.decisive?.sourceHash === tamperedHash,
    "also trusting the dishonest verifier: disputed, over the tampered source",
  )

  const copies = decodeAll(await readAll(reader, sourcesWithHash(first.sourceHash)), decodeSource)
  check(
    honest.every((address) => copies.some(({ creator }) => creator === address)),
    "each honest verifier holds its own copy of the source it matched",
  )
  check(
    trusting.trusted
      .filter(({ sourceHash }) => sourceHash === first.sourceHash)
      .every((attestation) => copies.find(({ key }) => key === attestation.sourceKey)?.creator === attestation.creator),
    "each match points at the verifier's own copy",
  )

  const registry = decodeAll(await readAll(reader, verifiers()), decodeVerifier)
  check(
    INSTANCES.every(({ name, keyEnv }) =>
      registry.some((record) => record.name === name && record.creator === accountFromEnv(keyEnv).address),
    ),
    "all four verifiers hold a live registration",
  )

  console.log(`\n${passed} checks passed.`)
} finally {
  stopAll()
}
process.exit(0)
