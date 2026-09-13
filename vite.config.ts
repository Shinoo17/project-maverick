import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: { main: 'index.html', vapor: 'vapor-preview.html', exhaust: 'exhaust-preview.html', hud: 'hud-preview.html' },
      output: {
        manualChunks: {
          three: ['three'],
          scene: ['@react-three/fiber', '@react-three/drei'],
        },
      },
    },
  },
})
