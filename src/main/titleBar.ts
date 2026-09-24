import type { BrowserWindowConstructorOptions } from 'electron'

// Botones de ventana nativos del sistema, no dibujados por el launcher:
// - Windows y Linux: el propio sistema pinta minimizar, maximizar y cerrar
//   sobre la barra (Window Controls Overlay), con su aspecto y sus efectos,
//   incluido el menú de ajustar ventana de Windows 11 al pasar por maximizar.
// - macOS: los tres círculos de colores de siempre.
// La barra sigue siendo la del launcher (se puede arrastrar y lleva el
// título); solo los botones son del sistema.

/** Alto de la barra de título del launcher (h-9 en la interfaz). */
export const TITLE_BAR_HEIGHT = 36

export function nativeTitleBar(): BrowserWindowConstructorOptions {
  if (process.platform === 'darwin') {
    return {
      titleBarStyle: 'hidden',
      // Centrados en la barra de 36 px
      trafficLightPosition: { x: 14, y: 11 }
    }
  }
  return {
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#1a1a2e',       // bg-secondary
      symbolColor: '#94a3b8', // text-secondary
      height: TITLE_BAR_HEIGHT
    }
  }
}
