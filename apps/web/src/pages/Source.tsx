import { decodeAll, decodeSource, findSource, Lifetime, readAll, sourcesWithHash } from "@arkify/core"
import { useState } from "react"
import type { Hex } from "viem"
import { KeepAlive } from "../components/KeepAlive"
import { Card, CodeBlock, CopyButton, ErrorNote, Icon, Loading, Signer } from "../components/ui"
import { reader } from "../lib/arkiv"
import { browserBrotli } from "../lib/brotli"
import { expiresIn, shortHex } from "../lib/format"
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
  if (data === undefined) return loading ? <div className="skeleton skeleton-block" aria-busy="true" aria-label="Loading" /> : null
  if (data.found === undefined) {
    return (
      <>
        <header className="page-head">
          <span className="eyebrow">Source bundle</span>
          <h1 className="mono wrap">{sourceHash}</h1>
        </header>
        <div className="note tone-bad">
          <Icon name="alert" />
          <div>
            No copy of this source on Arkiv decompresses to content with this hash. {data.copies.length}{" "}
            {data.copies.length === 1 ? "entity claims" : "entities claim"} the hash; none passed the check, or all have
            expired.
          </div>
        </div>
      </>
    )
  }

  const { bundle } = data.found
  const files = Object.keys(bundle.input.sources)
  const main = bundle.contract.slice(0, bundle.contract.lastIndexOf(":"))
  const current = selected ?? (files.includes(main) ? main : files[0])
  const content = current === undefined ? "" : (bundle.input.sources[current]?.content ?? "")
  const trusted = new Set(settings.trusted.map((address) => address.toLowerCase()))

  return (
    <>
      <header className="page-head">
        <span className="eyebrow">Source bundle</span>
        <h1>{bundle.contract.slice(bundle.contract.lastIndexOf(":") + 1)}</h1>
        <div className="meta-row">
          <span className="meta">
            solc <b>{bundle.compilerVersion}</b>
          </span>
          <span className="meta">
            <b>{files.length}</b> file{files.length === 1 ? "" : "s"}
          </span>
          <span className="meta">
            Hash <b className="mono">{shortHex(sourceHash)}</b>
            <CopyButton text={sourceHash} />
          </span>
        </div>
      </header>

      <div className="note tone-good">
        <Icon name="shieldCheck" />
        <div>
          <strong>Content checked in your browser.</strong> This page decompressed the payload and hashed it; the result is
          the hash attestations refer to. A copy with any other content would have been rejected.
        </div>
      </div>

      <Card title="Files" icon="file">
        <div className="viewer">
          <nav className="file-list" aria-label="Source files">
            {files.map((name) => (
              <button type="button" key={name} className={name === current ? "file active" : "file"} onClick={() => setSelected(name)}>
                {name}
              </button>
            ))}
          </nav>
          <div className="code">
            {content.split("\n").map((line, index) => (
              <span key={index} className="code-line">
                {line || " "}
              </span>
            ))}
          </div>
        </div>
      </Card>

      <Card title="Compiler settings" icon="layers">
        <CodeBlock label="settings" text={JSON.stringify(bundle.input.settings ?? {}, null, 2)} />
      </Card>

      <Card title="Who holds a copy" icon="users">
        <p className="muted">
          A source is stored by content hash and anyone may publish a copy. Each verifier that matched it keeps its own, so
          the person who submitted it cannot take it down.
        </p>
        <div className="rows">
          {data.copies.map((copy) => (
            <div className="row" key={copy.key}>
              <Signer address={copy.creator} registry={registry} trusted={trusted.has(copy.creator.toLowerCase())} />
              <div className="row-mid">
                <span className="meta">
                  Entity <b className="mono">{shortHex(copy.key)}</b>
                </span>
              </div>
              <div className="row-end">
                <span>expires in {expiresIn(copy.expiresAt, data.head)}</span>
                <KeepAlive entityKey={copy.key} lifetime={Lifetime.source} label="180 more days for this copy" onDone={reload} />
              </div>
            </div>
          ))}
        </div>
      </Card>
    </>
  )
}
