// Fetches a candidate source bundle from Sourcify's public API.
// Sourcify is only where the candidate comes from. Whether it matches is decided by the verifiers.
import type { Target } from "./records"
import type { SolcInput, SourceBundle } from "./source"

const SOURCIFY = "https://sourcify.dev/server/v2/contract"

export class SourcifyError extends Error {
  constructor(
    target: Target,
    readonly status: number,
  ) {
    super(`Sourcify has no usable source for ${target.address} on chain ${target.chainId} (HTTP ${status}).`)
    this.name = "SourcifyError"
  }
}

export async function fetchSourcifyBundle(target: Target): Promise<SourceBundle> {
  const response = await fetch(
    `${SOURCIFY}/${target.chainId}/${target.address}?fields=stdJsonInput,compilation`,
  )
  if (!response.ok) throw new SourcifyError(target, response.status)
  const body = (await response.json()) as {
    stdJsonInput?: SolcInput
    compilation?: { compilerVersion?: string; fullyQualifiedName?: string }
  }
  const { compilerVersion, fullyQualifiedName } = body.compilation ?? {}
  if (body.stdJsonInput === undefined || compilerVersion === undefined || fullyQualifiedName === undefined) {
    throw new SourcifyError(target, response.status)
  }
  return { compilerVersion, contract: fullyQualifiedName, input: body.stdJsonInput }
}
