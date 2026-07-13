import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Forward /api to the backend in dev so there are no CORS issues
      "/api": { target: "http://localhost:3000", changeOrigin: true },
    },
  },
})
