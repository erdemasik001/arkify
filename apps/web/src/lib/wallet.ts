// The browser wallet: the only way this app writes. It signs Arkiv transactions on Tiramisu.
import type { Writer } from "@arkify/core"
import { createWalletClient, type WalletArkivClient } from "@arkiv-network/sdk"
import { tiramisu } from "@arkiv-network/sdk/chains"
import { type Address, custom, type EIP1193Provider, getAddress, numberToHex } from "viem"
import { ARKIV_EXPLORER, RPC_URL } from "./arkiv"

export type Wallet = { address: Address; client: WalletArkivClient & Writer }

type Injected = EIP1193Provider & { request(args: { method: string; params?: unknown[] }): Promise<unknown> }

export class WalletError extends Error {}

export async function connectWallet(): Promise<Wallet> {
  const provider = (window as { ethereum?: Injected }).ethereum
  if (provider === undefined) {
    throw new WalletError("No browser wallet was found. Install one (for example MetaMask) to write to Arkiv.")
  }
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[]
  const [account] = accounts
  if (account === undefined) throw new WalletError("The wallet did not share an account.")

  const chainId = numberToHex(tiramisu.id)
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] })
  } catch {
    // The wallet does not know Tiramisu yet: add it, which also switches to it.
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId,
          chainName: "Arkiv Tiramisu",
          nativeCurrency: tiramisu.nativeCurrency,
          rpcUrls: [RPC_URL],
          blockExplorerUrls: [ARKIV_EXPLORER],
        },
      ],
    })
  }

  const address = getAddress(account)
  const client = createWalletClient({ chain: tiramisu, transport: custom(provider), account: address })
  return { address, client: client as unknown as Wallet["client"] }
}

// One wallet connection for the whole app.
let wallet: Wallet | undefined
const subscribers = new Set<() => void>()

export async function ensureWallet(): Promise<Wallet> {
  if (wallet === undefined) {
    wallet = await connectWallet()
    subscribers.forEach((notify) => notify())
  }
  return wallet
}

export const currentWallet = () => wallet
export function subscribeWallet(notify: () => void): () => void {
  subscribers.add(notify)
  return () => subscribers.delete(notify)
}
