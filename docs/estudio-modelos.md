# Estudio de modelos (WinterTales)

Editor 3D estilo Blockbench dentro del launcher, **solo visible para la cuenta del dueño** (la misma
comprobación que Admin: cuenta Microsoft `devora60`). El enlace del menú (icono de cubo, encima del
lápiz de Admin) solo sale para esa cuenta; además, el proceso principal comprueba la cuenta en cada
llamada `studio:*`, así que aunque alguien abriera `#/studio` a mano no podría leer ni escribir nada.

## Versión 1 (hecha): bloques e ítems JSON + texturas

- **Lista** de los ~490 modelos de `assets/wintertales/models/{block,item}` con buscador y filtros
  (con forma propia / bloques / objetos / hechos por script). Marca los que genera un script de
  `tools/` y los «editados a mano».
- **Vista 3D**: rejilla de 16 px, cámara orbital, vistas Frente/Lado/Arriba, «Como en el juego»
  (sombreado de Minecraft por cara), «Antes / después» (mantener pulsado).
- **Cubos**: elegir (Mayús para varios), mover/tamaño/girar con flechas en 3D o con botones grandes,
  duplicar, espejo, borrar, añadir, piezas (grupos) con punto de giro y animación de prueba
  (balancear/mirar/girar). Lista de piezas y cubos con renombrar, ocultar y bloquear.
- **Modo Fácil** (por defecto) y **Avanzado** (números, punto de giro, eje/ángulo, UV y textura por
  cara, rescale, sombra).
- **Texturas**: lápiz, cubo de pintura, cuentagotas, goma, paleta sacada de la textura, zoom, y
  pintar directamente sobre el modelo. Las texturas de Minecraft se ven pero no se pintan. Los trozos
  que usa el cubo elegido salen recuadrados en amarillo.
- **Deshacer/rehacer** sin límite práctico (1000 pasos), siempre visibles (Ctrl+Z / Ctrl+Y).
- **Borrador automático** cada pocos segundos; al volver a abrir el modelo ofrece recuperarlo.
- **Copia de seguridad** antes de sobrescribir cualquier archivo del mod, en
  `%APPDATA%/<launcher>/studio/backups/<fecha>/<ruta>`.
- **Avisos amables** con «🪄 Arreglarlo por mí»: ángulos que Minecraft no admite (solo −45, −22,5, 0,
  22,5, 45), cubos fuera de −16..32, cubos del revés, UV fuera de la textura, giros de cara que no son
  múltiplo de 90, texturas sin definir (sabe que en una plantilla es normal), falta de `particle`,
  tamaños de textura raros.
- **Probar en el juego**: guarda y copia modelos y texturas al resource pack `WinterTales-estudio`
  (pack_format 34) de la instancia de prueba (la elegida en la lista o la primera que tenga
  WinterTales en sus mods) y lo activa en `options.txt`. En el juego: **F3+T**.
- **Tutorial** de la primera vez (9 pasos con flecha) y **Aprender** con 7 lecciones que avanzan solas.

Al guardar, el JSON sale igual que el original salvo lo que se ha cambiado: mismo orden de claves,
mismo orden de caras, claves desconocidas intactas. Comprobado con los 501 JSON de WinterTales: 478
salen idénticos byte a byte y 23 solo cambian ruido de coma flotante (`0.3999999999999999` → `0.4`).

## Lo que hay que añadir a WinterTales (scripts `tools/make-*.js`)

Cuando guardas algo que genera un script, el estudio pregunta y, si eliges «versión editada a mano»,
lo apunta en **`tools/hand-edited.json`** (lo crea el estudio):

```json
{
  "_comentario": "Archivos editados a mano en el Estudio de modelos del launcher. …",
  "files": [
    "src/main/resources/assets/wintertales/models/block/poker_table_0.json"
  ]
}
```

Para que los scripts lo respeten, en WinterTales:

### 1. Crear `tools/lib/respect-hand-edits.js`

Todos los scripts acaban escribiendo con `fs.writeFileSync` o `fs.copyFileSync` (también `png.js`), y
ninguno los desestructura, así que basta con envolver esas dos funciones:

```js
// Los archivos de tools/hand-edited.json los ha editado alguien a mano (Estudio de modelos del
// launcher): los scripts no los sobrescriben. Quita la línea del JSON para volver a generarlos.
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..', '..')
let list = []
try {
  list = JSON.parse(fs.readFileSync(path.join(root, 'tools', 'hand-edited.json'), 'utf8')).files ?? []
} catch { /* sin lista: no hay nada editado a mano */ }
const keep = new Set(list.map((f) => path.resolve(root, f).toLowerCase()))
const skipped = []

const isKept = (file) => typeof file === 'string' && keep.has(path.resolve(file).toLowerCase())

const origWrite = fs.writeFileSync
fs.writeFileSync = function (file, ...rest) {
  if (isKept(file)) { skipped.push(path.relative(root, file)); return }
  return origWrite.call(this, file, ...rest)
}
const origCopy = fs.copyFileSync
fs.copyFileSync = function (src, dest, ...rest) {
  if (isKept(dest)) { skipped.push(path.relative(root, dest)); return }
  return origCopy.call(this, src, dest, ...rest)
}

process.on('exit', () => {
  if (skipped.length) console.log(`✋ ${skipped.length} archivo(s) editados a mano, no se han tocado:\n  ${skipped.join('\n  ')}`)
})
```

### 2. Cargarlo en los scripts (elige una)

- **Una línea arriba del todo de cada `tools/make-*.js`** (antes de cualquier otro `require`):

  ```js
  require('./lib/respect-hand-edits')
  ```

- **O sin tocar los scripts**, ejecutándolos con `-r`:

  ```bash
  node -r ./tools/lib/respect-hand-edits.js tools/make-spawn-props.js
  ```

  (Si tienes un `package.json`/`.bat` que los lanza, se añade ahí una vez.)

Con eso, un modelo o textura «editado a mano» ya no lo pisa ningún script; para volver a generarlo,
se quita su línea de `hand-edited.json`.

## Siguiente fase: entidades Java (pendiente)

Las ~15 entidades con `LayerDefinition`/`CubeListBuilder` en `src/main/java/com/wintertales/`:

1. **Leer** el Java: `addOrReplaceChild("nombre", CubeListBuilder.create().texOffs(u,v).addBox(...),
   PartPose.offset(...)/offsetAndRotation(...))`, conservando los nombres de las partes (los usa
   `setupAnim`, así que no pueden cambiar).
2. **Guardar**, dos opciones:
   - *Regenerar solo el método `createBodyLayer()`* entre marcas `// @estudio-inicio` /
     `// @estudio-fin`, sin tocar `setupAnim`. Necesita `gradle build` para probarlo.
   - *Cargador JSON en tiempo de ejecución* (recomendado para iterar): un `StudioModelLoader` en
     WinterTales que, si existe `assets/wintertales/studio_models/<entidad>.json`, construye el
     `LayerDefinition` desde ahí; si no, usa el del Java. Así «Probar en el juego» funciona con F3+T
     como con los bloques. Cuando se haga, se detallará exactamente qué clase añadir y dónde
     registrarla.
3. **Probar en el juego** para entidades: `gradle build` con progreso en el launcher (si se usa la
   opción de regenerar Java).
