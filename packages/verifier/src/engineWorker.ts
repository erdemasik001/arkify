// Child-process entry: runs the engine outside the verifier's own process, so a compile that never
// ends, or one that eats all the memory, can be cut off without taking the heartbeat down with it.
import type { SourceBundle, Target } from "@arkify/core"
import { rpcCodeReader, verify } from "@arkify/engine"

const readCode = rpcCodeReader()

process.on("message", (job: { id: number; input: { target: Target; bundle: SourceBundle } }) => {
  verify(job.input, { readCode }).then(
    (result) => process.send?.({ id: job.id, result }),
    (error: unknown) => process.send?.({ id: job.id, error: error instanceof Error ? error.message : String(error) }),
  )
})

// The verifier is gone: nothing is left to report to.
process.on("disconnect", () => process.exit(0))
