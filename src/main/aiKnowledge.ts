// Guías para la IA sobre lo que rodea a los mods: modelos, animaciones, efectos,
// shaders, sonido y vídeo, y cómo pasar trabajo de Blender, Blockbench o Unity a
// Minecraft. Se dan con la herramienta «guia» y se copian a .ai/guias/.
//
// Son conceptos estables (formatos de Minecraft Java y de las herramientas); lo
// que depende de la versión exacta se comprueba con ver_recurso, registro y la
// documentación de cada mod (herramienta documentacion).

export const GUIDES: Record<string, { title: string; body: string }> = {
  modelos: {
    title: 'Modelos de Minecraft (Java)',
    body: `# Modelos de Minecraft Java

## Bloques e ítems (resource pack)
- **blockstates/<bloque>.json**: elige el modelo según el estado (\`variants\` con \`"facing=north"\`… o \`multipart\` con \`when\`/\`apply\`). Rotaciones solo de 90° (\`x\`, \`y\`) y \`uvlock\`.
- **models/block|item/<nombre>.json**: \`parent\` (hereda), \`textures\` (variables \`#nombre\` → \`namespace:block/textura\`), \`elements\` (cubos: \`from\`/\`to\` en 0-16, se puede salir hasta -16..32), \`faces\` con \`uv\` 0-16, \`texture\`, \`cullface\`, \`tintindex\`, \`rotation\` por elemento (un eje, ±22.5/45°), \`display\` (cómo se ve en la mano, GUI, suelo, marco).
- **Desde 1.21.4**: los ítems tienen además \`items/<ítem>.json\` (definición del ítem: \`model\` con tipos \`minecraft:model\`, \`condition\`, \`select\`, \`range_dispatch\`…) que apunta a los modelos. Antes se usaban \`overrides\` con \`custom_model_data\` dentro del modelo del ítem. Comprueba con ver_recurso cuál usa la instancia.
- Texturas en **textures/**: PNG, lado potencia de 2 recomendado (16, 32, 64…). Animadas con una tira vertical y un \`.png.mcmeta\` (\`{"animation":{"frametime":2}}\`, 1 tick = 50 ms; \`interpolate\`, \`frames\`).
- Las caras transparentes necesitan el render type adecuado (en mods: \`render_type: "cutout"\`/\`"translucent"\` en el modelo con NeoForge, o el registro de render layer en Fabric).

## Entidades
- Vanilla: los modelos de entidades están en código Java (no en JSON). Para cambiarlos sin programar:
  - **CEM** (OptiFine) y su versión libre **Entity Model Features (EMF)**: archivos \`.jem\` (modelo de la entidad) y \`.jpm\` (partes) en \`assets/minecraft/optifine/cem/\`; animaciones con expresiones en el .jem. Blockbench los exporta con el formato «OptiFine Entity».
  - **ETF** (Entity Texture Features): texturas aleatorias/por nombre/emisivas (\`_e.png\`) con \`.properties\` en \`optifine/random/entity/\`.
- Mods: el modelo se define en código (\`LayerDefinition\`/\`ModelPart\`) o con librerías como **GeckoLib** (ver guía geckolib).

## Bedrock
- Usa \`.geo.json\` (geometría con huesos, pivotes y cubos) y animaciones \`.animation.json\`. GeckoLib usa ese mismo formato en Java. Un modelo Bedrock no se carga tal cual en Java vanilla.

## Comprobar
- \`ver_recurso\` para ver un modelo/blockstate real de esta versión, \`validar_proyecto\` para revisar un pack, \`recargar\` resource_packs (F3+T) para verlo en la partida.`,
  },
  blockbench: {
    title: 'Blockbench',
    body: `# Blockbench

Editor de modelos para Minecraft (gratis, blockbench.net). Formatos que importan:
- **Java Block/Item**: exporta el JSON de modelo de bloque/ítem (cubos alineados, rotación por elemento limitada a ±45° en pasos de 22.5° y un eje). Si el modelo usa rotaciones libres, Blockbench avisa.
- **Bedrock Model / Bedrock Entity**: \`.geo.json\` con huesos; animaciones en el panel Animate → \`.animation.json\`.
- **GeckoLib Animated Model** (plugin «GeckoLib Animation Utils»): exporta \`.geo.json\` + \`.animation.json\` y, para ítems/bloques, el \`display\` JSON. Ver guía geckolib.
- **OptiFine Entity** (CEM/EMF): \`.jem\`/\`.jpm\`; abre una plantilla de la entidad vanilla desde «File › New › OptiFine Entity».
- **Modded Entity**: genera la clase Java (ModelPart/LayerDefinition) para mods.
- **Generic Model**: OBJ/glTF para importar desde Blender o exportar a otros programas.

Consejos:
- Texturas por caja (box UV) o por cara (per-face UV); para Java block/item, per-face.
- Tamaño de textura del proyecto (16×16, 64×64…) = resolución del PNG. Mantén potencias de 2.
- Pivotes: en Bedrock/GeckoLib las rotaciones de animación giran alrededor del pivote del hueso; ponlos en la articulación.
- Los archivos .bbmodel son JSON: \`leer_archivo\` los puede leer y \`describir_modelo\`/inspección de archivos los resume.`,
  },
  geckolib: {
    title: 'GeckoLib (modelos y animaciones de mods)',
    body: `# GeckoLib

Librería de animación para mods (Fabric, NeoForge, Forge). Usa el formato **Bedrock** en Java:
- \`assets/<modid>/geo/<nombre>.geo.json\` — geometría con huesos.
- \`assets/<modid>/animations/<nombre>.animation.json\` — animaciones: canales \`rotation\`, \`position\`, \`scale\` por hueso, keyframes con \`lerp_mode\` (linear, catmullrom, step) y expresiones **Molang** (\`math.sin(query.anim_time * 90) * 10\`).
- Textura PNG en \`textures/\`.
- En código: \`GeoEntity\`/\`GeoItem\`/\`GeoBlockEntity\`, un \`GeoModel\` que devuelve las tres rutas y un \`AnimationController\` que elige animación (\`RawAnimation.begin().thenLoop("walk")\`).
- Eventos dentro de la animación: \`sound_effects\`, \`particle_effects\` y \`timeline\` (instrucciones) en el .animation.json, que el controlador recibe con keyframe handlers.
- Las rutas y los nombres de clases cambian entre versiones de GeckoLib (las más recientes agrupan los archivos bajo una carpeta \`geckolib/\`): mira la versión de GeckoLib instalada (listar_contenido) y su wiki (documentacion geckolib).
- Exportar desde Blockbench con el plugin «GeckoLib Animation Utils» (formato GeckoLib Animated Model).`,
  },
  animaciones: {
    title: 'Animaciones (GeckoLib, Bedrock, Blockbench, CEM/EMF, emotes, displays)',
    body: `# Animaciones en Minecraft

Herramientas: \`analizar_animacion\` (entender y revisar un archivo, con el modelo para comprobar huesos) y \`escribir_animacion\` (añadir o cambiar una animación en un .animation.json sin romper el formato).

## Bedrock / GeckoLib (.animation.json)
\`\`\`json
{ "format_version": "1.8.0",
  "animations": {
    "animation.dragon.walk": {
      "loop": true, "animation_length": 1.0,
      "bones": {
        "left_leg":  { "rotation": { "0.0": [20, 0, 0], "0.5": [-20, 0, 0], "1.0": [20, 0, 0] } },
        "head":      { "rotation": ["math.sin(query.anim_time * 360) * 5", 0, 0] },
        "body":      { "position": { "0.0": { "post": [0, 0, 0], "lerp_mode": "catmullrom" }, "0.5": [0, 1, 0] } }
      },
      "sound_effects": { "0.25": { "effect": "mimod:paso" } }
    } } }
\`\`\`
- **Canales**: \`rotation\` en grados, \`position\` en píxeles (1/16 de bloque), \`scale\` multiplicador. Siempre [x, y, z].
- **Valor**: fijo (vector o Molang) o keyframes por tiempo en segundos. Un keyframe puede ser [x,y,z] o \`{ "pre": [...], "post": [...], "lerp_mode": "linear|catmullrom|step" }\` (pre/post para saltos bruscos).
- **loop**: true, false o "hold_on_last_frame" (se queda en la última pose).
- **Molang**: \`math.sin/cos\` trabajan en GRADOS; \`query.anim_time\` (segundos desde que empezó la animación), \`query.life_time\`, \`variable.*\`. Qué queries soporta GeckoLib depende de su versión: compruébalo en su wiki (\`documentacion geckolib\`).
- Los nombres de **huesos** tienen que coincidir EXACTAMENTE con los del .geo.json (mayúsculas incluidas); si no, esa parte no se mueve. Rotar un hueso rota sus hijos alrededor de su **pivote**.
- **Eventos**: \`sound_effects\`, \`particle_effects\` y \`timeline\` (instrucciones) por tiempo; en GeckoLib los reciben los keyframe handlers del controlador.
- **Bedrock (add-ons)**: además usa \`animation_controllers\` (estados y transiciones con Molang). **GeckoLib (mods)**: los estados están en código, con \`AnimationController\` y \`RawAnimation.begin().thenLoop("walk")\`; las animaciones disparadas (atacar) con \`triggerableAnim\`.

## Probar rápido
- Las animaciones de un mod con GeckoLib están en \`assets/<modid>/animations/\` de su jar: un **resource pack** con el mismo archivo en la misma ruta lo sustituye, así se prueba con \`recargar\` resource_packs (F3+T) sin recompilar el mod.
- En la partida (mod fport1-social): \`captura\` para verla y \`inspeccionar\` para ver la entidad.

## Blockbench
- Pestaña **Animate**: línea de tiempo por hueso, keyframes de rotación/posición/escala, interpolación (linear, catmullrom, step, bezier) y Molang en los valores.
- Exportar: «File › Export › Export Animations» (Bedrock .animation.json) o, con el plugin GeckoLib Animation Utils, el formato de GeckoLib. El .bbmodel guarda las animaciones dentro (\`analizar_animacion\` lo lee).

## Entidades vanilla sin código: CEM / EMF
- En el .jem, cada parte puede tener \`animations\` con expresiones: \`"head.rx": "head_pitch"\`, \`"left_arm.rx": "sin(limb_swing * 0.6662) * limb_speed"\`.
- Variables habituales: \`limb_swing\`, \`limb_speed\`, \`age\`, \`head_yaw\`, \`head_pitch\`, \`time\`, \`pi\`, \`is_on_ground\`, \`is_in_water\`. EMF añade más (mira su documentación). Ojo: aquí \`rx/ry/rz\` van en RADIANES.

## El jugador: emotes y animaciones
- **Emotecraft**: emotes en \`.json\` (partes head, torso, rightArm, leftArm, rightLeg, leftLeg con ticks) o hechos en Blockbench con su plugin; van en la carpeta de emotes.
- Mods que animan al jugador suelen usar **Player Animator** (biblioteca).

## Sin mods: datapacks
- **Display entities** (1.19.4+): \`transformation\` (traslación, rotación con cuaterniones, escala) + \`interpolation_duration\` y \`start_interpolation\` para animar suave; \`teleport_duration\` para moverlas suave. Con modelos de ítem propios (1.21.4+: \`item_model\`) se hacen criaturas y máquinas animadas por comandos.
- Mide el coste con \`medir_cambio\`/\`comparar_cambio\`: muchas entidades animadas por tick bajan los TPS.`,
  },
  blender: {
    title: 'Blender → Minecraft',
    body: `# De Blender a Minecraft

Blender no exporta formatos de Minecraft directamente. Caminos:
- **Modelo de bloque/ítem/entidad**: exporta de Blender a **OBJ** o **glTF**, impórtalo en Blockbench (Generic Model) y rehazlo con cubos. Minecraft Java no carga mallas libres (triángulos) en modelos JSON vanilla; para eso hacen falta mods (por ejemplo, cargadores OBJ de NeoForge: \`"loader": "neoforge:obj"\` en el modelo del bloque/ítem).
- **Animación**: los keyframes no pasan solos a GeckoLib; se rehacen en Blockbench (que sí exporta Bedrock/GeckoLib). Puedes usar el render de Blender como referencia.
- **Texturas**: hornea (bake) a PNG de baja resolución y potencia de 2; el estilo de Minecraft es sin filtrado (pixel art).
- **Escenas y renders de Minecraft en Blender**: el complemento **MCprep** importa mundos (vía jmc2obj/Mineways) y materiales de resource packs para renders y animaciones de vídeo.
- **Mineways / jmc2obj**: exportan un trozo del mundo a OBJ para Blender.
- Escala: 1 bloque = 16 píxeles = 1 metro en Blender (si importas a 1/16, cada unidad es un píxel).`,
  },
  unity_vfx: {
    title: 'Conceptos de Unity / VFX en Minecraft',
    body: `# Unity y VFX: qué equivale a qué en Minecraft

Minecraft no usa Unity. Si alguien viene de Unity (o Unreal), traduce así:
| Unity | Minecraft Java |
|---|---|
| Particle System / VFX Graph | Partículas vanilla (\`particles/*.json\` en resource pack para las texturas; el comportamiento está en código o en comandos \`/particle\`). Para efectos complejos: **AAA Particles** (usa **Effekseer**: archivos \`.efkefc\` creados con la herramienta Effekseer), **Photon** u otros mods de partículas, o datapacks con \`/particle\` y displays. |
| Shader Graph / materiales | **Core shaders** del resource pack (\`assets/minecraft/shaders/core/*.vsh|.fsh|.json\`, GLSL; cambian entre versiones) o **shaderpacks** de Iris/OptiFine (GLSL con pases gbuffers, shadow, deferred, composite, final). |
| Post-processing (bloom, color grading) | Pases \`composite\`/\`final\` de un shaderpack de Iris; en vanilla, efectos \`shaders/post/*.json\` (los que usa la visión de criaturas y Fabulous). Mods como **Veil** o **Satin** dan post-procesado a otros mods. |
| Animator / Timeline | GeckoLib (.animation.json, Molang), animaciones de CEM/EMF, **Emotecraft** para el jugador, y en datapacks **display entities** con interpolación (\`transformation\` + \`interpolation_duration\`). |
| Prefab | Estructura (\`.nbt\` con bloque de estructuras; \`colocar_estructura\`) o schematic. |
| Skybox | Mods de cielos: **Custom Skyboxes** / FabricSkyBoxes (JSON + texturas) o propiedades de OptiFine. |
| Audio Source | \`sounds.json\` + \`.ogg\` (ver guía sonido); posicional si es mono. |
| Video Player | No hay en vanilla: **WaterMedia** (y mods que lo usan) reproduce mp4/URLs. Para algo corto, textura animada. |
| Light / emisivo | Luz de bloque (0-15) en código o blockstate; texturas emisivas con mods (ETF \`_e\`, Continuity/OptiFine) o shaderpacks; **Custom Lights**/LambDynamicLights para luz dinámica. |

Al construir un efecto, di primero qué se puede hacer **sin mod** (comandos, displays, partículas vanilla, core shaders) y qué necesita mod, y comprueba qué mods hay en la instancia (listar_contenido).`,
  },
  particulas: {
    title: 'Partículas y efectos',
    body: `# Partículas y efectos

- **Vanilla**: \`/particle <tipo> x y z dx dy dz velocidad cantidad [force]\`; tipos con parámetros (\`dust{color:[1,0,0],scale:1}\` en 1.20.5+, \`block{block_state:...}\`…). La sintaxis cambió en 1.20.5 (componentes): comprueba la versión con registro/ver_recurso.
- Texturas de partículas: \`assets/<ns>/particles/<tipo>.json\` (lista de texturas) + \`textures/particle/\`.
- **Display entities** (1.19.4+): \`block_display\`, \`item_display\`, \`text_display\` con \`transformation\`, \`interpolation_duration\`, \`teleport_duration\`, brillo y billboard: efectos y animaciones sin mods.
- **AAA Particles**: efectos de Effekseer (\`.efkefc\`) en resource packs, lanzados por comandos o por otros mods. Se diseñan en el editor de Effekseer (gratis).
- **Photon** y otros: su propio formato (mira su documentación con la herramienta documentacion).
- Rendimiento: muchas partículas por tick bajan los FPS; mide con medir_cambio/comparar_cambio.`,
  },
  shaders: {
    title: 'Shaders y post-procesado',
    body: `# Shaders

## Shaderpacks (Iris / Oculus / OptiFine)
- Carpeta o .zip en \`shaderpacks/\` con \`shaders/\` dentro. GLSL por pases: \`shadow\`, \`gbuffers_*\` (terreno, entidades, agua, cielo…), \`deferred\`, \`composite*\` (post-procesado: bloom, DOF, niebla), \`final\`.
- \`shaders.properties\` (opciones, pantallas de ajustes, buffers, texturas personalizadas), \`block.properties\`/\`item.properties\`/\`entity.properties\` (asignan ids a bloques para materiales: agua, hojas, emisivos).
- Uniforms como \`frameTimeCounter\`, \`sunPosition\`, \`worldTime\`, \`cameraPosition\`, \`gbufferModelViewInverse\`.
- Iris recarga con la tecla R (por defecto); los errores salen en el chat/log. Iris no soporta todo lo de OptiFine (y viceversa): mira la documentación.
- Seleccionar el pack: \`activar\` con tipo shader (juego cerrado) o el jugador en Opciones › Vídeo › Shaders.

## Core shaders (resource pack, vanilla)
- \`assets/minecraft/shaders/core/\`: los shaders con que Minecraft dibuja todo. Cambian mucho entre versiones (1.21.2+ reorganizó los programas): copia el original de esta versión con ver_recurso antes de editar.
- \`shaders/post/\` y \`post_effect/\` (según versión): efectos de pantalla completa.

## Mods con shaders propios
- Veil, Satin, Lodestone y otros: efectos para mods (post-procesado, bloom de objetos). Consulta su documentación.`,
  },
  sonido: {
    title: 'Sonido y música',
    body: `# Sonido en Minecraft

- Formato: **.ogg Vorbis**. MP3, WAV, M4A, etc. hay que convertirlos (herramienta \`convertir_medio\` tipo sonido).
- **Mono** = sonido posicional (se oye desde un punto y se atenúa con la distancia). **Estéreo** = sin posición (música de menú, efectos de interfaz). Minecraft no posiciona sonidos estéreo.
- Registro en \`assets/<ns>/sounds.json\`: \`"evento": { "sounds": ["<ns>:carpeta/archivo"], "subtitle": "subtitles.<ns>.evento" }\`. Opciones por sonido: \`volume\`, \`pitch\`, \`weight\`, \`stream\` (true para archivos largos como música: se lee en streaming), \`attenuation_distance\`, \`preload\`. \`"replace": true\` sustituye un evento vanilla en vez de añadir.
- Probar: \`/playsound <ns>:<evento> master @s\`.
- **Discos de música** (1.21+): \`jukebox_song/<id>.json\` en un datapack (\`sound_event\`, \`description\`, \`length_in_seconds\`, \`comparator_output\`) + el sonido en un resource pack + un ítem con el componente \`jukebox_playable\`.
- Música ambiental: sustituir eventos \`music.*\` con \`replace\`.
- Mods de voz (**Plasmo Voice**, **Simple Voice Chat**) tienen sus propios addons para reproducir audio (por ejemplo, altavoces o discos personalizados); mira su documentación.`,
  },
  video: {
    title: 'Vídeo e imágenes animadas',
    body: `# Vídeo en Minecraft

- Minecraft vanilla **no reproduce vídeo** (.mp4, .webm, .mov…).
- Para algo corto (una pantalla, un cartel animado, un portal): **textura animada** — tira vertical de fotogramas PNG + \`.png.mcmeta\` (\`frametime\` en ticks). La herramienta \`convertir_medio\` tipo textura_animada lo hace desde un vídeo o GIF. Ojo con el tamaño: muchos fotogramas grandes ocupan memoria de vídeo.
- Para ver un vídeo entero con sonido: un mod reproductor. **WaterMedia** (librería usada por WATERFrAMES, MCEF y otros) reproduce archivos y URLs; lo más compatible es **MP4 H.264 + AAC** (\`convertir_medio\` tipo video).
- Imágenes: PNG para texturas (sin JPG/WebP en resource packs); \`convertir_medio\` tipo imagen convierte y escala (pixelado para pixel art).
- Para el menú principal: mods de pantallas de título personalizadas (FancyMenu acepta GIF/APNG y fondos animados).`,
  },
  texturas: {
    title: 'Texturas avanzadas',
    body: `# Texturas avanzadas

- **Animadas**: tira vertical + \`.png.mcmeta\` (\`frametime\`, \`interpolate\`, \`frames\` con orden y tiempos propios).
- **Emisivas**: no existen en vanilla; con ETF/OptiFine (\`_e.png\`), con shaderpacks (por id de bloque en block.properties) o con mods.
- **Conectadas (CTM)**: OptiFine o **Continuity** (\`optifine/ctm/\` con \`.properties\`).
- **CIT** (texturas por nombre/encantamiento): OptiFine o CIT Resewn (\`optifine/cit/\`). Desde 1.21.4 vanilla puede hacer mucho con \`items/*.json\` (select por componente o nombre).
- **Cielos**: Custom Skyboxes / FabricSkyBoxes.
- Tamaños potencia de 2; el atlas de bloques se reduce si hay texturas enormes.
- Polytone y otros mods amplían colores/biomas por resource pack: mira su documentación.`,
  },
}

export const GUIDE_TOPICS = Object.keys(GUIDES)

/** Una guía, o la lista si el tema no existe. */
export function guide(topic?: string): Record<string, unknown> {
  const key = String(topic ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[\s-]+/g, '_')
  const alias: Record<string, string> = { unity: 'unity_vfx', vfx: 'unity_vfx', efectos: 'particulas', particles: 'particulas', audio: 'sonido', sonidos: 'sonido', musica: 'sonido', modelo: 'modelos', models: 'modelos', animaciones: 'animaciones', animacion: 'animaciones', animations: 'animaciones', emotes: 'animaciones', post: 'shaders', postprocesado: 'shaders', imagen: 'video', gif: 'video' }
  const g = GUIDES[key] ?? GUIDES[alias[key] ?? '']
  if (!g) return { temas: GUIDE_TOPICS.map((k) => ({ tema: k, titulo: GUIDES[k].title })) }
  return { tema: key in GUIDES ? key : alias[key], titulo: g.title, guia: g.body }
}
