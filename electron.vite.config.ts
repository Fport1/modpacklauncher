import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import os from 'os'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf-8'))
const cacheDir = resolve(os.tmpdir(), 'modpack-launcher-vite')
const versionDefine = { __APP_VERSION__: JSON.stringify(pkg.version) }

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    cacheDir,
    define: versionDefine,
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    cacheDir,
    define: versionDefine
  },
  renderer: {
    cacheDir,
    define: versionDefine,
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react()],
    optimizeDeps: {
      exclude: ['monaco-editor']
    }
  }
})
