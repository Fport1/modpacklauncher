import dict from './auto-en.json'
import patternList from './auto-en-patterns.json'

// Traducción al inglés de todo el launcher.
//
// La mayor parte de la interfaz tiene el texto en español escrito directamente
// en los componentes, así que en vez de reescribirlos todos se traduce lo que
// se pinta: cada texto (y los title / placeholder / aria-label) que coincide
// ENTERO con una frase del diccionario se cambia por su versión en inglés, y
// las frases con partes variables se resuelven con las plantillas. Al volver a
// español se restaura el original.
//
// No se toca lo que el usuario escribe ni el contenido que no es de la
// interfaz: campos de texto, código, y cualquier cosa dentro de
// [data-no-translate] o translate="no" (mensajes del chat, nombres de mods…).

const map = new Map<string, string>(Object.entries(dict as Record<string, string>))
map.set('En', 'In')
map.set('En «', 'In «')

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const patterns = (patternList as [string, string][]).map(([es, en]) => ({
  re: new RegExp('^' + escapeRe(es).replace(/\\\{(\d+)\\\}/g, '([\\s\\S]*?)') + '$'),
  en,
}))

function translate(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed || !/[A-Za-zÁÉÍÓÚáéíóúñÑ¿¡]/.test(trimmed)) return null
  const key = trimmed.replace(/\s+/g, ' ')
  const hit = map.get(key)
  if (hit !== undefined) return text.replace(trimmed, hit)
  for (const p of patterns) {
    const m = key.match(p.re)
    if (m) {
      const out = p.en.replace(/\{(\d+)\}/g, (_, i: string) => {
        const part = m[Number(i) + 1] ?? ''
        return translate(part) ?? part
      })
      return text.replace(trimmed, out)
    }
  }
  return null
}

const ATTRS = ['title', 'placeholder', 'aria-label', 'alt']
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'CODE', 'PRE', 'KBD'])
// En los campos de texto se traduce el placeholder/title, nunca lo escrito
const FIELD_TAGS = new Set(['INPUT', 'TEXTAREA'])

// Lo que se ha cambiado, para poder volver a español
const textState = new WeakMap<Text, { orig: string; applied: string }>()
const attrState = new WeakMap<Element, Map<string, { orig: string; applied: string }>>()

let enabled = false
let observer: MutationObserver | null = null

function skipped(el: Element | null): boolean {
  for (let e = el; e; e = e.parentElement) {
    if (SKIP_TAGS.has(e.tagName)) return true
    if (e.hasAttribute('data-no-translate') || e.getAttribute('translate') === 'no') return true
    if ((e as HTMLElement).isContentEditable) return true
  }
  return false
}

function doText(node: Text): void {
  const st = textState.get(node)
  // Si React ha cambiado el texto desde que lo tradujimos, lo nuevo es el original
  const current = node.data
  if (st && current === st.applied) return
  const tr = translate(current)
  if (tr !== null && tr !== current) {
    textState.set(node, { orig: current, applied: tr })
    node.data = tr
  } else if (st) {
    textState.delete(node)
  }
}

function doAttrs(el: Element): void {
  for (const a of ATTRS) {
    const v = el.getAttribute(a)
    if (!v) continue
    let m = attrState.get(el)
    const st = m?.get(a)
    if (st && v === st.applied) continue
    const tr = translate(v)
    if (tr !== null && tr !== v) {
      if (!m) { m = new Map(); attrState.set(el, m) }
      m.set(a, { orig: v, applied: tr })
      el.setAttribute(a, tr)
    }
  }
}

function walk(root: Node): void {
  if (root.nodeType === Node.TEXT_NODE) {
    if (!skipped(root.parentElement)) doText(root as Text)
    return
  }
  if (root.nodeType !== Node.ELEMENT_NODE) return
  const el = root as Element
  if (FIELD_TAGS.has(el.tagName)) { if (!skipped(el.parentElement)) doAttrs(el); return }
  if (skipped(el)) return
  doAttrs(el)
  const tw = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      if (n.nodeType === Node.ELEMENT_NODE) {
        const e = n as Element
        if (FIELD_TAGS.has(e.tagName)) { doAttrs(e); return NodeFilter.FILTER_REJECT }
        if (SKIP_TAGS.has(e.tagName) || e.hasAttribute('data-no-translate') || e.getAttribute('translate') === 'no') return NodeFilter.FILTER_REJECT
        return NodeFilter.FILTER_ACCEPT
      }
      return NodeFilter.FILTER_ACCEPT
    },
  })
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) doText(n as Text)
    else doAttrs(n as Element)
  }
}

function restoreAll(): void {
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT)
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) {
      const st = textState.get(n as Text)
      if (st && (n as Text).data === st.applied) (n as Text).data = st.orig
      textState.delete(n as Text)
    } else {
      const m = attrState.get(n as Element)
      if (!m) continue
      for (const [a, st] of m) if ((n as Element).getAttribute(a) === st.applied) (n as Element).setAttribute(a, st.orig)
      attrState.delete(n as Element)
    }
  }
}

/** Traduce en inglés ('en') o deja el español original ('es'). */
export function setAutoTranslate(language: string): void {
  const on = language === 'en'
  document.documentElement.lang = on ? 'en' : 'es'
  if (on === enabled) return
  enabled = on
  if (on) {
    walk(document.body)
    observer = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'characterData') { if (!skipped(m.target.parentElement)) doText(m.target as Text) }
        else if (m.type === 'attributes') {
          const t = m.target as Element
          if (!skipped(FIELD_TAGS.has(t.tagName) ? t.parentElement : t)) doAttrs(t)
        }
        else m.addedNodes.forEach(walk)
      }
    })
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS })
  } else {
    observer?.disconnect()
    observer = null
    restoreAll()
  }
}

/** Para textos que se generan fuera del DOM (confirm, notificaciones…). */
export function translateNow(text: string): string {
  return enabled ? translate(text) ?? text : text
}
