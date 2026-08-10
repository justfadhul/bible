import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The catalog lives at the project root, outside src/, because it is the
  // source of truth rather than application code. Vite resolves the JSON
  // import at build time and inlines it — there is no runtime fetch.
  base: './',
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
  },
})
