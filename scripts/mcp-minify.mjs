// El servidor MCP se deja como archivo en el equipo del usuario (userData/ai) para
// que lo arranquen las IAs. Al compilar se compacta: sin comentarios ni nombres
// internos, con los textos que leen las IAs intactos. Lo usan electron.vite.config.ts
// (la app) y scripts/probar-canal-en-vivo.mjs (para probar el mismo script que se
// distribuye).
import { transformSync } from 'esbuild'

const START = 'export const MCP_SCRIPT = `'

/** Compacta el texto del script (JavaScript para Node, CommonJS). */
export function minifyMcpScript(raw) {
  return transformSync(raw, { minify: true, platform: 'node', format: 'cjs', target: 'node18', charset: 'utf8', legalComments: 'none' }).code
}

/** Recibe el código de src/main/aiMcpScript.ts y lo devuelve con MCP_SCRIPT ya compactado. */
export function minifyMcpModule(code) {
  const start = code.indexOf(START)
  const end = code.lastIndexOf('`')
  if (start < 0 || end <= start + START.length) throw new Error('aiMcpScript.ts: no se encuentra MCP_SCRIPT')
  // La plantilla no tiene ${}: evaluarla da el texto exacto que veía la app (con los \\ ya resueltos)
  const raw = new Function('return `' + code.slice(start + START.length, end) + '`')()
  return code.slice(0, start) + 'export const MCP_SCRIPT = ' + JSON.stringify(minifyMcpScript(raw)) + code.slice(end + 1)
}
