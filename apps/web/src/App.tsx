import "@fontsource-variable/alexandria"
import "@fontsource-variable/geist"
import "@fontsource-variable/geist-mono"
import { useEffect, useSyncExternalStore } from "react"
import { getAddress, type Hex, isAddress, isHex } from "viem"
import { Icon, LiveIndicator } from "./components/ui"
import { ARKIV_EXPLORER } from "./lib/arkiv"
import { isChainId } from "./lib/evm"
import { Contract } from "./pages/Contract"
import { Home } from "./pages/Home"
import { Request } from "./pages/Request"
import { Source } from "./pages/Source"
import { Verifiers } from "./pages/Verifiers"

const REPOSITORY = "https://github.com/erdemasik001/arkify"

// Hash routing: the whole app is static files, so it runs from any host without rewrites.
function subscribe(notify: () => void): () => void {
  window.addEventListener("hashchange", notify)
  return () => window.removeEventListener("hashchange", notify)
}
const currentHash = () => window.location.hash

const isKey = (value: string | undefined | null): value is Hex =>
  typeof value === "string" && isHex(value) && value.length === 66

function Page({ hash }: { hash: string }) {
  const [path = "", search = ""] = hash.replace(/^#\/?/, "").split("?")
  const [route, first, second] = path.split("/")
  const query = new URLSearchParams(search)

  if (route === "contract" && first !== undefined && isChainId(first) && second !== undefined && isAddress(second, { strict: false })) {
    return <Contract chainId={first} address={getAddress(second)} />
  }
  if (route === "source" && isKey(first)) {
    const key = query.get("key")
    return <Source sourceHash={first} preferredKey={isKey(key) ? key : undefined} />
  }
  if (route === "verifiers") return <Verifiers />
  if (route === "request") {
    return <Request initialChain={query.get("chain") ?? undefined} initialAddress={query.get("address") ?? undefined} />
  }
  return (
    <div className="note">
      <Icon name="help" />
      <div>
        Nothing lives at this address.{" "}
        <a className="link" href="#/">
          Go to the lookup.
        </a>
      </div>
    </div>
  )
}

export function App() {
  const hash = useSyncExternalStore(subscribe, currentHash)
  const route = hash.replace(/^#\/?/, "").split(/[/?]/)[0]
  // A new page starts at its top; the browser would otherwise keep the previous page's scroll.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [hash])
  const link = (to: string, label: string, active: boolean) => (
    <a href={to} className={active ? "active" : undefined} aria-current={active ? "page" : undefined}>
      {label}
    </a>
  )
  return (
    <>
      <header className="topbar">
        <div className="container topbar-inner">
          <a href="#/" className="brand">
            <span className="brand-mark">
              <Icon name="check" />
            </span>
            Arkify
          </a>
          <nav className="nav">
            {link("#/", "Look up", route === "" || route === "contract" || route === "source")}
            {link("#/verifiers", "Verifiers", route === "verifiers")}
            <a className="nav-ext" href={REPOSITORY} target="_blank" rel="noreferrer">
              GitHub
              <Icon name="external" />
            </a>
          </nav>
          <div className="topbar-end">
            <LiveIndicator />
            <a className="btn btn-primary" href="#/request" aria-current={route === "request" ? "page" : undefined}>
              <span>
                Request<span className="wide-only"> a check</span>
              </span>
            </a>
          </div>
        </div>
      </header>
      <main>
        {route === "" ? (
          <Home key={hash} />
        ) : (
          <div className="container page">
            <Page key={hash} hash={hash} />
          </div>
        )}
      </main>
      <footer className="footer">
        <div className="container footer-grid">
          <div className="footer-brand">
            <a href="#/" className="brand">
              <span className="brand-mark">
                <Icon name="check" />
              </span>
              Arkify
            </a>
            <p className="footer-blurb">
              No backend. Every answer is read in your browser from Arkiv (Tiramisu testnet) and a public Ethereum RPC.
            </p>
          </div>
          <div>
            <h4>Use it</h4>
            <ul>
              <li>
                <a href="#/">Look up a contract</a>
              </li>
              <li>
                <a href="#/verifiers">Choose your verifiers</a>
              </li>
              <li>
                <a href="#/request">Request a check</a>
              </li>
            </ul>
          </div>
          <div>
            <h4>Read it yourself</h4>
            <ul>
              <li>
                <a href={REPOSITORY} target="_blank" rel="noreferrer">
                  Source on GitHub
                </a>
              </li>
              <li>
                <a href={`${REPOSITORY}/blob/main/arkiv/schema.md`} target="_blank" rel="noreferrer">
                  Data schema
                </a>
              </li>
              <li>
                <a href={ARKIV_EXPLORER} target="_blank" rel="noreferrer">
                  Arkiv explorer
                </a>
              </li>
            </ul>
          </div>
          <div>
            <h4>Run it</h4>
            <ul>
              <li>
                <a href={`${REPOSITORY}#readme`} target="_blank" rel="noreferrer">
                  Run a verifier
                </a>
              </li>
              <li>
                <a href="https://hub.arkiv.network/faucet" target="_blank" rel="noreferrer">
                  Testnet GLM faucet
                </a>
              </li>
              <li>Open source, MIT</li>
            </ul>
          </div>
        </div>
        <div className="container footer-base">Attestations are signed by their verifiers. Arkify only shows you where to look.</div>
      </footer>
    </>
  )
}
