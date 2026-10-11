import {
  type AttestationRecord,
  attestationsVerifiedSince,
  decodeAll,
  decodeAttestation,
  EntityType,
  RECORD_SELECTION,
} from "@arkify/core"
import { type FormEvent, useEffect, useState } from "react"
import { getAddress, isAddress } from "viem"
import { Card, ErrorNote, Icon, LiveIndicator, Loading, Signer, VerdictChip } from "../components/ui"
import { mayBe, reader, subscribeLive } from "../lib/arkiv"
import { CHAIN_IDS, CHAINS, type ChainId } from "../lib/evm"
import { dateTime, shortHex, timeAgo } from "../lib/format"
import { useRegistry } from "../lib/registry"
import { useSettings } from "../lib/settings"
import { useAsync } from "../lib/useAsync"

const EXAMPLES = [
  { label: "ENS registry", chain: "11155111", address: "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e" },
  { label: "A contract nobody has checked", chain: "11155111", address: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14" },
]

export function Home() {
  const [chain, setChain] = useState<ChainId>("11155111")
  const [address, setAddress] = useState("")
  const [problem, setProblem] = useState<string>()

  function lookUp(event: FormEvent) {
    event.preventDefault()
    const trimmed = address.trim()
    if (!isAddress(trimmed, { strict: false })) {
      setProblem("That is not a contract address. It should be 0x followed by 40 hex characters.")
      return
    }
    window.location.hash = `#/contract/${chain}/${getAddress(trimmed)}`
  }

  return (
    <>
      <header className="hero">
        <span className="eyebrow-pill">
          <span className="dot dot-on" />
          Source verification with no server to trust
        </span>
        <h1>
          Is this contract's source <span className="gradient-text">what it claims to be?</span>
        </h1>
        <p className="hero-sub">
          Independent verifiers re-compile a contract and sign what they find on Arkiv. You pick whose word counts, and
          read the answers straight from the chain.
        </p>
        <form className="search" onSubmit={lookUp}>
          <div className="segmented" role="group" aria-label="Chain">
            {CHAIN_IDS.map((id) => (
              <button type="button" key={id} aria-pressed={chain === id} onClick={() => setChain(id)}>
                {CHAINS[id].name}
              </button>
            ))}
          </div>
          <input
            value={address}
            onChange={(event) => {
              setAddress(event.target.value)
              setProblem(undefined)
            }}
            placeholder="Contract address, 0x…"
            aria-label="Contract address"
            spellCheck={false}
            autoComplete="off"
          />
          <button type="submit" className="btn btn-primary">
            Look up
            <Icon name="arrow" />
          </button>
        </form>
        {problem !== undefined && <p className="hero-hint error-text">{problem}</p>}
        <div className="hero-hint">
          Try
          {EXAMPLES.map(({ label, chain: id, address: example }) => (
            <a key={example} className="chip-link" href={`#/contract/${id}/${example}`}>
              {label}
            </a>
          ))}
        </div>

        <div className="pillars">
          <div className="pillar">
            <span className="pillar-icon">
              <Icon name="users" />
            </span>
            <h3>Many verifiers, not one</h3>
            <p>Each one compiles the source itself and compares it with the code on chain. No single party hands out the badge.</p>
          </div>
          <div className="pillar">
            <span className="pillar-icon">
              <Icon name="pen" />
            </span>
            <h3>Signed, and filtered by signer</h3>
            <p>
              Arkiv records who created every attestation. You see only what the accounts you trust signed; nobody can forge
              the rest.
            </p>
          </div>
          <div className="pillar">
            <span className="pillar-icon">
              <Icon name="terminal" />
            </span>
            <h3>Readable without us</h3>
            <p>This site is static files. Every page prints the query that produced it, so the answer outlives the site.</p>
          </div>
        </div>
      </header>
      <LiveFeed />
    </>
  )
}

const WEEK_SECONDS = 7n * 24n * 60n * 60n

function LiveFeed() {
  const settings = useSettings()
  const { registry } = useRegistry()
  const [fresh, setFresh] = useState<AttestationRecord[]>([])
  const { data, error, loading, reload } = useAsync(async () => {
    // Rounded to the hour so that coming back to this page repeats the same query.
    const now = Math.floor(Date.now() / 3_600_000) * 3_600
    const page = await reader.select(RECORD_SELECTION).where(attestationsVerifiedSince(BigInt(now) - WEEK_SECONDS)).limit(50).fetch()
    return decodeAll(page.entities, decodeAttestation)
  }, [])

  // New attestations arrive over the WebSocket subscription; nothing here polls.
  useEffect(
    () =>
      subscribeLive({
        onCreated: (event) => {
          if (!mayBe(EntityType.Attestation, event)) return
          void reader.getEntity(event.entityKey).then((entity) => {
            const record = decodeAttestation(entity)
            if (record !== undefined) setFresh((previous) => [record, ...previous.filter(({ key }) => key !== record.key)])
          }, () => undefined)
        },
      }),
    [],
  )

  const freshKeys = new Set(fresh.map(({ key }) => key))
  const rows = [...fresh, ...(data ?? []).filter(({ key }) => !freshKeys.has(key))]
    .sort((a, b) => Number(b.verifiedAt - a.verifiedAt))
    .slice(0, 12)
  const trusted = new Set(settings.trusted.map((address) => address.toLowerCase()))

  return (
    <Card title="Latest attestations" icon="radio" aside={<LiveIndicator />}>
      {error !== undefined && <ErrorNote message={error} retry={reload} />}
      {data === undefined && loading && <Loading rows={4} />}
      {data !== undefined && rows.length === 0 && <p className="empty">No attestations in the last seven days.</p>}
      <div className="rows">
        {rows.map((row) => (
          <div key={row.key} className={freshKeys.has(row.key) ? "row row-new" : "row"}>
            <Signer address={row.creator} registry={registry} trusted={trusted.has(row.creator.toLowerCase())} />
            <div className="row-mid">
              <VerdictChip verdict={row.verdict} />
              <a className="mono muted" href={`#/contract/${row.chainId}/${row.address}`} title={row.address}>
                {shortHex(row.address)}
              </a>
            </div>
            <div className="row-end">
              <span>{CHAINS[row.chainId.toString() as ChainId]?.name ?? `chain ${row.chainId}`}</span>
              <span title={dateTime(row.verifiedAt)}>{timeAgo(row.verifiedAt)}</span>
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}
