import "@fontsource-variable/geist"
import "@fontsource-variable/geist-mono"
import { useSyncExternalStore } from "react"
import { getAddress, type Hex, isAddress, isHex } from "viem"
import { Icon, LiveIndicator } from "./components/ui"
import { isChainId } from "./lib/evm"
import { Contract } from "./pages/Contract"
import { Home } from "./pages/Home"
import { Request } from "./pages/Request"
import { Source } from "./pages/Source"
import { Verifiers } from "./pages/Verifiers"

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
  if (route === "") return <Home />
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
            {link("#/request", "Request", route === "request")}
          </nav>
          <div className="topbar-end">
            <LiveIndicator />
            <a className="icon-link" href="https://github.com/erdemasik001/arkify" target="_blank" rel="noreferrer" aria-label="Source on GitHub">
              <Icon name="github" />
            </a>
          </div>
        </div>
      </header>
      <main className="container">
        <Page key={hash} hash={hash} />
      </main>
      <footer className="container footer">
        <span>No backend. Every answer is read in your browser from Arkiv (Tiramisu testnet) and a public Ethereum RPC.</span>
        <span>
          <a href="https://github.com/erdemasik001/arkify" target="_blank" rel="noreferrer">
            Open source, MIT
          </a>
        </span>
      </footer>
    </>
  )
}
