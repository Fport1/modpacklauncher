import { useEffect } from 'react'
import type { Instance, ModpackManifest } from '../../../shared/types'

interface Props {
  instance: Instance
  outputPath: string
  onClose: () => void
  manifest?: ModpackManifest
  modpackUrl?: string
  accessKey?: string
}

export default function FpackSaveModal({ instance, outputPath, onClose, manifest, modpackUrl, accessKey }: Props) {
  useEffect(() => {
    window.api.fpack.saveTo(instance.id, outputPath, manifest, modpackUrl, accessKey)
      .catch(() => {})
    onClose()
  }, [])

  return null
}
