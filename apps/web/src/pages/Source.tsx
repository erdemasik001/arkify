import { decodeAll, decodeSource, findSource, Lifetime, readAll, sourcesWithHash } from "@arkify/core"
import { useState } from "react"
import type { Hex } from "viem"
import { KeepAlive } from "../components/KeepAlive"
import { CodeBlock, CopyButton, ErrorNote, Loading, Mono, Section, Signer } from "../components/ui"
import { reader } from "../lib/arkiv"
import { browserBrotli } from "../lib/brotli"
import { expiresIn } from "../lib/format"
import { useRegistry } from "../lib/registry"
import { useSettings } from "../lib/settings"
import { useAsync } from "../lib/useAsync"

export function Source({ sourceHash, preferredKey }: { sourceHash: Hex; preferredKey: Hex | undefined }) {
  const settings = useSettings()
  const { registry } = useRegistry()
  const { data, error, loading, reload } = useAsync(async () => {
    const [found, copies, head] = await Promise.all([
      findSource(reader, sourceHash, browserBrotli, preferredKey),
      readAll(reader, sourcesWithHash(sourceHash)),
      reader.getBlockNumber(),
    ])
    return { found, copies: decodeAll(copies, decodeSource), head }
  }, [sourceHash, preferredKey])
  const [selected, setSelected] = useState<string>()

  if (error !== undefined) return <ErrorNote message={error} retry={reload} />
  if (data === undefined) return loading ? <Loading what="the source bundle" /> : null
  if (data.found === undefined) {
    return (
      <>
        <header className="page-head">
          <p className="eyebrow">Source bundle</p>
          <h1 className="mono wrap">{sourceHash}</h1>
        </header>
        <div className="note note-bad">
          No copy of this source on Arkiv decompresses to content with this hash. {data.copies.length} entity
          {data.copies.length === 1 ? " claims" : "ies claim"} the hash; none passed the check, or all have expired.
        </div>
      </>
    )
  }

  const { bundle } = data.found
  const files = Object.keys(bundle.input.sources)
  const file = selected ?? bundle.contract.slice(0, bundle.contract.lastIndexOf(":"))
  const current = files.includes(file) ? file : files[0]
  const content = current === undefined ? "" : (bundle.input.sources[current]?.content ?? "")
  const trusted = new Set(settings.trusted.map((address) => address.toLowerCase()))

  return (
    <>
      <header className="page-head">
        <p className="eyebrow">Source bundle</p>
        <h1>{bundle.contract.slice(bundle.contract.lastIndexOf(":") + 1)}</h1>
        <p className="muted">
          <span className="mono">{bundle.contract}</span> · solc {bundle.compilerVersion} · {files.length} file
          {files.length === 1 ? "" : "s"}
        </p>
      </header>

      <div className="note note-good">
        <strong>Content checked in your browser.</strong> This page decompressed the payload and hashed it: keccak256 is{" "}
        <Mono value={sourceHash} /> <CopyButton text={sourceHash} />, the hash attestations refer to. A copy with any other
        content would have been rejected.
      </div>

      <Section title="Files">
        <div className="files">
          <nav className="file-list" aria-label="Source files">
            {files.map((name) => (
              <button type="button" key={name} className={name === current ? "file active" : "file"} onClick={() => setSelected(name)}>
                {name}
              </button>
            ))}
          </nav>
          <pre className="file-view">{content}</pre>
        </div>
      </Section>

      <Section title="Compiler settings">
        <CodeBlock label="settings" text={JSON.stringify(bundle.input.settings ?? {}, null, 2)} />
      </Section>

      <Section title="Who holds a copy">
        <p className="muted">
          A source is stored content-addressed and anyone may publish a copy. Each verifier that matched it keeps its own, so
          the person who submitted it cannot take it down.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Published by</th>
                <th>Entity</th>
                <th>Expires in</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.copies.map((copy) => (
                <tr key={copy.key}>
                  <td>
                    <Signer address={copy.creator} registry={registry} trusted={trusted.has(copy.creator.toLowerCase())} />
                  </td>
                  <td>
                    <Mono value={copy.key} />
                  </td>
                  <td>{expiresIn(copy.expiresAt, data.head)}</td>
                  <td className="right">
                    <KeepAlive entityKey={copy.key} lifetime={Lifetime.source} label="180 more days for this copy" onDone={reload} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  )
}
