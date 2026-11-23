import { useEffect, useState } from 'react'
import G from '../ui/Glyph'

// El tutorial de la primera vez y las lecciones de «Aprender». Las dos cosas señalan una parte
// de la pantalla (oscureciendo lo demás, con una flecha) y explican qué hacer; las lecciones
// además pasan solas al siguiente paso cuando se hace lo que piden.

/** Lo que va pasando en el editor, para que las lecciones sepan que ya se hizo. */
export type StudioEvent = 'camera' | 'select' | 'move' | 'resize' | 'rotate' | 'paint' | 'group' | 'pivot' | 'anim' | 'save' | 'test' | 'tool-move' | 'tool-resize' | 'tool-rotate' | 'tool-paint' | 'layer'

export interface GuideStep {
  /** data-tour de lo que se señala */
  target?: string
  title: string
  text: string
  /** Paso de lección: se completa al pasar esto */
  waitFor?: StudioEvent
}

export const TOUR: GuideStep[] = [
  { title: '¡Hola! Esto es el Estudio de modelos', text: 'Aquí puedes cambiar la forma y los colores de los bloques, objetos y criaturas de WinterTales. Te enseño dónde está cada cosa en un minuto. Nada de lo que hagas se pierde: todo se puede deshacer.' },
  { target: 'viewport', title: 'La vista 3D', text: 'Aquí ves el modelo. Arrastra con el botón izquierdo para darle vueltas, con el derecho para moverte y la rueda para acercarte. Haz clic en un cubo para elegirlo.' },
  { target: 'tools', title: 'Las herramientas', text: 'Elige qué hacer con el cubo: mover, cambiar el tamaño, girar o pintar encima. Al pasar el ratón por cada botón te explica qué hace.' },
  { target: 'outliner', title: 'La lista de cubos y piezas', text: 'Todos los cubos del modelo. Las piezas (las que tienen el icono de caja) juntan cubos, como «cabeza» o «brazo». Doble clic para cambiar el nombre; el ojo los oculta y el candado los bloquea.' },
  { target: 'move-buttons', title: 'Botones fáciles', text: 'Con estos botones mueves el cubo de píxel en píxel, sin arrastrar nada. Debajo cambias su tamaño y lo giras.' },
  { target: 'paint-tools', title: 'Pintar', text: 'Aquí está la textura en grande. Pinta con el lápiz, rellena con el cubo de pintura o coge un color con el cuentagotas. También puedes pintar directamente sobre el modelo con la herramienta Pintar.' },
  { target: 'undo', title: 'Deshacer y rehacer', text: 'Si algo sale mal, deshaz (Ctrl+Z) todas las veces que quieras. Además se guarda solo un borrador cada poco.' },
  { target: 'save', title: 'Guardar y probar', text: 'Guardar escribe el archivo del mod (antes hace una copia). «Probar en el juego» lo lleva a tu instancia para verlo con F3+T, sin recompilar.' },
  { target: 'learn', title: 'Aprender', text: 'Aquí tienes lecciones cortas para practicar cada cosa paso a paso. ¡Ya está! Empieza a crear.' },
]

export interface Lesson { id: string; title: string; icon: string; steps: GuideStep[] }

export const LESSONS: Lesson[] = [
  { id: 'view', icon: 'video', title: 'Moverse por la vista 3D', steps: [
    { target: 'viewport', title: 'Dale vueltas', text: 'Pon el ratón sobre el modelo, mantén pulsado el botón izquierdo y arrastra. ¡El modelo gira!', waitFor: 'camera' },
    { target: 'views', title: 'Vistas rápidas', text: 'Pulsa «Frente», «Lado» o «Arriba» para mirarlo recto desde ahí.', waitFor: 'camera' },
  ] },
  { id: 'select', icon: 'pointer', title: 'Elegir y mover un cubo', steps: [
    { target: 'viewport', title: 'Elige un cubo', text: 'Haz clic en cualquier cubo del modelo. Se marca en amarillo.', waitFor: 'select' },
    { target: 'move-buttons', title: 'Muévelo', text: 'Pulsa un botón de mover (por ejemplo «Arriba»). El cubo sube un píxel.', waitFor: 'move' },
    { target: 'tools', title: 'Ahora arrastrando', text: 'Elige la herramienta «Mover» y arrastra una de las flechas de colores que salen en el cubo.', waitFor: 'move' },
  ] },
  { id: 'resize', icon: 'ruler', title: 'Cambiar tamaño y girar', steps: [
    { target: 'size-buttons', title: 'Más grande', text: 'Con el cubo elegido, pulsa «+» al lado de «Ancho».', waitFor: 'resize' },
    { target: 'rotate-buttons', title: 'Gíralo', text: 'Pulsa el botón de girar «Y». En Minecraft los cubos de bloques giran de 22,5 en 22,5 grados.', waitFor: 'rotate' },
  ] },
  { id: 'paint', icon: 'palette', title: 'Pintar la textura', steps: [
    { target: 'paint-tools', title: 'Elige un color', text: 'Elige el lápiz y un color de la paleta.' },
    { target: 'texture-canvas', title: 'Pinta un píxel', text: 'Haz clic en la textura grande para pintar. ¡Mira cómo cambia el modelo en 3D!', waitFor: 'paint' },
    { target: 'tools', title: 'Pinta sobre el modelo', text: 'Elige la herramienta «Pintar» y haz clic directamente sobre el modelo en 3D.', waitFor: 'paint' },
  ] },
  { id: 'tools', icon: 'sparkles', title: 'Dibujar como en Photoshop', steps: [
    { target: 'texture-canvas', title: 'Un rectángulo', text: 'En la pestaña Textura, elige la herramienta Rectángulo (U) y arrastra sobre la textura. Arriba puedes marcar «Relleno».', waitFor: 'paint' },
    { target: 'texture-canvas', title: 'Luz y sombra', text: 'Elige «Aclarar» o «Oscurecer» y pasa por encima de lo pintado: así se da volumen sin cambiar de color a mano.', waitFor: 'paint' },
    { target: 'texture-canvas', title: 'Selección', text: 'Con «Selección» (M) marca un trozo: desde ese momento solo se pinta dentro. Ctrl+C y Ctrl+V lo copian a una capa nueva.' },
  ] },
  { id: 'layers', icon: 'layers', title: 'Capas', steps: [
    { target: 'layers', title: 'Una capa nueva', text: 'Pulsa «+» en Capas. Es como una hoja transparente encima: lo que pintes ahí no estropea lo de debajo.', waitFor: 'layer' },
    { target: 'texture-canvas', title: 'Pinta en ella', text: 'Pinta algo. Va a la capa elegida (la resaltada).', waitFor: 'paint' },
    { target: 'layers', title: 'Ocúltala', text: 'Pulsa el ojo de la capa para ocultarla y volver a verla. En el juego se ve la mezcla de las capas visibles.', waitFor: 'layer' },
  ] },
  { id: 'group', icon: 'package', title: 'Piezas y punto de giro', steps: [
    { target: 'viewport', title: 'Elige varios cubos', text: 'Haz clic en un cubo y luego, con Mayús pulsada, en otro.', waitFor: 'select' },
    { target: 'cube-actions', title: 'Haz una pieza', text: 'Pulsa «Hacer pieza». Ahora esos cubos van juntos, como un brazo.', waitFor: 'group' },
    { target: 'pivot', title: 'El punto de giro', text: 'La pieza gira alrededor de su punto de giro (como el hombro de un brazo). Cámbialo con los botones de «Punto de giro».', waitFor: 'pivot' },
  ] },
  { id: 'anim', icon: 'activity', title: 'Probar una animación', steps: [
    { target: 'outliner', title: 'Elige una pieza', text: 'Haz clic en una pieza de la lista (las del icono de caja).', waitFor: 'group' },
    { target: 'anim', title: 'Muévela', text: 'Pulsa «Balancear» para ver cómo se movería alrededor de su punto de giro. Si gira raro, el punto de giro está mal puesto.', waitFor: 'anim' },
  ] },
  { id: 'save', icon: 'save', title: 'Guardar y verlo en el juego', steps: [
    { target: 'save', title: 'Guarda', text: 'Pulsa «Guardar». Antes de escribir el archivo del mod se hace una copia, por si acaso.', waitFor: 'save' },
    { target: 'test', title: 'Pruébalo', text: 'Pulsa «Probar en el juego» y, dentro de Minecraft, pulsa F3+T para ver el cambio.', waitFor: 'test' },
  ] },
]

/** Recuadro alrededor de lo señalado, con el resto oscurecido y una tarjeta con la explicación. */
export function Spotlight({ step, index, total, onNext, onSkip, nextLabel, waiting }: {
  step: GuideStep; index: number; total: number; onNext: () => void; onSkip: () => void; nextLabel?: string; waiting?: boolean
}) {
  const [rect, setRect] = useState<DOMRect | null>(null)
  useEffect(() => {
    const find = (): void => {
      const el = step.target ? document.querySelector(`[data-tour="${step.target}"]`) : null
      setRect(el ? el.getBoundingClientRect() : null)
    }
    find()
    const t = setInterval(find, 400)
    return () => clearInterval(t)
  }, [step.target])
  const pad = 6
  const r = rect ? { x: rect.left - pad, y: rect.top - pad, w: rect.width + pad * 2, h: rect.height + pad * 2 } : null
  // La tarjeta: debajo de lo señalado si cabe; si no, encima; sin nada señalado, en el centro
  const below = r ? r.y + r.h + 200 < window.innerHeight : true
  const cardStyle: React.CSSProperties = r
    ? { left: Math.min(window.innerWidth - 380, Math.max(12, r.x)), top: below ? r.y + r.h + 18 : Math.max(12, r.y - 190) }
    : { left: '50%', top: '40%', transform: 'translate(-50%, -50%)' }
  return (
    <div className="fixed inset-0 z-[250] pointer-events-none">
      {/* Oscurecido con un hueco (solo en el tutorial; en las lecciones se puede seguir usando todo) */}
      {!waiting && r && (
        <>
          <div className="absolute bg-black/55 pointer-events-auto" style={{ left: 0, top: 0, right: 0, height: r.y }} />
          <div className="absolute bg-black/55 pointer-events-auto" style={{ left: 0, top: r.y + r.h, right: 0, bottom: 0 }} />
          <div className="absolute bg-black/55 pointer-events-auto" style={{ left: 0, top: r.y, width: r.x, height: r.h }} />
          <div className="absolute bg-black/55 pointer-events-auto" style={{ left: r.x + r.w, top: r.y, right: 0, height: r.h }} />
        </>
      )}
      {!waiting && !r && <div className="absolute inset-0 bg-black/55 pointer-events-auto" />}
      {r && <div className="absolute rounded-xl border-[3px] border-sky-400 shadow-[0_0_0_4px_rgba(56,189,248,0.25)] animate-pulse" style={{ left: r.x, top: r.y, width: r.w, height: r.h }} />}
      {r && (
        <div className="absolute text-4xl text-sky-300 drop-shadow" style={{ left: Math.min(window.innerWidth - 60, Math.max(8, r.x + r.w / 2 - 18)), top: below ? r.y + r.h - 4 : r.y - 44 }}>
          <G n={below ? 'arrowUp' : 'arrowDown'} />
        </div>
      )}
      <div className="absolute w-[360px] rounded-2xl bg-[#0f1726] border border-sky-400/40 p-4 shadow-2xl pointer-events-auto" style={cardStyle}>
        <p className="text-[11px] text-sky-300 mb-1">{index + 1} de {total}</p>
        <p className="text-base font-semibold text-white">{step.title}</p>
        <p className="text-sm text-sky-50/90 mt-1 leading-snug">{step.text}</p>
        <div className="flex items-center justify-end gap-2 mt-3">
          <button type="button" onClick={onSkip} className="text-xs text-sky-200/70 hover:text-white">{waiting ? 'Dejar la lección' : 'Saltar'}</button>
          {waiting && step.waitFor ? (
            <span className="text-xs text-sky-200/80">Hazlo y sigo yo…</span>
          ) : (
            <button type="button" onClick={onNext} className="px-3 py-1.5 rounded-lg bg-sky-500 text-white text-sm font-medium">{nextLabel ?? (index + 1 === total ? '¡Listo!' : 'Siguiente')}</button>
          )}
        </div>
      </div>
    </div>
  )
}
