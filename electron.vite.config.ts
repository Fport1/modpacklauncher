import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import os from 'os'
import { readFileSync } from 'fs'
import { minifyMcpModule } from './scripts/mcp-minify.mjs'

const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf-8'))
const cacheDir = resolve(os.tmpdir(), 'modpack-launcher-vite')
const versionDefine = { __APP_VERSION__: JSON.stringify(pkg.version) }

// El servidor MCP que se escribe en el equipo del usuario sale compactado (ver scripts/mcp-minify.mjs)
const mcpMinify = {
  name: 'mcp-minify',
  enforce: 'pre' as const,
  transform(code: string, id: string) {
    return id.replace(/\\/g, '/').endsWith('src/main/aiMcpScript.ts') ? { code: minifyMcpModule(code), map: null } : null
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), mcpMinify],
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
      exclude: ['monaco-editor'],
      include: ['three', 'three/examples/jsm/controls/OrbitControls.js']
    }
  }
})
