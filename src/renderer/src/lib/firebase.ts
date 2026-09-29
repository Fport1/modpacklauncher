import { initializeApp, getApps } from 'firebase/app'
import { initializeAuth, indexedDBLocalPersistence, onAuthStateChanged, type Persistence } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'

const firebaseConfig = {
  apiKey:            'AIzaSyBbQaYFl4a1Z3Mm-klrrJ3tQdRV53Cc77M',
  authDomain:        'fport1-social.firebaseapp.com',
  projectId:         'fport1-social',
  storageBucket:     'fport1-social.firebasestorage.app',
  messagingSenderId: '149599630571',
  appId:             '1:149599630571:web:7b5261dbb3b55aec993aae',
}

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig)

type Listener = (value: unknown) => void

/**
 * Persistencia de Firebase Auth en el proceso principal (ver
 * src/main/socialSession.ts). Sigue la forma interna que Firebase espera de una
 * persistencia (la misma que usa su versión para React Native): una clase con
 * `type` estático que Firebase instancia una vez.
 */
class LauncherPersistence {
  static type = 'LOCAL' as const
  readonly type = 'LOCAL' as const
  // Permite que Firebase traiga aquí una sesión que solo esté en IndexedDB
  readonly _shouldAllowMigration = true
  private listeners = new Map<string, Set<Listener>>()

  constructor() {
    window.api.socialSession.onChanged((key, value) => {
      this.listeners.get(key)?.forEach((l) => l(value))
    })
  }

  async _isAvailable(): Promise<boolean> {
    return typeof window !== 'undefined' && !!window.api?.socialSession
  }
  async _set(key: string, value: unknown): Promise<void> {
    await window.api.socialSession.set(key, value)
  }
  async _get<T>(key: string): Promise<T | null> {
    return (await window.api.socialSession.get(key)) as T | null
  }
  async _remove(key: string): Promise<void> {
    await window.api.socialSession.remove(key)
  }
  _addListener(key: string, listener: Listener): void {
    if (!this.listeners.has(key)) this.listeners.set(key, new Set())
    this.listeners.get(key)!.add(listener)
  }
  _removeListener(key: string, listener: Listener): void {
    this.listeners.get(key)?.delete(listener)
  }
}

// La primera disponible es la principal; IndexedDB queda detrás para recoger
// sesiones guardadas por versiones anteriores y migrarlas.
export const socialAuth = initializeAuth(app, {
  persistence: [LauncherPersistence as unknown as Persistence, indexedDBLocalPersistence],
})

// Si la sesión se cierra sola, que quede en la consola del launcher el motivo.
let hadUser = false
onAuthStateChanged(socialAuth, (u) => {
  if (hadUser && !u) console.warn('[fport1social] La sesión se ha cerrado')
  hadUser = !!u
})

export const socialDb = getFirestore(app)
export const socialStorage = getStorage(app)
