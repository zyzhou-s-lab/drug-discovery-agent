import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// Minimal Vite config for the Tier-A component starter.
// The `@` alias mirrors HAPI's so the lifted component files compile verbatim.
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            '@': resolve(__dirname, 'src')
        }
    },
    server: {
        host: true,
        proxy: {
            // forward API + SSE to the dd_agent uvicorn backend (DD_API_PROXY overrides)
            '/api': {
                target: process.env.DD_API_PROXY || 'http://127.0.0.1:8099',
                changeOrigin: true
            }
        }
    }
})
