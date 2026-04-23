import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import os from 'os'

const cacheDir = resolve(os.tmpdir(), 'modpack-launcher-vite')

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    cacheDir,
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    cacheDir
  },
  renderer: {
    cacheDir,
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react()]
  }
})
