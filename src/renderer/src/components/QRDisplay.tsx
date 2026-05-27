import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

interface Props {
  url: string
  filename?: string
  size?: number
}

export default function QRDisplay({ url, filename = 'qr.png', size = 220 }: Props) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    QRCode.toDataURL(url, {
      width: size * 2,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' }
    }).then(du => { if (!cancelled) setDataUrl(du) }).catch(() => {})
    return () => { cancelled = true }
  }, [url, size])

  async function save() {
    if (!dataUrl) return
    await window.api.qr.saveImage(dataUrl, filename)
  }

  if (!dataUrl) {
    return (
      <div style={{ width: size, height: size }} className="flex items-center justify-center bg-white rounded-lg">
        <svg className="animate-spin w-6 h-6 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 12a9 9 0 00-9-9"/>
        </svg>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <img
        src={dataUrl}
        alt="QR Code"
        width={size}
        height={size}
        className="rounded-lg cursor-context-menu select-none border border-border"
        style={{ imageRendering: 'pixelated' }}
        onContextMenu={e => { e.preventDefault(); save() }}
        draggable={false}
        title="Click derecho → Guardar imagen"
      />
      <button
        onClick={save}
        className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary transition-colors"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        Guardar imagen
      </button>
    </div>
  )
}
