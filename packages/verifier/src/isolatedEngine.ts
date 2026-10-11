// Runs verifications in a worker thread with a deadline.
//
// Sources come from strangers. solc-js compiles synchronously, so a pathological input would freeze
// the whole verifier, heartbeat included, and its lease would lapse. Here the compile happens on
// another thread, and when it overruns the thread is terminated and replaced.
import { Worker } from "node:worker_threads"
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

export class IsolatedEngine {
  private worker: Worker | undefined
  private nextId = 0

  constructor(private readonly timeoutMs = 180_000) {}

  /**
   * @throws {VerificationAbortedError} If the run overran its deadline or the worker died.
   * @throws {Error} If the engine itself threw, i.e. the chain could not be read.
   */
  verify(input: { target: Target; bundle: SourceBundle }): Promise<Verification> {
    const worker = (this.worker ??= new Worker(new URL("./engineWorker.ts", import.meta.url)))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const finish = (settle: () => void, discardWorker: boolean) => {
        clearTimeout(deadline)
        worker.off("message", onMessage)
        worker.off("error", onError)
        worker.off("exit", onExit)
        if (discardWorker && this.worker === worker) {
          this.worker = undefined
          void worker.terminate()
        }
        settle()
      }
      const onMessage = (reply: Reply) => {
        if (reply.id !== id) return
        if (reply.result !== undefined) finish(() => resolve(reply.result as Verification), false)
        else finish(() => reject(new Error(reply.error ?? "the engine failed")), false)
      }
      const onError = (error: Error) =>
        finish(() => reject(new VerificationAbortedError(`The verification process failed: ${error.message}`)), true)
      const onExit = () =>
        finish(() => reject(new VerificationAbortedError("The verification process stopped unexpectedly.")), true)
      const deadline = setTimeout(
        () =>
          finish(
            () =>
              reject(
                new VerificationAbortedError(
                  `Verification did not finish within ${Math.round(this.timeoutMs / 1000)} s and was stopped.`,
                ),
              ),
            true,
          ),
        this.timeoutMs,
      )
      worker.on("message", onMessage)
      worker.once("error", onError)
      worker.once("exit", onExit)
      worker.postMessage({ id, input })
    })
  }

  async close(): Promise<void> {
    const worker = this.worker
    this.worker = undefined
    await worker?.terminate()
  }
}
