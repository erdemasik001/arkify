import { EntityType, knownVerifierName, Lifetime, type VerifierRecord } from "@arkify/core"
import { type FormEvent, useEffect, useRef, useState } from "react"
import { type Address, getAddress, isAddress } from "viem"
import { Account, Avatar, Card, ErrorNote, Icon, LiveIndicator, Loading } from "../components/ui"
import { BLOCK_SECONDS, mayBe, subscribeLive } from "../lib/arkiv"
import { timeAgo } from "../lib/format"
import { useRegistry } from "../lib/registry"
import { isDefault, resetSettings, setThreshold, setTrusted, useSettings } from "../lib/settings"

const LEASE_BLOCKS = Number(Lifetime.verifierLease.minLifetime)

export function Verifiers() {
  const settings = useSettings()
  const { registry, error, reload } = useRegistry()
  const [input, setInput] = useState("")
  const [problem, setProblem] = useState<string>()

  // A heartbeat extends a registration's lease, and the event says to which block. That is enough
  // to keep this page current without asking Arkiv again: reads are metered, events are not.
  // Only a new registration is read back.
  const [beats, setBeats] = useState(new Map<string, { expiresAt: bigint; at: bigint }>())
  const [head, setHead] = useState<bigint>()
  const state = useRef({ registry, reload })
  state.current = { registry, reload }
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const stop = subscribeLive({
      onEvent: (event) => {
        setHead((previous) => (previous === undefined || event.blockNumber > previous ? event.blockNumber : previous))
        if (event.type === "ExpiryExtended" && state.current.registry?.records.some(({ key }) => key === event.entityKey)) {
          const beat = { expiresAt: event.expiresAt, at: BigInt(Math.floor(Date.now() / 1000)) }
          setBeats((previous) => new Map(previous).set(event.entityKey, beat))
        }
        if (event.type === "EntityCreated" && mayBe(EntityType.Verifier, event)) {
          clearTimeout(timer)
          timer = setTimeout(() => state.current.reload(), 1_500)
        }
      },
    })
    return () => {
      clearTimeout(timer)
      stop()
    }
  }, [])

  function add(event: FormEvent) {
    event.preventDefault()
    const trimmed = input.trim()
    if (!isAddress(trimmed, { strict: false })) {
      setProblem("That is not an address.")
      return
    }
    setTrusted(getAddress(trimmed), true)
    setInput("")
    setProblem(undefined)
  }

  const currentHead = registry === undefined ? undefined : head !== undefined && head > registry.head ? head : registry.head
  const recordOf = (address: Address): VerifierRecord | undefined => {
    const record = registry?.byCreator.get(address.toLowerCase())
    const beat = record === undefined ? undefined : beats.get(record.key)
    return record === undefined || beat === undefined ? record : { ...record, expiresAt: beat.expiresAt, lastBeat: beat.at }
  }
  const trusted = new Set(settings.trusted.map((address) => address.toLowerCase()))
  const others = registry?.records.filter(({ creator }) => !trusted.has(creator.toLowerCase())).map(({ creator }) => creator) ?? []
  const choices = Array.from({ length: Math.max(1, settings.trusted.length) }, (_, index) => index + 1)

  return (
    <>
      <header className="page-head">
        <span className="eyebrow">Verifiers</span>
        <h1>Whose word counts is your decision</h1>
        <p className="lede">
          A verifier is an account. Arkiv records which account created every attestation, and nothing can change that
          afterwards. The name on a card is only what that account calls itself. Your choices stay in this browser.
        </p>
      </header>

      {error !== undefined && <ErrorNote message={error} retry={reload} />}

      <Card title="Trusted by you" icon="shieldCheck" aside={<LiveIndicator />}>
        {registry === undefined && error === undefined && <Loading />}
        <div className="grid-cards">
          {settings.trusted.map((address) => (
            <VerifierCard key={address} address={address} record={recordOf(address)} head={currentHead} trusted />
          ))}
        </div>
        {settings.trusted.length === 0 && <p className="empty">Nobody. Every contract will read as unverified.</p>}
        <div className="form-row meter">
          <div className="field">
            <span>A source is verified when this many trusted verifiers match it</span>
            <div className="segmented" role="group" aria-label="Threshold">
              {choices.map((value) => (
                <button type="button" key={value} aria-pressed={settings.threshold === value} onClick={() => setThreshold(value)}>
                  {value}
                </button>
              ))}
            </div>
          </div>
          {!isDefault(settings) && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={resetSettings}>
              Reset to the defaults
            </button>
          )}
        </div>
        {settings.threshold > settings.trusted.length && settings.trusted.length > 0 && (
          <p className="error-text">The threshold is higher than the number of verifiers you trust, so nothing can read as verified.</p>
        )}
      </Card>

      <Card title="Other verifiers with a live registration" icon="users">
        <p className="muted">Anyone can register. Trusting an account makes its attestations count on every contract page.</p>
        {others.length === 0 ? (
          <p className="empty">None right now.</p>
        ) : (
          <div className="grid-cards">
            {others.map((address) => (
              <VerifierCard key={address} address={address} record={recordOf(address)} head={currentHead} trusted={false} />
            ))}
          </div>
        )}
        <form className="form-row meter" onSubmit={add}>
          <label className="field grow">
            <span>Trust an account by address</span>
            <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="0x…" spellCheck={false} />
          </label>
          <button type="submit" className="btn">
            Trust
          </button>
        </form>
        {problem !== undefined && <p className="error-text">{problem}</p>}
      </Card>
    </>
  )
}

/**
 * One verifier. The bar is its lease: the registration expires fifteen minutes after the last
 * heartbeat, and every heartbeat event fills the bar again. An empty bar is a verifier that died.
 */
function VerifierCard({
  address,
  record,
  head,
  trusted,
}: {
  address: Address
  record: VerifierRecord | undefined
  head: bigint | undefined
  trusted: boolean
}) {
  const name = record?.name ?? knownVerifierName(address)
  const blocksLeft = record === undefined || head === undefined ? 0 : Math.max(0, Number(record.expiresAt - head))
  const online = record !== undefined && blocksLeft > 0
  const minutes = Math.ceil((blocksLeft * BLOCK_SECONDS) / 60)
  return (
    <div className={trusted ? "vcard is-trusted" : "vcard"}>
      <div className="vcard-top">
        <Avatar address={address} />
        <div className="row-text">
          <div className="vcard-name">{name ?? "Unnamed account"}</div>
          <div className="row-sub">
            <Account address={address} />
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={trusted}
          aria-label={`Trust ${name ?? address}`}
          className="switch"
          onClick={() => setTrusted(address, !trusted)}
        />
      </div>
      <div className="vcard-facts">
        <div className="fact">
          <span>Status</span>
          <b>
            <span className={online ? "dot dot-on" : "dot"} />
            {online ? "Online" : "Offline"}
          </b>
        </div>
        <div className="fact">
          <span>Last heartbeat</span>
          <b>{record === undefined ? "none on Arkiv" : timeAgo(record.lastBeat)}</b>
        </div>
      </div>
      <div>
        <div className="lease" role="img" aria-label={online ? `Lease ends in ${minutes} minutes` : "No live lease"}>
          <i style={{ width: `${Math.min(100, (blocksLeft / LEASE_BLOCKS) * 100)}%` }} />
        </div>
        <div className="lease-caption">
          <span>{record === undefined ? "No registration on Arkiv" : `${record.engine} ${record.engineVersion}`}</span>
          <span>{online ? `lease ends in ${minutes} min` : "lease expired"}</span>
        </div>
      </div>
    </div>
  )
}
