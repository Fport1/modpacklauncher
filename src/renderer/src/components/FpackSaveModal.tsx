import { useEffect } from 'react'
import type { Instance, ModpackManifest } from '../../../shared/types'

interface Props {
  instance: Instance
  outputPath: string
  onClose: () => void
  manifest?: ModpackManifest
}

export default function FpackSaveModal({ instance, outputPath, onClose, manifest }: Props) {
  useEffect(() => {
    window.api.fpack.saveTo(instance.id, outputPath, manifest)
      .catch(() => {})
    onClose()
  }, [])

  return null
}
