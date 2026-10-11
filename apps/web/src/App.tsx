import { useSyncExternalStore } from "react"
import { getAddress, type Hex, isAddress, isHex } from "viem"
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
      Nothing lives at this address. <a href="#/">Go to the lookup.</a>
    </div>
  )
}

export function App() {
  const hash = useSyncExternalStore(subscribe, currentHash)
  const route = hash.replace(/^#\/?/, "").split(/[/?]/)[0]
  const link = (to: string, label: string, active: boolean) => (
    <a href={to} className={active ? "active" : undefined}>
      {label}
    </a>
  )
  return (
    <>
      <header className="topbar">
        <div className="container topbar-inner">
          <a href="#/" className="brand">
            <span className="brand-mark" aria-hidden="true">
              ✓
            </span>
            Arkify
          </a>
          <nav>
            {link("#/", "Look up", route === "" || route === "contract" || route === "source")}
            {link("#/verifiers", "Verifiers", route === "verifiers")}
            {link("#/request", "Request", route === "request")}
          </nav>
        </div>
      </header>
      <main className="container">
        <Page key={hash} hash={hash} />
      </main>
      <footer className="container footer">
        <p>
          No backend. Every answer on this site is read in your browser from{" "}
          <a href="https://arkiv.network" target="_blank" rel="noreferrer">
            Arkiv
          </a>{" "}
          (Tiramisu testnet) and a public Ethereum RPC.{" "}
          <a href="https://github.com/erdemasik001/arkify" target="_blank" rel="noreferrer">
            Source on GitHub
          </a>
          , MIT.
        </p>
      </footer>
    </>
  )
}
