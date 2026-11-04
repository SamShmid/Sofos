import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    // CM6 packages must resolve to a single @codemirror/state copy (P56) —
    // a duplicate silently kills facets/extensions.
    dedupe: ["@codemirror/state", "@codemirror/view"],
  },
  server: {
    proxy: {
      // Forward /api to the backend in dev so there are no CORS issues
      "/api": { target: "http://localhost:3000", changeOrigin: true },
    },
  },
})
