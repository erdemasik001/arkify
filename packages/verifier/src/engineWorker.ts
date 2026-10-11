// Worker-thread entry: runs the engine off the main thread, so a compile that never ends can be
// cut off without taking the heartbeat down with it.
import { parentPort } from "node:worker_threads"
import type { SourceBundle, Target } from "@arkify/core"
import { rpcCodeReader, verify } from "@arkify/engine"

const readCode = rpcCodeReader()

parentPort?.on("message", (job: { id: number; input: { target: Target; bundle: SourceBundle } }) => {
  verify(job.input, { readCode }).then(
    (result) => parentPort?.postMessage({ id: job.id, result }),
    (error: unknown) =>
      parentPort?.postMessage({ id: job.id, error: error instanceof Error ? error.message : String(error) }),
  )
})
