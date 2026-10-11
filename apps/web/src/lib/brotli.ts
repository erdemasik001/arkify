// Brotli in the browser, as the Compression that source bundles expect. The WASM module is loaded
// only when a source is opened or submitted.
import type { Compression } from "@arkify/core"

export const browserBrotli: Compression = {
  async compress(bytes) {
    const brotli = await (await import("brotli-wasm")).default
    return brotli.compress(bytes, { quality: 11 })
  },
  /** Streams the output so that a hostile payload is cut off at `maxBytes` instead of filling memory. */
  async decompress(bytes, maxBytes) {
    const brotli = await (await import("brotli-wasm")).default
    const stream = new brotli.DecompressStream()
    const chunks: Uint8Array[] = []
    let total = 0
    let offset = 0
    for (;;) {
      const result = stream.decompress(bytes.subarray(offset), 1 << 20)
      chunks.push(result.buf)
      total += result.buf.length
      offset += result.input_offset
      if (total > maxBytes) throw new Error(`The source decompresses to more than ${maxBytes} bytes.`)
      if (result.code === brotli.BrotliStreamResultCode.ResultSuccess) break
      if (result.code === brotli.BrotliStreamResultCode.NeedsMoreInput && offset >= bytes.length) {
        throw new Error("The compressed source is truncated.")
      }
    }
    const out = new Uint8Array(total)
    let position = 0
    for (const chunk of chunks) {
      out.set(chunk, position)
      position += chunk.length
    }
    return out
  },
}
