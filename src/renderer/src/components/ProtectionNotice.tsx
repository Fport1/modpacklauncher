import { useEffect } from 'react'
import type { ModpackProtection } from '../../../shared/types'
import { useStore } from '../store'

// Aviso antes de instalar un modpack protegido: cuándo caduca (en tu hora y en la del
// creador), con qué cuenta habrá que jugarlo y qué se podrá cambiar.

function fmt(ms: number, timeZone?: string): string {
  try {
    return new Date(ms).toLocaleString('es', { dateStyle: 'full', timeStyle: 'short', ...(timeZone ? { timeZone } : {}) })
  } catch {
    return new Date(ms).toLocaleString('es')
  }
}

export default function ProtectionNotice({ protection, accountId, onAccount }: {
  protection: ModpackProtection
  accountId: string | null
  onAccount: (id: string) => void
}) {
  const accounts = useStore((s) => s.accounts)
  const activeId = useStore((s) => s.activeAccountId)
  const myTz = Intl.DateTimeFormat().resolvedOptions().timeZone

  // Por defecto, la cuenta activa
  useEffect(() => {
    if (protection.account && !accountId && accounts.length) onAccount(activeId ?? accounts[0].id)
  }, [protection.account, accountId, accounts.length, activeId])

  const a = protection.allow
  const rules = [
    { ok: a.options, text: 'Cambiar los ajustes del juego' },
    { ok: a.packs, text: 'Poner o quitar resource packs y shaders' },
    { ok: a.mods, text: 'Añadir mods propios' },
    { ok: a.files, text: 'Ver las carpetas y la configuración' },
    { ok: false, text: 'Duplicar, exportar o pasar su contenido a otra instancia' },
  ]

  return (
    <div className="bg-amber-500/5 border border-amber-500/30 rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-base">🔒</span>
        <p className="text-sm font-semibold text-amber-200">Modpack protegido por su creador</p>
      </div>

      {protection.expiresAt && (
        <div className="text-xs space-y-0.5">
          <p className="text-text-primary">
            <b>Caduca</b> el {fmt(protection.expiresAt)} <span className="text-text-muted">(tu hora)</span>
          </p>
          {protection.expiresTz && protection.expiresTz !== myTz && (
            <p className="text-text-muted">Para el creador: {fmt(protection.expiresAt, protection.expiresTz)} ({protection.expiresTz})</p>
          )}
          <p className="text-text-muted">A esa hora se borrará solo de tu launcher. Te avisaremos 10 minutos antes; si estás jugando, el juego se cerrará.</p>
        </div>
      )}

      {protection.account && (
        <div className="text-xs space-y-1.5">
          <p className="text-text-primary">
            <b>Cuenta obligatoria</b>{protection.account.until ? ` hasta el ${fmt(protection.account.until)}` : ''}: solo podrás jugarlo con la cuenta que elijas ahora.
          </p>
          {accounts.length === 0 ? (
            <p className="text-amber-300">Añade una cuenta en Ajustes antes de instalarlo.</p>
          ) : (
            <select value={accountId ?? ''} onChange={(e) => onAccount(e.target.value)}
              className="w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent">
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>{acc.username} · {acc.type === 'microsoft' ? 'Premium' : 'No premium'}</option>
              ))}
            </select>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-1">
        {rules.map((r) => (
          <p key={r.text} className={`text-[11px] flex items-center gap-1.5 ${r.ok ? 'text-green-300' : 'text-text-muted'}`}>
            <span>{r.ok ? '✓' : '✕'}</span>{r.text}
          </p>
        ))}
      </div>
    </div>
  )
}
