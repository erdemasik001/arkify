import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"

// Everything the built site is allowed to talk to. The page has no backend of its own, and this
// makes the browser enforce it: Arkiv, the two EVM RPCs it reads bytecode from, and Sourcify for
// importing a candidate source.
const CONNECT = [
  "https://rpc.tiramisu.db-chain.testnet.arkiv.network",
  "wss://rpc.tiramisu.db-chain.testnet.arkiv.network",
  "https://ethereum-sepolia-rpc.publicnode.com",
  "https://ethereum-rpc.publicnode.com",
  "https://sourcify.dev",
]
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self'",
  "img-src 'self' data:",
  `connect-src 'self' ${CONNECT.join(" ")}`,
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
].join("; ")

/** Adds the policy to production builds only; the dev server's hot reload needs inline scripts. */
const contentSecurityPolicy: Plugin = {
  name: "arkify-csp",
  apply: "build",
  transformIndexHtml: () => [
    { tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: CSP }, injectTo: "head-prepend" },
  ],
}

// A relative base and hash routing: the build is plain static files that work from any path, on
// any static host, with no server-side rewrites.
// PORT, when set, is the port to use and nothing else will do; otherwise Vite's usual default,
// moving to the next free port if another project already has it.
const port = process.env.PORT === undefined ? undefined : Number(process.env.PORT)
const listen = port === undefined ? {} : { port, strictPort: true }

export default defineConfig({
  base: "./",
  plugins: [react(), contentSecurityPolicy],
  build: { target: "es2022" },
  server: listen,
  preview: listen,
})
