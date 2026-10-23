import { BrowserWindow, Menu, clipboard, shell, type MenuItemConstructorOptions } from 'electron'

// Menú del clic derecho para imágenes, enlaces y texto.
//
// Electron no trae ninguno: sin esto, clic derecho sobre una imagen o un texto no hacía
// nada (y «Copiar imagen» / «Copiar dirección» solo funcionaban donde había un botón).
// Las zonas del launcher que tienen su propio menú (instancias, archivos…) cancelan el
// evento en la página, y entonces este no aparece.

const isWeb = (url: string): boolean => /^https?:\/\//i.test(url)

export function attachContextMenu(win: BrowserWindow): void {
  const wc = win.webContents
  wc.on('context-menu', (_e, params) => {
    const items: MenuItemConstructorOptions[] = []

    if (params.mediaType === 'image' && params.srcURL) {
      items.push({ label: 'Copiar imagen', click: () => wc.copyImageAt(params.x, params.y) })
      if (!params.srcURL.startsWith('data:')) {
        items.push({ label: 'Copiar dirección de la imagen', click: () => clipboard.writeText(params.srcURL) })
      }
      if (isWeb(params.srcURL) || params.srcURL.startsWith('data:')) {
        items.push({ label: 'Guardar imagen como…', click: () => wc.downloadURL(params.srcURL) })
      }
    }

    if (params.linkURL && isWeb(params.linkURL)) {
      if (items.length) items.push({ type: 'separator' })
      items.push(
        { label: 'Abrir enlace en el navegador', click: () => { shell.openExternal(params.linkURL).catch(() => {}) } },
        { label: 'Copiar enlace', click: () => clipboard.writeText(params.linkURL) }
      )
    }

    if (params.isEditable) {
      if (items.length) items.push({ type: 'separator' })
      items.push(
        { label: 'Cortar', role: 'cut', enabled: params.editFlags.canCut },
        { label: 'Copiar', role: 'copy', enabled: params.editFlags.canCopy },
        { label: 'Pegar', role: 'paste', enabled: params.editFlags.canPaste },
        { type: 'separator' },
        { label: 'Seleccionar todo', role: 'selectAll' }
      )
    } else if (params.selectionText.trim()) {
      if (items.length) items.push({ type: 'separator' })
      items.push({ label: 'Copiar', role: 'copy' })
    }

    if (items.length) Menu.buildFromTemplate(items).popup({ window: win })
  })
}
