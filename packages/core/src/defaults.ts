// The verifiers a fresh install trusts: the three run by the Arkify team. It is only a default.
// The web app and the CLI let every user replace it, and it never leaves their machine.
import type { Address } from "viem"

const TEAM_VERIFIERS: Record<Address, string> = {
  "0xB5F160b92c066f9613fb05227744c604683cB590": "verifier-a",
  "0xcF73f570D2F15C5A814D0D9D63164c4f99012E0E": "verifier-b",
  "0x86C783d97F9B1734ceAD7ac3Aeb12Bc5bC9DAe5C": "verifier-c",
}

export const DEFAULT_TRUSTED_VERIFIERS = Object.keys(TEAM_VERIFIERS) as readonly Address[]

/**
 * A label for a team verifier whose registration has lapsed, so its old attestations still read
 * well while it is offline. A live registration's own name always takes precedence.
 */
export function knownVerifierName(address: Address): string | undefined {
  const lower = address.toLowerCase()
  return Object.entries(TEAM_VERIFIERS).find(([known]) => known.toLowerCase() === lower)?.[1]
}
