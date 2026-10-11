import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// A relative base and hash routing: the build is plain static files that work from any path, on
// any static host, with no server-side rewrites.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: { target: "es2022" },
  server: { port: 5173, strictPort: true },
})
