import { knownVerifierName, type LiveStatus, Status, Verdict } from "@arkify/core"
import { type ReactNode, useEffect, useState, useSyncExternalStore } from "react"
import type { Address, Hex } from "viem"
import { ARKIV_EXPLORER, liveStatus, subscribeStatus } from "../lib/arkiv"
import { shortHex } from "../lib/format"
import type { Registry } from "../lib/registry"

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])
  return (
    <button
      type="button"
      className="link-button"
      onClick={() => void navigator.clipboard.writeText(text).then(() => setCopied(true), () => undefined)}
    >
      {copied ? "Copied" : label}
    </button>
  )
}

export function Mono({ value, full = false }: { value: string; full?: boolean }) {
  return (
    <span className="mono" title={value}>
      {full ? value : shortHex(value)}
    </span>
  )
}

/** An Arkiv account, linked to the Tiramisu explorer where its entity-creating transactions are. */
export function Account({ address, full = false }: { address: Address; full?: boolean }) {
  return (
    <a className="mono" href={`${ARKIV_EXPLORER}/address/${address}`} target="_blank" rel="noreferrer" title={address}>
      {full ? address : shortHex(address)}
    </a>
  )
}

/**
 * Who signed something. The address is the identity; the name is whatever that account chose to
 * call itself, so it is shown as a label beside the address and never instead of it.
 */
export function Signer({ address, registry, trusted }: { address: Address; registry: Registry | undefined; trusted: boolean }) {
  const record = registry?.byCreator.get(address.toLowerCase())
  const name = record?.name ?? knownVerifierName(address)
  return (
    <span className="signer">
      {name !== undefined && <span className="signer-name">{name}</span>}
      <Account address={address} />
      <span className={trusted ? "tag tag-good" : "tag"}>{trusted ? "trusted" : "not trusted"}</span>
      {registry !== undefined && record === undefined && <span className="tag">offline</span>}
    </span>
  )
}

const STATUS_LABEL: Record<Status, string> = {
  [Status.Verified]: "Verified",
  [Status.WeaklyVerified]: "Weakly verified",
  [Status.Disputed]: "Disputed",
  [Status.Mismatch]: "Mismatch",
  [Status.Unverified]: "Unverified",
}
const STATUS_TONE: Record<Status, string> = {
  [Status.Verified]: "good",
  [Status.WeaklyVerified]: "warn",
  [Status.Disputed]: "bad",
  [Status.Mismatch]: "bad",
  [Status.Unverified]: "muted",
}

export function StatusBadge({ status, large = false }: { status: Status; large?: boolean }) {
  return <span className={`badge badge-${STATUS_TONE[status]}${large ? " badge-large" : ""}`}>{STATUS_LABEL[status]}</span>
}

const VERDICT_LABEL: Record<Verdict, string> = {
  [Verdict.FullMatch]: "full match",
  [Verdict.PartialMatch]: "partial match",
  [Verdict.Mismatch]: "mismatch",
  [Verdict.Error]: "error",
}
const VERDICT_TONE: Record<Verdict, string> = {
  [Verdict.FullMatch]: "good",
  [Verdict.PartialMatch]: "warn",
  [Verdict.Mismatch]: "bad",
  [Verdict.Error]: "muted",
}

export function VerdictChip({ verdict }: { verdict: Verdict }) {
  return <span className={`chip chip-${VERDICT_TONE[verdict]}`}>{VERDICT_LABEL[verdict]}</span>
}

export function CodeBlock({ text, label }: { text: string; label?: string }) {
  return (
    <div className="codeblock">
      <div className="codeblock-bar">
        <span>{label}</span>
        <CopyButton text={text} />
      </div>
      <pre>{text}</pre>
    </div>
  )
}

export function Loading({ what }: { what: string }) {
  return <p className="muted">Loading {what}…</p>
}

export function ErrorNote({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="note note-bad">
      <strong>Could not load.</strong> {message}
      {retry !== undefined && (
        <>
          {" "}
          <button type="button" className="link-button" onClick={retry}>
            Try again
          </button>
        </>
      )}
    </div>
  )
}

const LIVE_LABEL: Record<LiveStatus, string> = { connecting: "connecting", live: "live", reconnecting: "reconnecting" }

/** Whether the WebSocket subscription to Arkiv is delivering events right now. */
export function LiveIndicator() {
  const status = useSyncExternalStore(subscribeStatus, liveStatus)
  return (
    <span className={`live live-${status}`} title="WebSocket subscription to Arkiv entity events">
      <span className="live-dot" />
      {LIVE_LABEL[status]}
    </span>
  )
}

export function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="section">
      <div className="section-head">
        <h2>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

export const sourceLink = (sourceHash: Hex, sourceKey?: Hex) =>
  `#/source/${sourceHash}${sourceKey === undefined ? "" : `?key=${sourceKey}`}`
