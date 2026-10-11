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
  CodeBlock,
  CopyButton,
  ErrorNote,
  Loading,
  Mono,
  Section,
  Signer,
  StatusBadge,
  sourceLink,
  VerdictChip,
} from "../components/ui"
import { curlFor, mayBe, reader, subscribeLive } from "../lib/arkiv"
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
  const hashes = [...new Set(all.map(({ sourceHash }) => sourceHash))]
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
  [Status.Verified]: ({ decisive, threshold }) =>
    `${decisive?.matches.length} verifiers you trust each compiled the same source and got the code deployed here. ` +
    `Your threshold is ${threshold}.`,
  [Status.WeaklyVerified]: ({ decisive, threshold }) =>
    `${decisive?.matches.length} verifier you trust matched a source to this code. Your threshold is ${threshold}, so treat this as provisional.`,
  [Status.Disputed]: () =>
    "Verifiers you trust contradict each other about the same source. At least one of them is wrong. Check who said what below before relying on any source shown here.",
  [Status.Mismatch]: () =>
    "Verifiers you trust checked the submitted source and it does not produce the code deployed here.",
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
        <p className="eyebrow">{chain.name} contract</p>
        <h1 className="mono wrap">{address}</h1>
        <p className="muted">
          <a href={`${chain.explorer}/address/${address}`} target="_blank" rel="noreferrer">
            View on {new URL(chain.explorer).hostname}
          </a>
          {data !== undefined && data.codeSize > 0 && (
            <>
              {" · "}deployed code {data.codeSize.toLocaleString("en")} bytes, hash <Mono value={data.codeHash} />{" "}
              <CopyButton text={data.codeHash} />
            </>
          )}
        </p>
      </header>

      {error !== undefined && <ErrorNote message={error} retry={reload} />}
      {data === undefined && loading && <Loading what="the deployed code and its attestations" />}
      {data !== undefined && data.codeSize === 0 && (
        <div className="note">There is no contract code at this address on {chain.name}, so there is nothing to verify.</div>
      )}
      {data !== undefined && data.codeSize > 0 && (
        <>
          <div className={`verdict verdict-${data.assessment.status}`}>
            <StatusBadge status={data.assessment.status} large />
            <p>{EXPLANATION[data.assessment.status](data.assessment)}</p>
            {data.assessment.decisive?.match !== undefined && data.assessment.status !== Status.Disputed && (
              <p className="muted">
                {data.assessment.decisive.match === "full"
                  ? "Full match: the metadata hash matches too, so these are exactly the source files that were deployed."
                  : "Partial match: the executable code matches, but the exact source files are not proven."}
              </p>
            )}
          </div>

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
            <Section title="From verifiers you do not trust">
              <p className="muted">
                Anyone can write an attestation. These were signed by accounts outside your trusted list, so they are
                shown and not counted.
              </p>
              <AttestationTable rows={data.assessment.untrusted} registry={registry} head={data.head} trusted={false} onChange={reload} />
            </Section>
          )}

          <Section
            title="Requests"
            aside={<a href={`#/request?chain=${chainId}&address=${address}`}>Request a verification</a>}
          >
            {data.requests.length === 0 ? (
              <p className="muted">No open request for this contract. Requests expire after 24 hours unless someone keeps them alive.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Requested by</th>
                      <th>Source</th>
                      <th>Expires in</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.requests.map((request) => (
                      <tr key={request.key}>
                        <td>
                          <Account address={request.creator} />
                        </td>
                        <td>
                          <a className="mono" href={sourceLink(request.sourceHash, request.sourceKey)}>
                            {shortHex(request.sourceHash)}
                          </a>
                        </td>
                        <td>{expiresIn(request.expiresAt, data.head)}</td>
                        <td className="right">
                          <KeepAlive entityKey={request.key} lifetime={Lifetime.request} label="24 more hours for this request" onDone={reload} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <WithoutUs chainId={chainId} address={address} data={data} settings={settings} />
        </>
      )}
    </>
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
    <Section
      title={record === undefined ? "Source" : `${record.contractName} · solc ${record.compilerVersion}`}
      aside={<StatusBadge status={source.status} />}
    >
      <p className="muted">
        Source bundle <Mono value={source.sourceHash} /> ·{" "}
        <a href={sourceLink(source.sourceHash, source.sourceKey)}>read the source</a>
      </p>
      <AttestationTable rows={rows} registry={registry} head={head} trusted onChange={onChange} />
    </Section>
  )
}

function AttestationTable({
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
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Signed by</th>
            <th>Verdict</th>
            <th>Verified</th>
            <th>Expires in</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td>
                <Signer address={row.creator} registry={registry} trusted={trusted} />
                {row.details?.message !== undefined && <div className="row-note">{row.details.message}</div>}
              </td>
              <td>
                <VerdictChip verdict={row.verdict} />
                {!trusted && (
                  <div className="row-note">
                    <a className="mono" href={sourceLink(row.sourceHash, row.sourceKey)}>
                      source {shortHex(row.sourceHash)}
                    </a>
                  </div>
                )}
              </td>
              <td title={dateTime(row.verifiedAt)}>{timeAgo(row.verifiedAt)}</td>
              <td>{expiresIn(row.expiresAt, head)}</td>
              <td className="right">
                {!trusted && (
                  <button type="button" className="link-button" onClick={() => setTrusted(row.creator, true)}>
                    trust
                  </button>
                )}{" "}
                <KeepAlive
                  entityKey={row.key}
                  lifetime={row.verdict === Verdict.Error ? Lifetime.failedAttestation : Lifetime.attestation}
                  label="renew this attestation's lifetime"
                  onDone={onChange}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Everything needed to reach the same answer without this website, or any Arkify server. */
function WithoutUs({ chainId, address, data, settings }: { chainId: ChainId; address: Address; data: ContractData; settings: Settings }) {
  const target = { chainId: BigInt(chainId), address: getAddress(address), codeHash: data.codeHash }
  const query = settings.trusted.length === 0 ? undefined : trustedAttestations(target, settings.trusted).toString()
  return (
    <Section title="Verify this without us">
      <p>
        This page has no backend. It asked two public RPC endpoints two questions, and you can ask them yourself. If this
        site disappears, the answer does not.
      </p>
      <ol className="steps">
        <li>
          <p>
            <strong>Which code is deployed?</strong> Ask {CHAINS[chainId].name} for the bytecode and take its keccak256. It
            is <Mono value={data.codeHash} />. Attestations about any other code are ignored.
          </p>
          <CodeBlock label="JSON-RPC: eth_getCode" text={codeHashCurl(chainId, address)} />
        </li>
        <li>
          <p>
            <strong>What did the verifiers you trust say about that code?</strong> Ask Arkiv. The filter on{" "}
            <code>$creator</code> is applied by the node, and <code>$creator</code> is set by the chain when an entity is
            created: nobody can write an attestation that appears to come from someone else.
          </p>
          {query === undefined ? (
            <p className="muted">Your trusted list is empty, so there is nothing to ask.</p>
          ) : (
            <>
              <CodeBlock label="Arkiv query" text={query} />
              <CodeBlock label="JSON-RPC: arkiv_query" text={curlFor(query)} />
            </>
          )}
        </li>
        <li>
          <p>
            <strong>Count.</strong> Group the results by <code>source_hash</code>. A source is verified when at least{" "}
            {settings.threshold} different creators say <code>full_match</code> or <code>partial_match</code> and none says{" "}
            <code>mismatch</code>.
          </p>
        </li>
      </ol>
    </Section>
  )
}
