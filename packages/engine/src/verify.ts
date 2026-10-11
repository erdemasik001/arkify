// The verification engine: does this source bundle compile to the code deployed at this address?
import {
  type AttestationDetails,
  type SourceBundle,
  type Target,
  Verdict,
} from "@arkify/core"
import { type Hex, hexToBytes, keccak256 } from "viem"
import type { CodeReader } from "./chain"
import { compareRuntime, type Range } from "./compare"
import {
  type Compiler,
  CompilerUnavailableError,
  loadCompiler,
  UnknownCompilerError,
} from "./compiler"

export const ENGINE = "evm-solcjs"
export const ENGINE_VERSION = "0.1.0"

export type Verification = {
  verdict: Verdict
  /** keccak256 of the runtime bytecode read from the chain; the code this result is about. */
  codeHash: Hex
  details: AttestationDetails
}

export type VerifyDependencies = {
  readCode: CodeReader
  loadCompiler?: (version: string) => Promise<Compiler>
}

export type CompiledContract = {
  /** Runtime bytecode as emitted, with unlinked library placeholders zeroed. */
  code: Uint8Array
  /** Ranges set at deployment: immutables and linked library addresses. */
  masks: Range[]
}

/** The bundle cannot be the source of any contract: it does not build, or lacks the contract. */
export class SourceRejectedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SourceRejectedError"
  }
}

const UNLINKED = /__.{36}__/g

/**
 * Compiles a bundle and returns the named contract's runtime bytecode.
 *
 * @throws {SourceRejectedError} If the source does not compile or does not contain the contract.
 * @throws {UnknownCompilerError | CompilerUnavailableError} From loading the compiler.
 */
export async function compileBundle(
  bundle: SourceBundle,
  load: (version: string) => Promise<Compiler> = loadCompiler,
): Promise<CompiledContract> {
  if (bundle.input.language !== "Solidity") {
    throw new SourceRejectedError(`Language "${bundle.input.language}" is not supported by ${ENGINE}.`)
  }
  const separator = bundle.contract.lastIndexOf(":")
  const path = bundle.contract.slice(0, separator)
  const name = bundle.contract.slice(separator + 1)
  for (const [file, source] of Object.entries(bundle.input.sources)) {
    if (typeof source.content !== "string") {
      throw new SourceRejectedError(`Source file "${file}" has no inline content.`)
    }
  }

  const compiler = await load(bundle.compilerVersion)
  // Only the requested outputs change here; outputSelection is not part of the metadata hash.
  const output = compiler.compile({
    ...bundle.input,
    settings: {
      ...bundle.input.settings,
      outputSelection: {
        [path]: {
          [name]: [
            "evm.deployedBytecode.object",
            "evm.deployedBytecode.immutableReferences",
            "evm.deployedBytecode.linkReferences",
          ],
        },
      },
    },
  })

  const failure = output.errors?.find(({ severity }) => severity === "error")
  if (failure !== undefined) {
    const text = (failure.formattedMessage ?? failure.message ?? "unknown error").trim()
    throw new SourceRejectedError(`The source does not compile: ${text.slice(0, 400)}`)
  }
  const bytecode = output.contracts?.[path]?.[name]?.evm?.deployedBytecode
  if (bytecode?.object === undefined || bytecode.object === "") {
    throw new SourceRejectedError(`The compilation output has no deployable contract "${bundle.contract}".`)
  }

  const masks: Range[] = Object.values(bytecode.immutableReferences ?? {}).flat()
  for (const libraries of Object.values(bytecode.linkReferences ?? {})) {
    masks.push(...Object.values(libraries).flat())
  }
  return { code: hexToBytes(`0x${bytecode.object.replace(UNLINKED, "0".repeat(40))}`), masks }
}

/**
 * Verifies a source bundle against the code deployed at an address.
 *
 * Deterministic failures (no code, unknown compiler, source does not compile, bytecode differs)
 * are `mismatch`: every honest verifier reaches the same answer. A problem on this verifier's side
 * (compiler download failed) is `error`. Failing to read the chain throws instead, because without
 * the deployed code there is nothing to attest to.
 */
export async function verify(
  input: { target: Target; bundle: SourceBundle },
  dependencies: VerifyDependencies,
): Promise<Verification> {
  const started = Date.now()
  const onchain = hexToBytes(await dependencies.readCode(input.target))
  const codeHash = keccak256(onchain)
  const result = (verdict: Verdict, extra: Partial<AttestationDetails> = {}): Verification => ({
    verdict,
    codeHash,
    details: {
      engine: ENGINE,
      engineVersion: ENGINE_VERSION,
      durationMs: Date.now() - started,
      ...extra,
    },
  })

  if (onchain.length === 0) {
    return result(Verdict.Mismatch, { message: "There is no contract code at this address." })
  }
  let compiled: CompiledContract
  try {
    compiled = await compileBundle(input.bundle, dependencies.loadCompiler)
  } catch (error) {
    if (error instanceof SourceRejectedError || error instanceof UnknownCompilerError) {
      return result(Verdict.Mismatch, { message: error.message })
    }
    if (error instanceof CompilerUnavailableError) return result(Verdict.Error, { message: error.message })
    throw error
  }
  const comparison = compareRuntime(onchain, compiled)
  return result(comparison.verdict, {
    compiledCodeHash: keccak256(compiled.code),
    ...(comparison.message !== undefined && { message: comparison.message }),
  })
}
