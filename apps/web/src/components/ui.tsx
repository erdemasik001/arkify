import { knownVerifierName, type LiveStatus, Status, Verdict } from "@arkify/core"
import { type ReactNode, useEffect, useState, useSyncExternalStore } from "react"
import type { Address, Hex } from "viem"
import { ARKIV_EXPLORER, liveStatus, subscribeStatus } from "../lib/arkiv"
import { shortHex } from "../lib/format"
import type { Registry } from "../lib/registry"

const ICONS = {
  check: "M5 12.5l4.5 4.5L19 7.5",
  shieldCheck: "M12 3l7.5 3v5.6c0 4.6-3.1 8-7.5 9.4-4.4-1.4-7.5-4.8-7.5-9.4V6L12 3zm-3.2 9.2l2.3 2.3 4.3-4.6",
  shieldAlert: "M12 3l7.5 3v5.6c0 4.6-3.1 8-7.5 9.4-4.4-1.4-7.5-4.8-7.5-9.4V6L12 3zm0 5v4.6M12 15.9v.1",
  shieldOff: "M12 3l7.5 3v5.6c0 4.6-3.1 8-7.5 9.4-4.4-1.4-7.5-4.8-7.5-9.4V6L12 3zm-2.6 6.4l5.2 5.2m0-5.2l-5.2 5.2",
  help: "M12 21a9 9 0 100-18 9 9 0 000 18zm-2.6-11.2a2.7 2.7 0 115 1.4c-.6.9-2.4 1.3-2.4 2.9M12 17v.1",
  x: "M6.5 6.5l11 11m0-11l-11 11",
  alert: "M12 4.2l8.6 14.9H3.4L12 4.2zm0 5.6v4.4m0 2.9v.1",
  arrow: "M5 12h14m-5.5-5.5L19 12l-5.5 5.5",
  external: "M14 5h5v5m0-5l-8.5 8.5M11 6.5H6.5v11h11V13",
  copy: "M9 9h10v10H9zM5 15V5h10",
  file: "M7 3.5h7l4 4V20.5H7zM14 3.5v4h4",
  layers: "M12 4l8.5 4.5L12 13 3.5 8.5 12 4zm-8.5 8L12 16.5l8.5-4.5M3.5 15.5L12 20l8.5-4.5",
  radio: "M12 13.2a1.2 1.2 0 100-2.4 1.2 1.2 0 000 2.4zM8.2 8.2a5.4 5.4 0 000 7.6m7.6 0a5.4 5.4 0 000-7.6M5.4 5.4a9.3 9.3 0 000 13.2m13.2 0a9.3 9.3 0 000-13.2",
  users: "M9 11a3.2 3.2 0 100-6.4A3.2 3.2 0 009 11zm-6 8.4c0-3 2.7-5 6-5s6 2 6 5M16.5 5a3 3 0 010 5.8m1.2 3.7c1.9.6 3.3 2.1 3.3 4.4",
  terminal: "M4 5.5h16v13H4zM7.5 10l2.6 2.2-2.6 2.2m4.6.4h4",
  clock: "M12 21a9 9 0 100-18 9 9 0 000 18zm0-13.5V12l3 2",
  pen: "M4.5 19.5l1-4.2L16.8 4a1.9 1.9 0 012.7 2.7L8.2 18l-3.7 1.5zM14.8 6l3.2 3.2",
  upload: "M12 15.5V4.5m0 0L7.5 9M12 4.5L16.5 9M4.5 15.5V19h15v-3.5",
  cpu: "M7.5 7.5h9v9h-9zM10 3.5v4m4-4v4m-4 9v4m4-4v4M3.5 10h4m-4 4h4m9-4h4m-4 4h4",
  eye: "M2.8 12s3.4-6.2 9.2-6.2 9.2 6.2 9.2 6.2-3.4 6.2-9.2 6.2S2.8 12 2.8 12zm9.2 2.7a2.7 2.7 0 100-5.4 2.7 2.7 0 000 5.4z",
  chain: "M10 14a4 4 0 005.7 0l3-3A4 4 0 0013 5.3l-1.1 1.1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1.1-1.1",
  cube: "M12 3.5l7.5 4.2v8.6L12 20.5l-7.5-4.2V7.7L12 3.5zm0 8.6l7.3-4.2M12 12.1L4.7 7.9m7.3 4.2v8.2",
  code: "M8.5 7.5L4 12l4.5 4.5m7-9L20 12l-4.5 4.5m-2-11l-3 13",
  github:
    "M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 00-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0020 4.77 5.07 5.07 0 0019.91 1S18.73.65 16 2.48a13.38 13.38 0 00-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 005 4.77a5.44 5.44 0 00-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 009 18.13V22",
} as const

export type IconName = keyof typeof ICONS

export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  )
}

/** A colour swatch derived from an address, so the same account looks the same everywhere. */
export function Avatar({ address, small = false }: { address: string; small?: boolean }) {
  const hex = address.toLowerCase().replace(/^0x/, "").padEnd(12, "0")
  const hue = (offset: number) => Math.round((Number.parseInt(hex.slice(offset, offset + 4), 16) / 0xffff) * 360)
  const background = `linear-gradient(135deg, hsl(${hue(0)} 78% 60%), hsl(${hue(4)} 72% 46%) 55%, hsl(${hue(8)} 70% 34%))`
  return <span className={small ? "avatar avatar-sm" : "avatar"} style={{ background }} aria-hidden="true" />
}

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
      className="text-button"
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
    <a className="mono" href={`${ARKIV_EXPLORER}/address/${address}`} target="_blank" rel="noreferrer" title={`${address} on the Arkiv explorer`}>
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
    <div className="row-main">
      <Avatar address={address} />
      <div className="row-text">
        <div className="row-title">
          {name ?? <Account address={address} />}
          <span className={trusted ? "pill pill-plain tone-good" : "pill pill-plain"}>{trusted ? "trusted" : "not trusted"}</span>
        </div>
        <div className="row-sub">
          {name !== undefined && <Account address={address} />}
          {name !== undefined && registry !== undefined && " · "}
          {registry !== undefined && (record === undefined ? "offline" : "online")}
        </div>
      </div>
    </div>
  )
}

const STATUS: Record<Status, { label: string; tone: string; icon: IconName }> = {
  [Status.Verified]: { label: "Verified", tone: "good", icon: "shieldCheck" },
  [Status.WeaklyVerified]: { label: "Weakly verified", tone: "warn", icon: "shieldCheck" },
  [Status.Disputed]: { label: "Disputed", tone: "bad", icon: "shieldAlert" },
  [Status.Mismatch]: { label: "Mismatch", tone: "bad", icon: "shieldOff" },
  [Status.Unverified]: { label: "Unverified", tone: "quiet", icon: "help" },
}
export const statusLook = (status: Status) => STATUS[status]

export function StatusBadge({ status }: { status: Status }) {
  const { label, tone, icon } = STATUS[status]
  return (
    <span className={`pill tone-${tone}`}>
      <Icon name={icon} />
      {label}
    </span>
  )
}

const VERDICT: Record<Verdict, { label: string; tone: string; icon: IconName }> = {
  [Verdict.FullMatch]: { label: "Full match", tone: "good", icon: "check" },
  [Verdict.PartialMatch]: { label: "Partial match", tone: "warn", icon: "check" },
  [Verdict.Mismatch]: { label: "Mismatch", tone: "bad", icon: "x" },
  [Verdict.Error]: { label: "Error", tone: "quiet", icon: "alert" },
}

export function VerdictChip({ verdict }: { verdict: Verdict }) {
  const { label, tone, icon } = VERDICT[verdict]
  return (
    <span className={`pill tone-${tone}`}>
      <Icon name={icon} />
      {label}
    </span>
  )
}

/** A block of something to copy and run, dressed as a terminal window. */
export function CodeBlock({ text, label }: { text: string; label: string }) {
  return (
    <div className="terminal">
      <div className="terminal-bar">
        <span className="terminal-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span>{label}</span>
        <CopyButton text={text} />
      </div>
      <pre>{text}</pre>
    </div>
  )
}

export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="skeleton-rows" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="skeleton" />
      ))}
    </div>
  )
}

export function ErrorNote({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="note tone-bad">
      <Icon name="alert" />
      <div>
        <strong>Could not load.</strong> {message}{" "}
        {retry !== undefined && (
          <button type="button" className="text-button" onClick={retry}>
            Try again
          </button>
        )}
      </div>
    </div>
  )
}

const LIVE: Record<LiveStatus, { label: string; dot: string }> = {
  connecting: { label: "Connecting", dot: "dot" },
  live: { label: "Live from Arkiv", dot: "dot dot-on" },
  reconnecting: { label: "Reconnecting", dot: "dot dot-warn" },
}

/** Whether the WebSocket subscription to Arkiv is delivering events right now. */
export function LiveIndicator() {
  const status = useSyncExternalStore(subscribeStatus, liveStatus)
  return (
    <span className="live" title="WebSocket subscription to Arkiv entity events">
      <span className={LIVE[status].dot} />
      {LIVE[status].label}
    </span>
  )
}

export function Card({
  title,
  icon,
  aside,
  dashed = false,
  children,
}: {
  title: string
  icon?: IconName
  aside?: ReactNode
  dashed?: boolean
  children: ReactNode
}) {
  return (
    <section className={dashed ? "card card-dashed" : "card"}>
      <div className="card-head">
        <h2>
          {icon !== undefined && <Icon name={icon} />}
          {title}
        </h2>
        {aside}
      </div>
      <div className="card-body">{children}</div>
    </section>
  )
}

export const sourceLink = (sourceHash: Hex, sourceKey?: Hex) =>
  `#/source/${sourceHash}${sourceKey === undefined ? "" : `?key=${sourceKey}`}`
