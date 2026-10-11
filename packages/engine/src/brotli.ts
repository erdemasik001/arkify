// Brotli for Node, as the `Compression` that @arkify/core's source bundles expect.
import { brotliCompressSync, brotliDecompressSync, constants } from "node:zlib"
import type { Compression } from "@arkify/core"

export const nodeBrotli: Compression = {
  compress: (bytes) =>
    brotliCompressSync(bytes, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
        [constants.BROTLI_PARAM_SIZE_HINT]: bytes.length,
      },
    }),
  decompress: (bytes, maxBytes) => brotliDecompressSync(bytes, { maxOutputLength: maxBytes }),
}
