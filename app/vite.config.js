import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte()],
  // Fixed port: tauri.conf.json devUrl and playwright.config.js point at it; fail instead of drifting.
  server: { port: 5175, strictPort: true },
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        settings: resolve(import.meta.dirname, 'settings.html'),
        pattern_editor: resolve(import.meta.dirname, 'pattern-editor.html'),
      },
    },
  },
})
