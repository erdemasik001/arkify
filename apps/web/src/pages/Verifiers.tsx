import { EntityType, knownVerifierName } from "@arkify/core"
import { type FormEvent, useEffect, useRef, useState } from "react"
import { type Address, getAddress, isAddress } from "viem"
import { Account, ErrorNote, LiveIndicator, Loading, Section } from "../components/ui"
import { mayBe, subscribeLive } from "../lib/arkiv"
import { expiresIn, timeAgo } from "../lib/format"
import { type Registry, useRegistry } from "../lib/registry"
import { isDefault, resetSettings, setThreshold, setTrusted, useSettings } from "../lib/settings"

export function Verifiers() {
  const settings = useSettings()
  const { registry, error, reload } = useRegistry()
  const [input, setInput] = useState("")
  const [problem, setProblem] = useState<string>()

  // A heartbeat extends a registration's lease, and the event says to which block. That is enough
  // to keep this page current without asking Arkiv again: reads are metered, events are not.
  // Only a new registration is read back.
  const [beats, setBeats] = useState(new Map<string, { expiresAt: bigint; at: bigint; head: bigint }>())
  const state = useRef({ registry, reload })
  state.current = { registry, reload }
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const stop = subscribeLive({
      onEvent: (event) => {
        if (event.type === "ExpiryExtended" && state.current.registry?.records.some(({ key }) => key === event.entityKey)) {
          const beat = { expiresAt: event.expiresAt, at: BigInt(Math.floor(Date.now() / 1000)), head: event.blockNumber }
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

  const live: Registry | undefined =
    registry === undefined
      ? undefined
      : {
          ...registry,
          head: [...beats.values()].reduce((head, beat) => (beat.head > head ? beat.head : head), registry.head),
          byCreator: new Map(
            [...registry.byCreator].map(([creator, record]) => {
              const beat = beats.get(record.key)
              return [creator, beat === undefined ? record : { ...record, expiresAt: beat.expiresAt, lastBeat: beat.at }]
            }),
          ),
        }

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

  const trusted = new Set(settings.trusted.map((address) => address.toLowerCase()))
  const others = registry?.records.filter(({ creator }) => !trusted.has(creator.toLowerCase())) ?? []

  return (
    <>
      <header className="page-head">
        <p className="eyebrow">Verifiers</p>
        <h1>Whose word counts is your decision</h1>
        <p className="muted">
          A verifier is an account. What it attests is signed by that account, and Arkiv records the signer as the entity's
          creator, which nothing can change afterwards. The name beside an address is only what that account calls itself.
          Your list stays in this browser.
        </p>
      </header>

      {error !== undefined && <ErrorNote message={error} retry={reload} />}

      <Section title="Trusted by you" aside={<LiveIndicator />}>
        {registry === undefined && error === undefined && <Loading what="the verifier registry" />}
        <VerifierTable addresses={settings.trusted} registry={live} action="remove" />
        {settings.trusted.length === 0 && <p className="muted">Nobody. Every contract will read as unverified.</p>}
        <div className="row-form">
          <label>
            <span>A source counts as verified when this many trusted verifiers match it</span>
            <input
              type="number"
              min={1}
              max={Math.max(1, settings.trusted.length)}
              value={settings.threshold}
              onChange={(event) => setThreshold(Number(event.target.value))}
            />
          </label>
          {!isDefault(settings) && (
            <button type="button" className="link-button" onClick={resetSettings}>
              Reset to the defaults
            </button>
          )}
        </div>
        {settings.threshold > settings.trusted.length && settings.trusted.length > 0 && (
          <p className="inline-error">The threshold is higher than the number of verifiers you trust, so nothing can read as verified.</p>
        )}
      </Section>

      <Section title="Other verifiers with a live registration">
        <p className="muted">
          Anyone can register. Trusting an account makes its attestations count on every contract page.
        </p>
        {others.length === 0 ? (
          <p className="muted">None right now.</p>
        ) : (
          <VerifierTable addresses={others.map(({ creator }) => creator)} registry={live} action="trust" />
        )}
        <form className="row-form" onSubmit={add}>
          <label className="grow">
            <span>Trust an account by address</span>
            <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="0x…" spellCheck={false} />
          </label>
          <button type="submit">Trust</button>
        </form>
        {problem !== undefined && <p className="inline-error">{problem}</p>}
      </Section>
    </>
  )
}

function VerifierTable({ addresses, registry, action }: { addresses: readonly Address[]; registry: Registry | undefined; action: "trust" | "remove" }) {
  if (addresses.length === 0) return null
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Account</th>
            <th>Says it is</th>
            <th>Last heartbeat</th>
            <th>Lease ends in</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {addresses.map((address) => {
            const record = registry?.byCreator.get(address.toLowerCase())
            return (
              <tr key={address}>
                <td>
                  <Account address={address} />
                </td>
                <td>
                  {record === undefined ? (
                    <span className="muted">
                      {knownVerifierName(address) !== undefined && <strong>{knownVerifierName(address)} </strong>}
                      {registry === undefined ? "…" : "offline: no live registration"}
                    </span>
                  ) : (
                    <>
                      <strong>{record.name}</strong>
                      <div className="row-note">
                        {record.engine} {record.engineVersion}
                      </div>
                    </>
                  )}
                </td>
                <td>{record === undefined ? "" : timeAgo(record.lastBeat)}</td>
                <td>{record === undefined || registry === undefined ? "" : expiresIn(record.expiresAt, registry.head)}</td>
                <td className="right">
                  <button type="button" className="link-button" onClick={() => setTrusted(address, action === "trust")}>
                    {action}
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
