// Loads the exact solc release a source bundle names and compiles with it.
//
// Compilers are the official solc-js builds from binaries.soliditylang.org. A version is accepted
// only if the official release list names it, and a download is used only if its SHA-256 matches
// that list. The version string comes from an untrusted source bundle, so it is validated before
// it is turned into a URL or a file path.
import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { join, resolve } from "node:path"
import type { SolcInput } from "@arkify/core"

const require = createRequire(import.meta.url)
const wrapper = require("solc/wrapper") as (soljson: unknown) => {
  version(): string
  compile(input: string): string
}

const BINARIES = "https://binaries.soliditylang.org/bin"
const RELEASE = /^\d+\.\d+\.\d+\+commit\.[0-9a-f]{8}$/

/** The bundle names a compiler that is not an official solc release. Deterministic. */
export class UnknownCompilerError extends Error {
  constructor(version: string) {
    super(`"${version}" is not an official solc release.`)
    this.name = "UnknownCompilerError"
  }
}

/** The compiler could not be fetched or loaded right now. Worth retrying. */
export class CompilerUnavailableError extends Error {
  constructor(version: string, reason: string) {
    super(`solc ${version} is unavailable: ${reason}`)
    this.name = "CompilerUnavailableError"
  }
}

export type SolcOutput = {
  errors?: { severity: string; formattedMessage?: string; message?: string }[]
  contracts?: Record<
    string,
    Record<
      string,
      {
        evm?: {
          deployedBytecode?: {
            object?: string
            immutableReferences?: Record<string, { start: number; length: number }[]>
            linkReferences?: Record<string, Record<string, { start: number; length: number }[]>>
          }
        }
      }
    >
  >
}

export type Compiler = {
  /** The long version, e.g. `0.8.24+commit.e11b9ed9`. */
  version: string
  compile(input: SolcInput): SolcOutput
}

type Build = { path: string; sha256: string }

let releases: Promise<Map<string, Build>> | undefined
const loaded = new Map<string, Promise<Compiler>>()

async function officialReleases(): Promise<Map<string, Build>> {
  const response = await fetch(`${BINARIES}/list.json`)
  if (!response.ok) throw new Error(`the release list answered HTTP ${response.status}`)
  const list = (await response.json()) as {
    builds: { path: string; longVersion: string; sha256: string; prerelease?: string }[]
  }
  return new Map(
    list.builds
      .filter((build) => build.prerelease === undefined)
      .map((build) => [build.longVersion, { path: build.path, sha256: build.sha256 }]),
  )
}

function sha256(bytes: Uint8Array): string {
  return `0x${createHash("sha256").update(bytes).digest("hex")}`
}

export async function fetchVerified(build: Build, cacheDir: string): Promise<string> {
  // `.cjs`, so Node loads the build as CommonJS even when the cache sits inside an ESM package.
  const file = join(cacheDir, build.path.replace(/\.js$/, ".cjs"))
  const cached = await readFile(file).catch(() => undefined)
  if (cached !== undefined && sha256(cached) === build.sha256) return file

  const response = await fetch(`${BINARIES}/${build.path}`)
  if (!response.ok) throw new Error(`the download answered HTTP ${response.status}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (sha256(bytes) !== build.sha256) throw new Error("the download does not match its published SHA-256")
  await mkdir(cacheDir, { recursive: true })
  // Verifiers that share a cache can fetch the same build at the same time. Each writes its own
  // temporary file; the copies are identical and a rename is atomic, so whichever lands last wins.
  const partial = `${file}.${process.pid}.${randomUUID()}.partial`
  await writeFile(partial, bytes)
  await rename(partial, file)
  return file
}

/** Emscripten builds hook process-wide error events when they load; a library must not. */
function withoutNewListeners<T>(load: () => T): T {
  const events = ["uncaughtException", "unhandledRejection"] as const
  const before = events.map((event) => new Set(process.listeners(event as "uncaughtException")))
  try {
    return load()
  } finally {
    events.forEach((event, index) => {
      for (const listener of process.listeners(event as "uncaughtException")) {
        if (!before[index]?.has(listener)) process.removeListener(event, listener)
      }
    })
  }
}

async function load(version: string, cacheDir: string): Promise<Compiler> {
  if (!RELEASE.test(version)) throw new UnknownCompilerError(version)
  let build: Build | undefined
  try {
    releases ??= officialReleases()
    build = (await releases).get(version)
  } catch (error) {
    releases = undefined
    throw new CompilerUnavailableError(version, error instanceof Error ? error.message : String(error))
  }
  if (build === undefined) throw new UnknownCompilerError(version)
  try {
    const file = await fetchVerified(build, cacheDir)
    const solc = withoutNewListeners(() => wrapper(require(file)))
    return {
      version,
      compile: (input) => JSON.parse(solc.compile(JSON.stringify(input))) as SolcOutput,
    }
  } catch (error) {
    throw new CompilerUnavailableError(version, error instanceof Error ? error.message : String(error))
  }
}

/**
 * The compiler for an exact solc version. Downloaded once, then served from `cacheDir`.
 *
 * @throws {UnknownCompilerError} If the version is not an official release.
 * @throws {CompilerUnavailableError} If it cannot be fetched or loaded right now.
 */
export function loadCompiler(
  version: string,
  cacheDir = resolve(process.env.ARKIFY_SOLC_CACHE ?? ".solc-cache"),
): Promise<Compiler> {
  const key = `${cacheDir}\n${version}`
  let compiler = loaded.get(key)
  if (compiler === undefined) {
    compiler = load(version, cacheDir)
    loaded.set(key, compiler)
    compiler.catch(() => loaded.delete(key))
  }
  return compiler
}
