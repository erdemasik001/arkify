import {
  type Assessment,
  type AttestationRecord,
  computeVerdict,
  decodeAll,
  decodeAttestation,
  decodeRequest,
  decodeSource,
  EntityType,
  fetchAttestations,
  knownVerifierName,
  Lifetime,
  type RequestRecord,
  readAll,
  requestsFor,
  type SourceAssessment,
  type SourceRecord,
  Status,
  sourcesWithAnyHash,
  trustedAttestations,
  Verdict,
} from "@arkify/core"
import { useEffect, useRef } from "react"
import { type Address, getAddress, type Hex } from "viem"
import { KeepAlive } from "../components/KeepAlive"
import {
  Account,
  Avatar,
  Card,
  CodeBlock,
  CopyButton,
  ErrorNote,
  Icon,
  Mono,
  Signer,
  StatusBadge,
  sourceLink,
  statusLook,
  VerdictChip,
} from "../components/ui"
import { curlFor, forgetQueries, mayBe, reader, subscribeLive } from "../lib/arkiv"
import { CHAINS, type ChainId, codeHashCurl, readCodeHash } from "../lib/evm"
import { dateTime, expiresIn, shortHex, timeAgo } from "../lib/format"
import { type Registry, useRegistry } from "../lib/registry"
import { setTrusted, type Settings, useSettings } from "../lib/settings"
import { useAsync } from "../lib/useAsync"

type ContractData = {
  codeHash: Hex
  codeSize: number
  head: bigint
  assessment: Assessment
  sources: Map<string, SourceRecord>
  requests: RequestRecord[]
}

async function loadContract(chainId: ChainId, address: Address, settings: Settings): Promise<ContractData> {
  const target = { chainId: BigInt(chainId), address }
  const { codeHash, size } = await readCodeHash(chainId, address)
  const [attestations, pending, head] = await Promise.all([
    fetchAttestations(reader, { ...target, codeHash }, settings.trusted),
    readAll(reader, requestsFor(target)),
    reader.getBlockNumber(),
  ])
  const all = [...attestations.trusted, ...attestations.others]
  const hashes = [...new Set(all.map(({ sourceHash }) => sourceHash))].sort()
  const sources = new Map<string, SourceRecord>()
  if (hashes.length > 0) {
    for (const record of decodeAll(await readAll(reader, sourcesWithAnyHash(hashes)), decodeSource)) {
      if (!sources.has(record.sourceHash.toLowerCase())) sources.set(record.sourceHash.toLowerCase(), record)
    }
  }
  return {
    codeHash,
    codeSize: size,
    head,
    assessment: computeVerdict(all, { trusted: settings.trusted, threshold: settings.threshold, codeHash }),
    sources,
    requests: decodeAll(pending, decodeRequest).sort((a, b) => Number(b.createdAt - a.createdAt)),
  }
}

const EXPLANATION: Record<Status, (assessment: Assessment) => string> = {
  [Status.Verified]: ({ decisive }) =>
    `${decisive?.matches.length} verifiers you trust each compiled the same source on their own and got exactly the code deployed here.`,
  [Status.WeaklyVerified]: ({ decisive, threshold }) =>
    `${decisive?.matches.length === 1 ? "One verifier" : `${decisive?.matches.length} verifiers`} you trust matched a source to this code. You asked for ${threshold}, so treat this as provisional.`,
  [Status.Disputed]: () =>
    "Verifiers you trust contradict each other about the same source. At least one of them is wrong, so do not rely on any source shown here until you know which.",
  [Status.Mismatch]: () => "Verifiers you trust compiled the submitted source, and it does not produce the code deployed here.",
  [Status.Unverified]: () => "No verifier you trust has said anything about the code deployed here.",
}

export function Contract({ chainId, address }: { chainId: ChainId; address: Address }) {
  const settings = useSettings()
  const { registry } = useRegistry()
  const { data, error, loading, reload } = useAsync(
    () => loadContract(chainId, address, settings),
    [chainId, address, settings],
  )

  // Live: when an attestation or a request about this contract is created, show it without a
  // refresh. The event has no attributes, so candidates are read back and checked.
  const reloadRef = useRef(reload)
  reloadRef.current = reload
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const stop = subscribeLive({
      onCreated: (event) => {
        if (!mayBe(EntityType.Attestation, event) && !mayBe(EntityType.Request, event)) return
        void reader.getEntity(event.entityKey).then((entity) => {
          const record = decodeAttestation(entity) ?? decodeRequest(entity)
          if (record === undefined || record.address !== address || record.chainId !== BigInt(chainId)) return
          clearTimeout(timer)
          timer = setTimeout(() => reloadRef.current(), 600)
        }, () => undefined)
      },
    })
    return () => {
      clearTimeout(timer)
      stop()
    }
  }, [chainId, address])

  const chain = CHAINS[chainId]
  return (
    <>
      <header className="page-head">
        <span className="eyebrow">{chain.name} contract</span>
        <h1 className="mono wrap">{address}</h1>
        <div className="meta-row">
          <a className="meta" href={`${chain.explorer}/address/${address}`} target="_blank" rel="noreferrer">
            <Icon name="external" />
            {new URL(chain.explorer).hostname}
          </a>
          {data !== undefined && data.codeSize > 0 && (
            <>
              <span className="meta">
                Deployed code <b>{data.codeSize.toLocaleString("en")} bytes</b>
              </span>
              <span className="meta">
                Code hash <b className="mono">{shortHex(data.codeHash)}</b>
                <CopyButton text={data.codeHash} />
              </span>
            </>
          )}
        </div>
      </header>

      {error !== undefined && <ErrorNote message={error} retry={reload} />}
      {data === undefined && loading && <div className="skeleton skeleton-block" aria-busy="true" aria-label="Loading" />}
      {data !== undefined && data.codeSize === 0 && (
        <div className="note">
          <Icon name="help" />
          <div>There is no contract code at this address on {chain.name}, so there is nothing to verify.</div>
        </div>
      )}
      {data !== undefined && data.codeSize > 0 && (
        <>
          <VerdictHero chainId={chainId} address={address} assessment={data.assessment} settings={settings} registry={registry} />

          {data.assessment.sources.map((source) => (
            <SourceCard
              key={source.sourceHash}
              source={source}
              record={data.sources.get(source.sourceHash.toLowerCase())}
              registry={registry}
              head={data.head}
              onChange={reload}
            />
          ))}

          {data.assessment.untrusted.length > 0 && (
            <Card title="From accounts you do not trust" icon="users" dashed>
              <p className="muted">
                Anyone can write an attestation. These were signed by accounts outside your trusted list, so they are shown
                and never counted.
              </p>
              <AttestationRows rows={data.assessment.untrusted} registry={registry} head={data.head} trusted={false} onChange={reload} />
            </Card>
          )}

          <Card
            title="Requests"
            icon="clock"
            aside={
              <a className="btn btn-sm" href={`#/request?chain=${chainId}&address=${address}`}>
                Request a verification
              </a>
            }
          >
            {data.requests.length === 0 ? (
              <p className="empty">No open request. A request lives for 24 hours unless someone keeps it alive.</p>
            ) : (
              <div className="rows">
                {data.requests.slice(0, 5).map((request) => (
                  <div className="row" key={request.key}>
                    <div className="row-main">
                      <Avatar address={request.creator} />
                      <div className="row-text">
                        <div className="row-title">
                          <Account address={request.creator} />
                        </div>
                        <div className="row-sub">asked for a check</div>
                      </div>
                    </div>
                    <div className="row-mid">
                      <a className="meta" href={sourceLink(request.sourceHash, request.sourceKey)}>
                        <Icon name="file" />
                        Source <b className="mono">{shortHex(request.sourceHash)}</b>
                      </a>
                    </div>
                    <div className="row-end">
                      <span>expires in {expiresIn(request.expiresAt, data.head)}</span>
                      <KeepAlive entityKey={request.key} lifetime={Lifetime.request} label="24 more hours for this request" onDone={reload} />
                    </div>
                  </div>
                ))}
              </div>
            )}
            {data.requests.length > 5 && <p className="faint">and {data.requests.length - 5} older ones.</p>}
          </Card>

          <WithoutUs chainId={chainId} address={address} data={data} settings={settings} />
        </>
      )}
    </>
  )
}

function VerdictHero({
  chainId,
  address,
  assessment,
  settings,
  registry,
}: {
  chainId: ChainId
  address: Address
  assessment: Assessment
  settings: Settings
  registry: Registry | undefined
}) {
  const { label, tone, icon } = statusLook(assessment.status)
  const decisive = assessment.decisive
  const stance = (verifier: Address) => {
    const signedBy = ({ creator }: AttestationRecord) => creator.toLowerCase() === verifier.toLowerCase()
    if (decisive?.matches.some(signedBy)) return "match"
    if (decisive?.mismatches.some(signedBy)) return "mismatch"
    if (decisive?.errors.some(signedBy)) return "error"
    return "silent"
  }
  const matched = settings.trusted.filter((verifier) => stance(verifier) === "match").length
  const objected = settings.trusted.filter((verifier) => stance(verifier) === "mismatch").length

  return (
    <section className={`verdict t-${tone}`}>
      <div className="verdict-top">
        <span className="verdict-icon">
          <Icon name={icon} />
        </span>
        <div>
          <h1>{label}</h1>
          <p className="verdict-text">{EXPLANATION[assessment.status](assessment)}</p>
          {decisive?.match !== undefined && assessment.status !== Status.Disputed && (
            <p className="verdict-fine">
              {decisive.match === "full"
                ? "Full match: the metadata hash matches too, so these are exactly the source files that were deployed."
                : "Partial match: the executable code matches, but the exact source files are not proven."}
            </p>
          )}
          {assessment.status === Status.Unverified && (
            <a className="btn btn-primary verdict-cta" href={`#/request?chain=${chainId}&address=${address}`}>
              Request a verification
              <Icon name="arrow" />
            </a>
          )}
        </div>
      </div>
      {settings.trusted.length > 0 && (
        <div className="meter">
          <div className="meter-seats">
            {settings.trusted.map((verifier) => {
              const name = registry?.byCreator.get(verifier.toLowerCase())?.name ?? knownVerifierName(verifier) ?? shortHex(verifier)
              const said = stance(verifier)
              return (
                <span key={verifier} className={`seat s-${said}`} title={`${name}: ${said === "silent" ? "has not answered" : said}`}>
                  <Avatar address={verifier} />
                </span>
              )
            })}
          </div>
          <p className="meter-caption">
            <b>
              {matched} of {settings.trusted.length}
            </b>{" "}
            verifiers you trust matched{objected > 0 && <>, <b>{objected}</b> objected</>}. Verified needs <b>{assessment.threshold}</b>.{" "}
            <a className="link" href="#/verifiers">
              Change who you trust
            </a>
          </p>
        </div>
      )}
    </section>
  )
}

function SourceCard({
  source,
  record,
  registry,
  head,
  onChange,
}: {
  source: SourceAssessment
  record: SourceRecord | undefined
  registry: Registry | undefined
  head: bigint
  onChange: () => void
}) {
  const rows = [...source.matches, ...source.mismatches, ...source.errors]
  return (
    <Card title={record?.contractName ?? "Source"} icon="file" aside={<StatusBadge status={source.status} />}>
      <div className="meta-row">
        {record !== undefined && (
          <span className="meta">
            solc <b>{record.compilerVersion}</b>
          </span>
        )}
        <span className="meta">
          Bundle <b className="mono">{shortHex(source.sourceHash)}</b>
        </span>
        <a className="meta" href={sourceLink(source.sourceHash, source.sourceKey)}>
          <Icon name="arrow" />
          <b>Read the source</b>
        </a>
      </div>
      <AttestationRows rows={rows} registry={registry} head={head} trusted onChange={onChange} />
    </Card>
  )
}

function AttestationRows({
  rows,
  registry,
  head,
  trusted,
  onChange,
}: {
  rows: AttestationRecord[]
  registry: Registry | undefined
  head: bigint
  trusted: boolean
  onChange: () => void
}) {
  return (
    <div className="rows">
      {rows.map((row) => (
        <div className="row" key={row.key}>
          <Signer address={row.creator} registry={registry} trusted={trusted} />
          <div className="row-mid">
            <VerdictChip verdict={row.verdict} />
            {!trusted && (
              <a className="mono muted" href={sourceLink(row.sourceHash, row.sourceKey)}>
                source {shortHex(row.sourceHash)}
              </a>
            )}
          </div>
          <div className="row-end">
            <span title={`Verified ${dateTime(row.verifiedAt)}. Expires in ${expiresIn(row.expiresAt, head)}.`}>{timeAgo(row.verifiedAt)}</span>
            {!trusted && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  forgetQueries()
                  setTrusted(row.creator, true)
                }}
              >
                Trust
              </button>
            )}
            <KeepAlive
              entityKey={row.key}
              lifetime={row.verdict === Verdict.Error ? Lifetime.failedAttestation : Lifetime.attestation}
              label="renew this attestation"
              onDone={onChange}
            />
          </div>
          {row.details?.message !== undefined && <div className="row-note">{row.details.message}</div>}
        </div>
      ))}
    </div>
  )
}

/** Everything needed to reach the same answer without this website, or any Arkify server. */
function WithoutUs({ chainId, address, data, settings }: { chainId: ChainId; address: Address; data: ContractData; settings: Settings }) {
  const target = { chainId: BigInt(chainId), address: getAddress(address), codeHash: data.codeHash }
  const query = settings.trusted.length === 0 ? undefined : trustedAttestations(target, settings.trusted).toString()
  return (
    <Card title="Verify this without us" icon="terminal">
      <p className="muted">
        This page has no backend. It asked two public RPC endpoints two questions, and you can ask them yourself. If this
        site disappears, the answer does not.
      </p>
      <ol className="steps">
        <li>
          <h3>Which code is deployed?</h3>
          <p>
            Ask {CHAINS[chainId].name} for the bytecode and take its keccak256: <Mono value={data.codeHash} />. Attestations
            about any other code are ignored.
          </p>
          <CodeBlock label="eth_getCode" text={codeHashCurl(chainId, address)} />
        </li>
        <li>
          <h3>What did the verifiers you trust sign about it?</h3>
          <p>
            Ask Arkiv. The node applies the filter on <code>$creator</code>, and the chain sets <code>$creator</code> when an
            entity is created: nobody can write an attestation that appears to come from someone else.
          </p>
          {query === undefined ? (
            <p>Your trusted list is empty, so there is nothing to ask.</p>
          ) : (
            <>
              <CodeBlock label="Arkiv query" text={query} />
              <CodeBlock label="arkiv_query over JSON-RPC" text={curlFor(query)} />
            </>
          )}
        </li>
        <li>
          <h3>Count</h3>
          <p>
            Group the results by <code>source_hash</code>. A source is verified when at least {settings.threshold} different
            creators say <code>full_match</code> or <code>partial_match</code> and none says <code>mismatch</code>.
          </p>
        </li>
      </ol>
    </Card>
  )
}
