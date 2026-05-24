import { initializeApp, getApps } from 'firebase/app'
import { initializeAuth, indexedDBLocalPersistence } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey:            'AIzaSyBbQaYFl4a1Z3Mm-klrrJ3tQdRV53Cc77M',
  authDomain:        'fport1-social.firebaseapp.com',
  projectId:         'fport1-social',
  storageBucket:     'fport1-social.firebasestorage.app',
  messagingSenderId: '149599630571',
  appId:             '1:149599630571:web:7b5261dbb3b55aec993aae',
}

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig)

// Use indexedDB persistence — works in Electron (file:// and http://)
export const socialAuth = initializeAuth(app, {
  persistence: indexedDBLocalPersistence,
})

export const socialDb = getFirestore(app)
