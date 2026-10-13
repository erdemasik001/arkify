// Runs verifications in a child process with a deadline and a memory ceiling.
//
// Sources come from strangers. solc-js compiles synchronously, so a pathological input would freeze
// the whole verifier, heartbeat included, and its lease would lapse; one that needs gigabytes would
// get the verifier killed, and after a restart the same request would kill it again. So the compile
// happens in a process of its own. When it overruns its time or its memory it is killed and
// replaced, the request gets an `error` attestation, and the verifier carries on.
//
// A process rather than a thread because only a process hands its memory back when it ends, which
// is also what makes its memory use measurable.
import { type ChildProcess, execFileSync, fork } from "node:child_process"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import type { SourceBundle, Target } from "@arkify/core"
import type { Verification } from "@arkify/engine"

/** The verification was cut off. Says nothing about the contract. */
export class VerificationAbortedError extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = "VerificationAbortedError"
  }
}

type Reply = { id: number; result?: Verification; error?: string }

/** Resident memory of a process in MB: from /proc on Linux, from `ps` elsewhere. */
function residentMb(pid: number): number {
  try {
    const pages = Number(readFileSync(`/proc/${pid}/statm`, "utf8").split(" ")[1])
    return (pages * 4096) / (1024 * 1024)
  } catch {
    try {
      return Number(execFileSync("ps", ["-o", "rss=", "-p", String(pid)], { encoding: "utf8" })) / 1024
    } catch {
      return 0
    }
  }
}

export class IsolatedEngine {
  private child: ChildProcess | undefined
  private nextId = 0

  constructor(
    private readonly timeoutMs = 180_000,
    /** Memory of the engine process, in MB, above which a running verification is stopped. */
    private readonly memoryLimitMb = 768,
  ) {}

  /**
   * @throws {VerificationAbortedError} If the run overran its deadline or its memory, or the engine died.
   * @throws {Error} If the engine itself threw, i.e. the chain could not be read.
   */
  verify(input: { target: Target; bundle: SourceBundle }): Promise<Verification> {
    // `advanced` serialisation, because a target carries a bigint chain ID.
    const child = (this.child ??= fork(fileURLToPath(new URL("./engineWorker.ts", import.meta.url)), {
      serialization: "advanced",
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    }))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const finish = (settle: () => void, discard: boolean) => {
        clearTimeout(deadline)
        clearInterval(memoryWatch)
        child.off("message", onMessage)
        child.off("error", onError)
        child.off("exit", onExit)
        if (discard && this.child === child) {
          this.child = undefined
          child.kill("SIGKILL")
        }
        settle()
      }
      const abort = (reason: string) => finish(() => reject(new VerificationAbortedError(reason)), true)
      const onMessage = (reply: Reply) => {
        if (reply.id !== id) return
        // Loaded compilers stay in the engine's memory. Once they take up half the budget, the next
        // verification gets a fresh process rather than less room to compile in.
        const crowded = child.pid !== undefined && residentMb(child.pid) > this.memoryLimitMb / 2
        if (reply.result !== undefined) finish(() => resolve(reply.result as Verification), crowded)
        else finish(() => reject(new Error(reply.error ?? "the engine failed")), crowded)
      }
      const onError = (error: Error) => abort(`The verification process failed: ${error.message}`)
      const onExit = () => abort("The verification process was stopped by the system, most likely for using too much memory.")
      const deadline = setTimeout(
        () => abort(`Verification did not finish within ${Math.round(this.timeoutMs / 1000)} s and was stopped.`),
        this.timeoutMs,
      )
      const memoryWatch = setInterval(() => {
        if (child.pid === undefined || residentMb(child.pid) <= this.memoryLimitMb) return
        abort(`Verification needed more than the ${this.memoryLimitMb} MB this verifier allows and was stopped.`)
      }, 500)
      child.on("message", onMessage)
      child.once("error", onError)
      child.once("exit", onExit)
      child.send({ id, input })
    })
  }

  async close(): Promise<void> {
    const child = this.child
    this.child = undefined
    child?.kill("SIGKILL")
  }
}
