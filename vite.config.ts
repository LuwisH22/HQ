import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * Tauri runs the dev server on a fixed port and cannot fall back to another one,
 * so the port is pinned and `strictPort` is enabled.
 */
const DEV_PORT = 1420

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      // Production builds get a stub in place of the development demo backend,
      // so its implementation, seed data and fictional accounts are physically
      // absent from the shipped bundle. Order matters: this must be matched
      // before the general '@' alias below.
      ...(mode === 'development'
        ? []
        : [
            {
              find: /^@\/services\/demo$/,
              replacement: path.resolve(import.meta.dirname, './src/services/demo/index.prod.ts'),
            },
            {
              find: /^@\/features\/demo$/,
              replacement: path.resolve(import.meta.dirname, './src/features/demo/index.prod.ts'),
            },
          ]),
      { find: '@', replacement: path.resolve(import.meta.dirname, './src') },
    ],
  },
  // Tauri expects a fixed dev server it can point the webview at.
  clearScreen: false,
  server: {
    port: DEV_PORT,
    strictPort: true,
    host: process.env.TAURI_DEV_HOST ?? false,
    watch: { ignored: ['**/src-tauri/**', '**/supabase/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: {
    // Tauri v2 targets a modern webview on every platform.
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
    minify: mode === 'development' ? false : 'esbuild',
    sourcemap: mode === 'development',
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // Split the vendor surface so each dependency lands in a chunk that
        // changes on its own schedule. Application code then invalidates
        // without dragging 300 kB of unchanged library bytes with it — which
        // matters most for the PWA, where these are fetched over the network.
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-supabase': ['@supabase/supabase-js'],
          'vendor-query': ['@tanstack/react-query'],
          'vendor-forms': ['zod', 'react-hook-form', '@hookform/resolvers/zod'],
          'vendor-dates': ['date-fns'],
        },
      },
    },
  },
}))
