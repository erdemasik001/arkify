import {
  type AttestationRecord,
  attestationsVerifiedSince,
  decodeAll,
  decodeAttestation,
  EntityType,
  knownVerifierName,
  RECORD_SELECTION,
  Verdict,
} from "@arkify/core"
import { type FormEvent, type ReactNode, useEffect, useState } from "react"
import { getAddress, isAddress } from "viem"
import { Rosette } from "../components/Rosette"
import { Avatar, ErrorNote, Icon, type IconName, LiveIndicator, VerdictChip } from "../components/ui"
import { mayBe, reader, subscribeLive } from "../lib/arkiv"
import { CHAIN_IDS, CHAINS, type ChainId } from "../lib/evm"
import { dateTime, shortHex, timeAgo } from "../lib/format"
import { type Registry, useRegistry } from "../lib/registry"
import { useSettings } from "../lib/settings"
import { useAsync } from "../lib/useAsync"

const REPOSITORY = "https://github.com/erdemasik001/arkify"

const EXAMPLES = [
  { label: "ENS registry", chain: "11155111", address: "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e" },
  { label: "A contract nobody has checked", chain: "11155111", address: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14" },
]

const BUILT_ON: { icon: IconName; label: string }[] = [
  { icon: "chain", label: "Arkiv" },
  { icon: "cube", label: "Ethereum" },
  { icon: "layers", label: "Sepolia" },
  { icon: "code", label: "Solidity compiler" },
  { icon: "file", label: "Sourcify import" },
]

const FEATURES: { icon: IconName; title: string; text: string }[] = [
  {
    icon: "users",
    title: "Many verifiers, not one",
    text: "Each one compiles the source itself and compares it with the code on chain. No single party hands out the badge.",
  },
  {
    icon: "pen",
    title: "Signed, filtered by signer",
    text: "Arkiv records who created every attestation. Only the accounts you trust are counted; nobody can forge the rest.",
  },
  {
    icon: "terminal",
    title: "Readable without us",
    text: "This site is static files. Every page prints the query that produced it, so the answer outlives the site.",
  },
]

const STEPS: { icon: IconName; title: string; text: string }[] = [
  {
    icon: "upload",
    title: "Someone submits a source",
    text: "The request and the source go to Arkiv in one transaction. The source is stored under the hash of its content, so everyone refers to the same bytes.",
  },
  {
    icon: "cpu",
    title: "Verifiers recompile on their own",
    text: "Each verifier hears the request from Arkiv's event stream, builds the source with the official compiler and compares the result with the code on Ethereum.",
  },
  {
    icon: "eye",
    title: "You read the signed answers",
    text: "Every verifier writes an attestation from its own account. Your browser asks Arkiv for the ones signed by accounts you trust, and counts them.",
  },
]

const QUESTIONS: { question: string; answer: ReactNode }[] = [
  {
    question: "Who decides that a contract is verified?",
    answer: (
      <>
        You do. Nobody here hands out a badge. A contract reads as verified when enough of the verifiers you trust have each
        compiled the same source and got the deployed code. The list and the threshold are yours, and they stay in your
        browser.{" "}
        <a className="link" href="#/verifiers">
          Choose your verifiers
        </a>
      </>
    ),
  },
  {
    question: "What stops someone from faking an attestation?",
    answer:
      "Every Arkiv entity carries the account that created it. The chain sets that field and nothing can change it afterwards. Arkify filters on it, so an attestation from an account you do not trust is shown as untrusted and never counted, whatever it claims inside.",
  },
  {
    question: "What happens if this website disappears?",
    answer:
      "Nothing is lost. The site is static files with no backend; the attestations and the sources are on Arkiv. Every contract page prints the exact query behind its answer, and the command-line checker in the repository asks the same question without a browser.",
  },
  {
    question: "What does “disputed” mean?",
    answer:
      "Two verifiers you trust disagree about the same source: one says it matches the deployed code, another says it does not. One of them is wrong, so the contract is not shown as verified until you decide whom to believe.",
  },
  {
    question: "How long does an answer stay on Arkiv?",
    answer:
      "An attestation is stored for 90 days and a source for 180. Neither needs Arkify to survive: anyone who relies on one can extend its lifetime from a wallet, and only its creator can change it.",
  },
  {
    question: "Can I run a verifier?",
    answer: (
      <>
        Yes. A verifier is one container and one funded Arkiv account. It listens for requests, compiles with the official
        Solidity compiler and signs what it finds. Nobody approves you; people decide for themselves whether your account
        counts.{" "}
        <a className="link" href={REPOSITORY} target="_blank" rel="noreferrer">
          The code is on GitHub
        </a>
      </>
    ),
  },
]

/** What a verdict says about the source, in a sentence. */
const SAYS: Record<Verdict, string> = {
  [Verdict.FullMatch]: "The source compiles to exactly the code deployed here, metadata hash included.",
  [Verdict.PartialMatch]: "The source compiles to the same executable code. The exact files are not proven.",
  [Verdict.Mismatch]: "The submitted source does not compile to the code deployed here.",
  [Verdict.Error]: "The check could not be completed, so this says nothing about the source.",
}

const WEEK_SECONDS = 7n * 24n * 60n * 60n
const FEED_LIMIT = 50
const SHOWN = 8

function SectionHead({ tag, title, children }: { tag: string; title: string; children?: ReactNode }) {
  return (
    <div className="section-head">
      <span className="tag">{tag}</span>
      <h2>{title}</h2>
      {children !== undefined && <p>{children}</p>}
    </div>
  )
}

export function Home() {
  const [chain, setChain] = useState<ChainId>("11155111")
  const [address, setAddress] = useState("")
  const [problem, setProblem] = useState<string>()
  const settings = useSettings()
  const { registry } = useRegistry()
  const feed = useFeed()

  function lookUp(event: FormEvent) {
    event.preventDefault()
    const trimmed = address.trim()
    if (!isAddress(trimmed, { strict: false })) {
      setProblem("That is not a contract address. It should be 0x followed by 40 hex characters.")
      return
    }
    window.location.hash = `#/contract/${chain}/${getAddress(trimmed)}`
  }

  const trusted = new Set(settings.trusted.map((entry) => entry.toLowerCase()))
  const contracts = new Set(feed.rows.map((row) => `${row.chainId}:${row.address.toLowerCase()}`))
  const count = (value: number | undefined, capped = false) => (value === undefined ? "–" : `${value}${capped ? "+" : ""}`)

  return (
    <>
      <section className="hero">
        <div className="container hero-inner">
          <div>
            <span className="tag">
              <span className="dot dot-on" />
              No server to trust
            </span>
            <h1>
              Is this contract's source <em>what it claims to be?</em>
            </h1>
            <p className="hero-sub">
              Independent verifiers recompile a contract and sign what they find on Arkiv. You pick whose word counts, and
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
          </div>
          <Rosette id="hero">
            <span className="orb-chip">
              <Icon name="cpu" />
              Recompile
            </span>
            <span className="orb-chip">
              <Icon name="layers" />
              Compare with the chain
            </span>
            <span className="orb-chip">
              <Icon name="pen" />
              Sign on Arkiv
            </span>
          </Rosette>
        </div>
      </section>

      <section className="strip">
        <div className="container">
          <p className="strip-title">Built on open infrastructure, with no server of ours in between</p>
          <div className="strip-items">
            {BUILT_ON.map(({ icon, label }) => (
              <span key={label}>
                <Icon name={icon} />
                {label}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="section haze">
        <div className="container">
          <SectionHead tag="Why it holds" title="Verification without a gatekeeper">
            A green tick is only worth something if you know who put it there. Arkify shows you who, and lets you decide.
          </SectionHead>
          <div className="features">
            {FEATURES.map(({ icon, title, text }) => (
              <div className="feature" key={title}>
                <span className="feature-icon">
                  <Icon name={icon} />
                </span>
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section band">
        <div className="container">
          <SectionHead tag="Live" title="On Arkiv right now">
            Your browser read these from Arkiv when the page loaded. None of it comes from a server of ours.
          </SectionHead>
          <div className="stats">
            <div className="stat">
              <b>{count(registry?.byCreator.size)}</b>
              <span>verifiers with a live lease</span>
            </div>
            <div className="stat">
              <b>{count(feed.loaded ? feed.rows.length : undefined, feed.capped)}</b>
              <span>attestations in the last 7 days</span>
            </div>
            <div className="stat">
              <b>{count(feed.loaded ? contracts.size : undefined, feed.capped)}</b>
              <span>contracts they cover</span>
            </div>
          </div>
        </div>
      </section>

      <section className="section haze">
        <div className="container">
          <SectionHead tag="How it works" title="Three steps, each one on chain">
            Nothing happens in private. The request, the source and every answer are Arkiv entities anyone can query.
          </SectionHead>
          <div className="how">
            <Rosette id="how" petals={12} reach={70} length={128} width={58} />
            <div className="how-steps">
              {STEPS.map(({ icon, title, text }) => (
                <div className="how-card" key={title}>
                  <Icon name={icon} />
                  <h3>{title}</h3>
                  <p>{text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="section band">
        <div className="container">
          <SectionHead tag="Signed statements" title="Latest attestations">
            Each card is one verifier's signed answer about one contract. New ones appear here as they are written.
          </SectionHead>
          {feed.error !== undefined && <ErrorNote message={feed.error} retry={feed.reload} />}
          {!feed.loaded && feed.error === undefined && (
            <div className="quotes" aria-busy="true" aria-label="Loading">
              {Array.from({ length: 4 }, (_, index) => (
                <div key={index} className="skeleton skeleton-card" />
              ))}
            </div>
          )}
          {feed.loaded && feed.rows.length === 0 && <p className="empty">No attestations in the last seven days.</p>}
          <div className="quotes">
            {feed.rows.slice(0, SHOWN).map((row) => (
              <AttestationCard
                key={row.key}
                row={row}
                registry={registry}
                trusted={trusted.has(row.creator.toLowerCase())}
                fresh={feed.fresh.has(row.key)}
              />
            ))}
          </div>
          <div className="section-foot">
            <LiveIndicator />
          </div>
        </div>
      </section>

      <section className="section haze">
        <div className="container">
          <SectionHead tag="FAQ" title="What people ask first">
            Short answers. The long ones are in the repository, next to the code that backs them.
          </SectionHead>
          <div className="faq">
            {QUESTIONS.map(({ question, answer }) => (
              <details className="faq-item" key={question}>
                <summary>
                  {question}
                  <span className="faq-plus" aria-hidden="true" />
                </summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="section band cta">
        <div className="container">
          <SectionHead tag="Open source" title="Don't take our word for it either">
            Look a contract up, ask the verifiers to check one, or run a verifier of your own and sign what you find.
          </SectionHead>
          <div className="section-foot">
            <a className="btn btn-primary btn-lg" href="#/request">
              Request a verification
              <Icon name="arrow" />
            </a>
            <a className="btn btn-lg" href={REPOSITORY} target="_blank" rel="noreferrer">
              <Icon name="github" />
              Run a verifier
            </a>
          </div>
        </div>
      </section>
    </>
  )
}

/** The last week of attestations, newest first, kept current by the event subscription. */
function useFeed() {
  const [arrived, setArrived] = useState<AttestationRecord[]>([])
  const { data, error, reload } = useAsync(async () => {
    // Rounded to the hour so that coming back to this page repeats the same query.
    const now = Math.floor(Date.now() / 3_600_000) * 3_600
    const page = await reader
      .select(RECORD_SELECTION)
      .where(attestationsVerifiedSince(BigInt(now) - WEEK_SECONDS))
      .limit(FEED_LIMIT)
      .fetch()
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
            if (record !== undefined) setArrived((previous) => [record, ...previous.filter(({ key }) => key !== record.key)])
          }, () => undefined)
        },
      }),
    [],
  )

  const fresh = new Set(arrived.map(({ key }) => key))
  const rows = [...arrived, ...(data ?? []).filter(({ key }) => !fresh.has(key))].sort((a, b) => Number(b.verifiedAt - a.verifiedAt))
  return { rows, fresh, loaded: data !== undefined, capped: (data?.length ?? 0) >= FEED_LIMIT, error, reload }
}

function AttestationCard({
  row,
  registry,
  trusted,
  fresh,
}: {
  row: AttestationRecord
  registry: Registry | undefined
  trusted: boolean
  fresh: boolean
}) {
  const name = registry?.byCreator.get(row.creator.toLowerCase())?.name ?? knownVerifierName(row.creator)
  const chain = CHAINS[row.chainId.toString() as ChainId]?.name ?? `chain ${row.chainId}`
  const classes = ["quote", trusted ? "" : "is-untrusted", fresh ? "is-new" : ""].filter(Boolean).join(" ")
  return (
    <a className={classes} href={`#/contract/${row.chainId}/${row.address}`}>
      <div className="quote-top">
        <VerdictChip verdict={row.verdict} />
        <span title={dateTime(row.verifiedAt)}>{timeAgo(row.verifiedAt)}</span>
      </div>
      <p className="quote-text">{SAYS[row.verdict]}</p>
      <p className="quote-target">
        <span className="mono" title={row.address}>
          {shortHex(row.address)}
        </span>{" "}
        on {chain}
      </p>
      <div className="quote-by">
        <Avatar address={row.creator} />
        <div>
          <b className={name === undefined ? "mono" : undefined} title={row.creator}>
            {name ?? shortHex(row.creator)}
          </b>
          <span>{trusted ? "trusted by you" : "not trusted by you"}</span>
        </div>
      </div>
    </a>
  )
}
