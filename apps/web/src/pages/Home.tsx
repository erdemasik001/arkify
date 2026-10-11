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
import { ErrorNote, LiveIndicator, Loading, Section, Signer, VerdictChip } from "../components/ui"
import { mayBe, reader, subscribeLive } from "../lib/arkiv"
import { CHAINS, type ChainId, isChainId } from "../lib/evm"
import { dateTime, shortHex, timeAgo } from "../lib/format"
import { useRegistry } from "../lib/registry"
import { useSettings } from "../lib/settings"
import { useAsync } from "../lib/useAsync"

const EXAMPLE = { chain: "11155111", address: "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e", name: "the ENS registry on Sepolia" }

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
        <h1>Is this contract's source what it claims to be?</h1>
        <p>
          Independent verifiers re-compile a contract's source and publish what they found on Arkiv, each under its own
          signature. You choose which of them to trust, and you read their answers straight from the chain. There is no
          Arkify server to shut down, edit or lie.
        </p>
        <form className="lookup" onSubmit={lookUp}>
          <label>
            <span>Chain</span>
            <select value={chain} onChange={(event) => isChainId(event.target.value) && setChain(event.target.value)}>
              {Object.entries(CHAINS).map(([id, { name }]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="grow">
            <span>Contract address</span>
            <input
              value={address}
              onChange={(event) => {
                setAddress(event.target.value)
                setProblem(undefined)
              }}
              placeholder="0x…"
              spellCheck={false}
              autoComplete="off"
            />
          </label>
          <button type="submit" className="primary">
            Look up
          </button>
        </form>
        {problem !== undefined && <p className="inline-error">{problem}</p>}
        <p className="muted">
          Try <a href={`#/contract/${EXAMPLE.chain}/${EXAMPLE.address}`}>{EXAMPLE.name}</a>.
        </p>
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
    const since = BigInt(Math.floor(Date.now() / 1000)) - WEEK_SECONDS
    const page = await reader.select(RECORD_SELECTION).where(attestationsVerifiedSince(since)).limit(50).fetch()
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
    .slice(0, 50)
  const trusted = new Set(settings.trusted.map((address) => address.toLowerCase()))

  return (
    <Section title="Latest attestations" aside={<LiveIndicator />}>
      {error !== undefined && <ErrorNote message={error} retry={reload} />}
      {data === undefined && loading && <Loading what="recent attestations" />}
      {data !== undefined && rows.length === 0 && <p className="muted">No attestations in the last seven days.</p>}
      {rows.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Contract</th>
                <th>Signed by</th>
                <th>Verdict</th>
                <th>Verified</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className={freshKeys.has(row.key) ? "row-new" : undefined}>
                  <td>
                    <a className="mono" href={`#/contract/${row.chainId}/${row.address}`}>
                      {shortHex(row.address)}
                    </a>
                    <div className="row-note">{CHAINS[row.chainId.toString() as ChainId]?.name ?? `chain ${row.chainId}`}</div>
                  </td>
                  <td>
                    <Signer address={row.creator} registry={registry} trusted={trusted.has(row.creator.toLowerCase())} />
                  </td>
                  <td>
                    <VerdictChip verdict={row.verdict} />
                  </td>
                  <td title={dateTime(row.verifiedAt)}>{timeAgo(row.verifiedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">
        Read from Arkiv by a <code>verified_at</code> range. New rows arrive over a WebSocket subscription; nothing on this page
        polls.
      </p>
    </Section>
  )
}
