import { explainError } from "@arkify/core"
import type { Expiry } from "@arkiv-network/sdk/utils"
import { useState } from "react"
import type { Hex } from "viem"
import { ARKIV_EXPLORER } from "../lib/arkiv"
import { ensureWallet } from "../lib/wallet"

/**
 * Extends the life of an entity the visitor does not own. Requests, sources and attestations are
 * created with `permissionlessExtension`, so anyone who relies on one can keep it on Arkiv, and
 * nobody but its owner can change it.
 */
export function KeepAlive({ entityKey, lifetime, label, onDone }: { entityKey: Hex; lifetime: Expiry; label: string; onDone?: () => void }) {
  const [state, setState] = useState<{ busy?: boolean; txHash?: Hex; error?: string }>({})

  async function extend() {
    setState({ busy: true })
    try {
      const wallet = await ensureWallet()
      const { txHash } = await wallet.client.extendEntity({ entityKey, expires: lifetime })
      setState({ txHash })
      onDone?.()
    } catch (error) {
      setState({ error: explainError(error) })
    }
  }

  if (state.txHash !== undefined) {
    return (
      <a className="link" href={`${ARKIV_EXPLORER}/tx/${state.txHash}`} target="_blank" rel="noreferrer">
        Extended
      </a>
    )
  }
  return (
    <button
      type="button"
      className="btn btn-sm btn-ghost"
      disabled={state.busy}
      onClick={() => void extend()}
      title={state.error ?? `Sign a Lifetime Extension with your wallet: ${label}. Anyone may; only the owner can change the entity.`}
    >
      {state.busy ? "Signing…" : state.error !== undefined ? "Failed, retry" : "Keep alive"}
    </button>
  )
}
