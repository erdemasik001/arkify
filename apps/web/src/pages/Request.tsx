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
import { type ChangeEvent, type ReactNode, useState, useSyncExternalStore } from "react"
import { getAddress, isAddress } from "viem"
import { Account, Icon, Mono } from "../components/ui"
import { ARKIV_EXPLORER, reader } from "../lib/arkiv"
import { browserBrotli } from "../lib/brotli"
import { CHAIN_IDS, CHAINS, type ChainId, isChainId } from "../lib/evm"
import { currentWallet, ensureWallet, subscribeWallet } from "../lib/wallet"

function Step({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return (
    <section className="step-card">
      <span className="step-number">{number}</span>
      <h2>{title}</h2>
      <div className="step-body">{children}</div>
    </section>
  )
}

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
      const count = Object.keys(bundle.input.sources).length
      setOrigin(`Imported ${count} file${count === 1 ? "" : "s"} from Sourcify.`)
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
          <span className="eyebrow">Request a verification</span>
          <h1>Your request is on Arkiv</h1>
          <p className="lede">Verifiers that are online hear about it over their event subscription and usually answer within seconds.</p>
        </header>
        <a className="btn btn-primary" href={`#/contract/${chain}/${target.address}`}>
          Watch the answers arrive
          <Icon name="arrow" />
        </a>
        <dl className="facts">
          <dt>Transaction</dt>
          <dd>
            <a className="mono link" href={`${ARKIV_EXPLORER}/tx/${done.txHash}`} target="_blank" rel="noreferrer">
              {done.txHash}
            </a>
          </dd>
          <dt>Request entity</dt>
          <dd>
            <Mono value={done.requestKey} full />
          </dd>
          <dt>Source</dt>
          <dd>
            <a className="mono link" href={`#/source/${done.sourceHash}?key=${done.sourceKey}`}>
              {done.sourceHash}
            </a>{" "}
            <span className="faint">({done.publishedSource ? "published in the same transaction" : "already on Arkiv, reused"})</span>
          </dd>
        </dl>
      </>
    )
  }

  const ready = target !== undefined && compilerVersion.trim() !== "" && contract.includes(":") && inputText.trim() !== ""
  return (
    <>
      <header className="page-head">
        <span className="eyebrow">Request a verification</span>
        <h1>Ask the verifiers to check a source</h1>
        <p className="lede">
          You sign one Arkiv transaction that stores the source and the request together. It needs a little testnet GLM from
          the{" "}
          <a className="link" href="https://hub.arkiv.network/faucet" target="_blank" rel="noreferrer">
            Arkiv faucet
          </a>
          . Sources are public and stay on Arkiv, so do not submit anything private.
        </p>
      </header>

      <div className="stepper">
        <Step number={1} title="The contract">
          <div className="form-row">
            <div className="field">
              <span>Chain</span>
              <div className="segmented" role="group" aria-label="Chain">
                {CHAIN_IDS.map((id) => (
                  <button type="button" key={id} aria-pressed={chain === id} onClick={() => setChain(id)}>
                    {CHAINS[id].name}
                  </button>
                ))}
              </div>
            </div>
            <label className="field grow">
              <span>Contract address</span>
              <input className="mono" value={address} onChange={(event) => setAddress(event.target.value)} placeholder="0x…" spellCheck={false} />
            </label>
          </div>
        </Step>

        <Step number={2} title="The source">
          <div className="form-row">
            <button type="button" className="btn" disabled={target === undefined || busy !== undefined} onClick={() => void importFromSourcify()}>
              <Icon name="layers" />
              Import from Sourcify
            </button>
            <label className="dropzone">
              <Icon name="file" />
              or load a solc standard-JSON input file
              <input type="file" accept=".json,application/json" onChange={loadFile} />
            </label>
          </div>
          {origin !== undefined && (
            <p className="muted">{origin} Where a source comes from proves nothing; the verifiers compile it themselves.</p>
          )}
          <div className="form-row">
            <label className="field grow">
              <span>Compiler version</span>
              <input className="mono" value={compilerVersion} onChange={(event) => setCompilerVersion(event.target.value)} placeholder="0.8.24+commit.e11b9ed9" spellCheck={false} />
            </label>
            <label className="field grow">
              <span>Contract to compare</span>
              <input className="mono" value={contract} onChange={(event) => setContract(event.target.value)} placeholder="contracts/Token.sol:Token" spellCheck={false} />
            </label>
          </div>
          <label className="field">
            <span>solc standard-JSON input</span>
            <textarea
              value={inputText}
              onChange={(event) => setInputText(event.target.value)}
              rows={9}
              spellCheck={false}
              placeholder='{ "language": "Solidity", "sources": { … }, "settings": { … } }'
            />
          </label>
          <p className="faint">
            Compressed with brotli in your browser; it must fit in {(MAX_SOURCE_PAYLOAD_BYTES / 1024).toFixed(0)} KiB.
          </p>
        </Step>

        <Step number={3} title="Sign">
          {wallet !== undefined && (
            <p className="muted">
              Connected as <Account address={wallet.address} full />
            </p>
          )}
          <div className="form-row">
            <button type="button" className="btn btn-primary" disabled={!ready || busy !== undefined} onClick={() => void submit()}>
              {busy ?? (wallet === undefined ? "Connect wallet and submit" : "Submit request")}
              {busy === undefined && <Icon name="arrow" />}
            </button>
          </div>
          {problem !== undefined && <p className="error-text">{problem}</p>}
        </Step>
      </div>
    </>
  )
}
