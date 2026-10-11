import {
  explainError,
  fetchSourcifyBundle,
  MAX_SOURCE_PAYLOAD_BYTES,
  packSource,
  type SolcInput,
  type SourceBundle,
  type SubmittedRequest,
  submitRequest,
} from "@arkify/core"
import { type ChangeEvent, useState, useSyncExternalStore } from "react"
import { getAddress, isAddress } from "viem"
import { Account, Mono, Section } from "../components/ui"
import { ARKIV_EXPLORER, reader } from "../lib/arkiv"
import { browserBrotli } from "../lib/brotli"
import { CHAINS, type ChainId, isChainId } from "../lib/evm"
import { currentWallet, ensureWallet, subscribeWallet } from "../lib/wallet"


export function Request({ initialChain, initialAddress }: { initialChain: string | undefined; initialAddress: string | undefined }) {
  const [chain, setChain] = useState<ChainId>(initialChain !== undefined && isChainId(initialChain) ? initialChain : "11155111")
  const [address, setAddress] = useState(initialAddress ?? "")
  const [compilerVersion, setCompilerVersion] = useState("")
  const [contract, setContract] = useState("")
  const [inputText, setInputText] = useState("")
  const [origin, setOrigin] = useState<string>()
  const [busy, setBusy] = useState<string>()
  const [problem, setProblem] = useState<string>()
  const [done, setDone] = useState<SubmittedRequest>()
  const wallet = useSyncExternalStore(subscribeWallet, currentWallet)

  const validAddress = isAddress(address.trim(), { strict: false })
  const target = validAddress ? { chainId: BigInt(chain), address: getAddress(address.trim()) } : undefined

  async function importFromSourcify() {
    if (target === undefined) return
    setBusy("Asking Sourcify")
    setProblem(undefined)
    try {
      const bundle = await fetchSourcifyBundle(target)
      setCompilerVersion(bundle.compilerVersion)
      setContract(bundle.contract)
      setInputText(JSON.stringify(bundle.input, null, 2))
      setOrigin(`Imported from Sourcify: ${Object.keys(bundle.input.sources).length} file(s).`)
    } catch (error) {
      setProblem(explainError(error))
    } finally {
      setBusy(undefined)
    }
  }

  function loadFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (file === undefined) return
    void file.text().then((text) => {
      setInputText(text)
      setOrigin(`Loaded ${file.name}.`)
    })
  }

  function readBundle(): SourceBundle {
    let input: SolcInput
    try {
      input = JSON.parse(inputText) as SolcInput
    } catch {
      throw new Error("The standard-JSON input is not valid JSON.")
    }
    return { compilerVersion: compilerVersion.trim(), contract: contract.trim(), input }
  }

  async function submit() {
    if (target === undefined) return
    setProblem(undefined)
    try {
      const bundle = readBundle()
      setBusy("Compressing the source")
      await packSource(bundle, browserBrotli)
      setBusy("Waiting for your wallet")
      const { client } = await ensureWallet()
      setDone(await submitRequest({ reader, writer: client }, { target, bundle, compression: browserBrotli }))
    } catch (error) {
      setProblem(explainError(error))
    } finally {
      setBusy(undefined)
    }
  }

  if (done !== undefined && target !== undefined) {
    return (
      <>
        <header className="page-head">
          <p className="eyebrow">Request a verification</p>
          <h1>Request written to Arkiv</h1>
        </header>
        <div className="note note-good">
          Verifiers that are online hear about it over their event subscription and usually answer within seconds.{" "}
          <a href={`#/contract/${chain}/${target.address}`}>Watch the answers arrive on the contract page.</a>
        </div>
        <dl className="facts">
          <dt>Transaction</dt>
          <dd>
            <a className="mono" href={`${ARKIV_EXPLORER}/tx/${done.txHash}`} target="_blank" rel="noreferrer">
              {done.txHash}
            </a>
          </dd>
          <dt>Request entity</dt>
          <dd>
            <Mono value={done.requestKey} full />
          </dd>
          <dt>Source</dt>
          <dd>
            <a className="mono" href={`#/source/${done.sourceHash}?key=${done.sourceKey}`}>
              {done.sourceHash}
            </a>{" "}
            ({done.publishedSource ? "published in the same transaction" : "already on Arkiv, reused"})
          </dd>
        </dl>
      </>
    )
  }

  const ready = target !== undefined && compilerVersion.trim() !== "" && contract.includes(":") && inputText.trim() !== ""
  return (
    <>
      <header className="page-head">
        <p className="eyebrow">Request a verification</p>
        <h1>Ask the verifiers to check a source</h1>
        <p className="muted">
          You sign one Arkiv transaction that stores the source and the request together. It needs a little testnet GLM
          from the{" "}
          <a href="https://hub.arkiv.network/faucet" target="_blank" rel="noreferrer">
            Arkiv faucet
          </a>
          . Sources are public and stay on Arkiv; do not submit anything private.
        </p>
      </header>

      <Section title="1. The contract">
        <div className="row-form">
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
            <input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="0x…" spellCheck={false} />
          </label>
        </div>
      </Section>

      <Section title="2. The source">
        <div className="row-form">
          <button type="button" disabled={target === undefined || busy !== undefined} onClick={() => void importFromSourcify()}>
            Import from Sourcify
          </button>
          <label className="file-input">
            <span>or load a solc standard-JSON input file</span>
            <input type="file" accept=".json,application/json" onChange={loadFile} />
          </label>
        </div>
        {origin !== undefined && <p className="muted">{origin} Verifiers will compile it themselves; where it came from proves nothing.</p>}
        <div className="row-form">
          <label className="grow">
            <span>Compiler version</span>
            <input value={compilerVersion} onChange={(event) => setCompilerVersion(event.target.value)} placeholder="0.8.24+commit.e11b9ed9" spellCheck={false} />
          </label>
          <label className="grow">
            <span>Contract to compare</span>
            <input value={contract} onChange={(event) => setContract(event.target.value)} placeholder="contracts/Token.sol:Token" spellCheck={false} />
          </label>
        </div>
        <label>
          <span>solc standard-JSON input</span>
          <textarea value={inputText} onChange={(event) => setInputText(event.target.value)} rows={10} spellCheck={false} placeholder='{ "language": "Solidity", "sources": { … }, "settings": { … } }' />
        </label>
        <p className="muted small">
          The bundle is compressed with brotli in your browser and must fit in {(MAX_SOURCE_PAYLOAD_BYTES / 1024).toFixed(0)} KiB.
        </p>
      </Section>

      <Section title="3. Sign">
        {wallet !== undefined && (
          <p className="muted">
            Connected as <Account address={wallet.address} full />.
          </p>
        )}
        <button type="button" className="primary" disabled={!ready || busy !== undefined} onClick={() => void submit()}>
          {busy ?? (wallet === undefined ? "Connect wallet and submit" : "Submit request")}
        </button>
        {problem !== undefined && <p className="inline-error">{problem}</p>}
      </Section>
    </>
  )
}
