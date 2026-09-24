import { useSyncExternalStore } from 'react'
import { doc, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot, Timestamp, type Unsubscribe } from 'firebase/firestore'
import { socialAuth, socialDb } from '../firebase'
import type { AssistInstanceInfo } from '../../../../shared/types'
import { AssistChannel, ICE_SERVERS, makeCode, normalizeCode, waitIceGathering } from './channel'

// Asistencia remota en la ventana: la conexión entre los dos launchers.
//
// Firebase solo se usa para encontrarse: el anfitrión deja su "oferta" en
// assist/<código>, el ayudante deja su "respuesta" y a partir de ahí los dos
// equipos hablan directamente (WebRTC). El documento se borra en cuanto
// conectan, al cancelar, o al cerrar el launcher.
//
// El anfitrión decide: ve quién quiere entrar y lo acepta o lo rechaza, ve
// todo lo que se toca y puede cortar en cualquier momento.

const SESSION_MINUTES = 30

async function whoAmI(): Promise<{ uid: string; name: string }> {
  // Al arrancar el launcher la sesión de Firebase tarda un momento en recuperarse
  await socialAuth.authStateReady()
  const user = socialAuth.currentUser
  if (!user) throw new Error('Para usar la asistencia tenéis que haber iniciado sesión en «Amigos» los dos.')
  let name = user.displayName ?? user.email?.split('@')[0] ?? 'Alguien'
  try {
    const snap = await getDoc(doc(socialDb, 'users', user.uid))
    const d = snap.data() as { profileName?: string; username?: string } | undefined
    name = d?.profileName ?? d?.username ?? name
  } catch { /* sin perfil: el nombre de la cuenta vale */ }
  return { uid: user.uid, name }
}

function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  if (/permission|PERMISSION_DENIED|insufficient/i.test(msg)) {
    return 'Firebase no permite la asistencia todavía (faltan las reglas de la colección "assist").'
  }
  return msg
}

// ── Pequeño almacén observable para la interfaz ─────────────────────────────

function createStore<T>(initial: T) {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    get: () => state,
    set(patch: Partial<T>) { state = { ...state, ...patch }; listeners.forEach((l) => l()) },
    subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l) } }
  }
}

// ═══ Anfitrión (el que pide ayuda) ══════════════════════════════════════════

export interface HostState {
  phase: 'idle' | 'starting' | 'waiting' | 'request' | 'connecting' | 'connected' | 'ended'
  code?: string
  instance?: AssistInstanceInfo & { id: string }
  helperName?: string
  message?: string
  log: { t: number; text: string }[]
}

const hostStore = createStore<HostState>({ phase: 'idle', log: [] })
export const useAssistHost = (): HostState => useSyncExternalStore(hostStore.subscribe, hostStore.get)

let hostPc: RTCPeerConnection | null = null
let hostUnsub: Unsubscribe | null = null
let hostCode: string | null = null
let pendingAnswer: RTCSessionDescriptionInit | null = null

function hostLog(text: string): void {
  hostStore.set({ log: [...hostStore.get().log.slice(-99), { t: Date.now(), text }] })
}

const OP_TEXT: Record<string, string> = {
  write: 'Guardó', remove: 'Borró', rename: 'Renombró', mkdir: 'Creó la carpeta'
}

export async function startHosting(instanceId: string): Promise<void> {
  if (hostStore.get().phase !== 'idle' && hostStore.get().phase !== 'ended') throw new Error('Ya hay una sesión de ayuda abierta')
  hostStore.set({ phase: 'starting', log: [], message: undefined, helperName: undefined })
  try {
    const me = await whoAmI()
    const info = await window.api.assist.hostStart(instanceId)
    const code = makeCode()
    hostCode = code
    hostStore.set({ code, instance: { ...info, id: instanceId } })

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    hostPc = pc
    const dc = pc.createDataChannel('assist', { ordered: true })
    const channel = new AssistChannel(dc)

    dc.onopen = () => {
      hostStore.set({ phase: 'connected' })
      hostLog(`${hostStore.get().helperName ?? 'Tu amigo'} se ha conectado`)
      // Ya no hace falta: se borra para no dejar nada en Firebase
      if (hostCode) deleteDoc(doc(socialDb, 'assist', hostCode)).catch(() => {})
      hostUnsub?.()
      hostUnsub = null
    }
    dc.onclose = () => { if (hostStore.get().phase === 'connected') stopHosting('Tu amigo se ha desconectado') }
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') stopHosting('No se pudo mantener la conexión con tu amigo')
    }

    // Lo que pide el ayudante se hace en el proceso principal, siempre dentro de la instancia
    channel.onMessage(async (raw) => {
      const msg = raw as { t: string; id: string; op: string; args: Record<string, unknown> }
      if (msg.t !== 'req') return
      try {
        const result = await window.api.assist.hostOp(msg.op, msg.args)
        const path = String(msg.args.path ?? '')
        if (OP_TEXT[msg.op]) hostLog(`${OP_TEXT[msg.op]} ${path}${msg.op === 'rename' ? ` → ${msg.args.to}` : ''}`)
        else if (msg.op === 'read' && !msg.args.max && !/\.jar$/i.test(path)) hostLog(`Abrió ${path}`)
        await channel.send({ t: 'res', id: msg.id, ok: true, result })
      } catch (e) {
        await channel.send({ t: 'res', id: msg.id, ok: false, error: e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e) }).catch(() => {})
      }
    })

    await pc.setLocalDescription(await pc.createOffer())
    await waitIceGathering(pc)

    const ref = doc(socialDb, 'assist', code)
    await setDoc(ref, {
      hostUid: me.uid,
      hostName: me.name,
      instanceName: info.instanceName,
      minecraft: info.minecraft,
      loader: info.loader,
      offer: JSON.stringify(pc.localDescription),
      status: 'waiting',
      createdAt: Date.now(),
      expiresAt: Date.now() + SESSION_MINUTES * 60_000,
      // Para la política TTL de Firestore: borra solos los códigos que nadie usó
      expireAt: Timestamp.fromMillis(Date.now() + SESSION_MINUTES * 60_000)
    })
    hostStore.set({ phase: 'waiting' })
    hostLog(`Sesión creada para «${info.instanceName}». Código: ${code}`)

    hostUnsub = onSnapshot(ref, (snap) => {
      const d = snap.data() as { status?: string; answer?: string; helperName?: string } | undefined
      if (d?.status === 'requested' && d.answer && hostStore.get().phase === 'waiting') {
        pendingAnswer = JSON.parse(d.answer)
        hostStore.set({ phase: 'request', helperName: d.helperName ?? 'Alguien' })
      }
    })

    // Si nadie entra, el código caduca
    setTimeout(() => {
      if (hostCode === code && (hostStore.get().phase === 'waiting' || hostStore.get().phase === 'request')) {
        stopHosting('El código caducó sin que nadie entrara')
      }
    }, SESSION_MINUTES * 60_000)
  } catch (e) {
    await stopHosting(friendlyError(e))
  }
}

export async function acceptHelper(): Promise<void> {
  if (!hostPc || !pendingAnswer) return
  hostStore.set({ phase: 'connecting' })
  hostLog(`Aceptaste a ${hostStore.get().helperName}`)
  try {
    await hostPc.setRemoteDescription(pendingAnswer)
    pendingAnswer = null
  } catch (e) {
    await stopHosting(`No se pudo conectar: ${friendlyError(e)}`)
  }
}

export async function rejectHelper(): Promise<void> {
  await stopHosting(`Rechazaste a ${hostStore.get().helperName ?? 'quien quería entrar'}`)
}

export async function stopHosting(message = 'Terminaste la sesión de ayuda'): Promise<void> {
  hostUnsub?.()
  hostUnsub = null
  hostPc?.close()
  hostPc = null
  pendingAnswer = null
  const code = hostCode
  hostCode = null
  if (code) await deleteDoc(doc(socialDb, 'assist', code)).catch(() => {})
  await window.api.assist.hostStop().catch(() => {})
  if (hostStore.get().phase !== 'idle') {
    hostLog(message)
    hostStore.set({ phase: 'ended', message })
  }
}

export function dismissHost(): void {
  hostStore.set({ phase: 'idle', log: [], code: undefined, instance: undefined, helperName: undefined, message: undefined })
}

// ═══ Ayudante (el que ayuda) ════════════════════════════════════════════════

export interface HelperState {
  phase: 'idle' | 'connecting' | 'waiting' | 'connected' | 'error'
  message?: string
  hostName?: string
  instanceName?: string
}

const helperStore = createStore<HelperState>({ phase: 'idle' })
export const useAssistHelper = (): HelperState => useSyncExternalStore(helperStore.subscribe, helperStore.get)

let helperPc: RTCPeerConnection | null = null
let helperUnsub: Unsubscribe | null = null
let helperOff: Array<() => void> = []

export async function connectHelper(rawCode: string): Promise<void> {
  const code = normalizeCode(rawCode)
  helperStore.set({ phase: 'connecting', message: undefined })
  try {
    const me = await whoAmI()
    const ref = doc(socialDb, 'assist', code)
    const snap = await getDoc(ref)
    const d = snap.data() as {
      offer: string; status: string; expiresAt: number; hostName: string; hostUid: string
      instanceName: string; minecraft: string; loader: string
    } | undefined
    if (!snap.exists() || !d) throw new Error('Ese código no existe o la sesión ya terminó.')
    if (d.expiresAt < Date.now()) throw new Error('Ese código ha caducado. Pídele uno nuevo.')
    if (d.status !== 'waiting') throw new Error('Esa sesión ya la está usando otra persona.')
    if (d.hostUid === me.uid) throw new Error('Ese código es tuyo: tiene que usarlo tu amigo.')
    helperStore.set({ hostName: d.hostName, instanceName: d.instanceName })

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    helperPc = pc
    const info: AssistInstanceInfo = { instanceName: d.instanceName, minecraft: d.minecraft, loader: d.loader }

    pc.ondatachannel = (ev) => {
      const dc = ev.channel
      const channel = new AssistChannel(dc)
      dc.onopen = async () => {
        helperUnsub?.()
        helperUnsub = null
        // Lo que pide Servidores (en cualquier ventana) pasa por aquí hacia el amigo
        helperOff.push(window.api.assist.onCall((c) => {
          channel.send({ t: 'req', id: c.id, op: c.op, args: c.args }).catch((e) => {
            window.api.assist.reply({ id: c.id, ok: false, error: `connection closed: ${e instanceof Error ? e.message : e}` })
          })
        }))
        helperOff.push(window.api.assist.onHangup(() => { disconnectHelper() }))
        channel.onMessage((raw) => {
          const msg = raw as { t: string; id: string; ok: boolean; result?: unknown; error?: string }
          if (msg.t === 'res') window.api.assist.reply({ id: msg.id, ok: msg.ok, result: msg.result, error: msg.error })
        })
        await window.api.assist.helperStart(info, d.hostName)
        window.api.ftp.log('ok', `Conectado a la instancia «${d.instanceName}» de ${d.hostName}`)
        helperStore.set({ phase: 'connected' })
      }
      dc.onclose = () => {
        const was = helperStore.get().phase
        cleanupHelper()
        window.api.assist.helperClosed()
        if (was === 'connected') {
          window.api.ftp.log('info', `La sesión de ayuda con ${d.hostName} terminó`)
          helperStore.set({ phase: 'idle' })
        }
      }
    }
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        const was = helperStore.get().phase
        cleanupHelper()
        window.api.assist.helperClosed()
        helperStore.set({ phase: 'error', message: was === 'connected' ? 'Se perdió la conexión con tu amigo.' : 'No se pudo conectar con el equipo de tu amigo (puede que su red o la tuya lo bloqueen).' })
      }
    }

    await pc.setRemoteDescription(JSON.parse(d.offer))
    await pc.setLocalDescription(await pc.createAnswer())
    await waitIceGathering(pc)
    await updateDoc(ref, {
      answer: JSON.stringify(pc.localDescription),
      helperUid: me.uid,
      helperName: me.name,
      status: 'requested'
    })
    helperStore.set({ phase: 'waiting' })

    // Si el amigo rechaza o cancela, el documento desaparece antes de conectar
    helperUnsub = onSnapshot(ref, (s) => {
      if (!s.exists() && helperStore.get().phase === 'waiting') {
        cleanupHelper()
        helperStore.set({ phase: 'error', message: `${d.hostName} rechazó la conexión o cerró la sesión.` })
      }
    })
  } catch (e) {
    cleanupHelper()
    helperStore.set({ phase: 'error', message: friendlyError(e) })
  }
}

function cleanupHelper(): void {
  helperUnsub?.()
  helperUnsub = null
  helperOff.forEach((off) => off())
  helperOff = []
  helperPc?.close()
  helperPc = null
}

export function disconnectHelper(): void {
  const was = helperStore.get().phase
  cleanupHelper()
  if (was === 'connected') window.api.assist.helperClosed()
  helperStore.set({ phase: 'idle', message: undefined })
}

export function resetHelper(): void {
  if (helperStore.get().phase === 'error') helperStore.set({ phase: 'idle', message: undefined })
}

// Cerrar el launcher cierra la sesión (y borra el código de Firebase si quedaba)
window.addEventListener('beforeunload', () => {
  if (hostCode) deleteDoc(doc(socialDb, 'assist', hostCode)).catch(() => {})
  hostPc?.close()
  helperPc?.close()
})
