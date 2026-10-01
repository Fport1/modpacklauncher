# Prompt: mod conector entre Minecraft, Modpack Launcher y las IAs

> Úsalo como primer mensaje de un proyecto nuevo (otro repositorio). Describe el mod que hay que construir y cómo debe encajar con lo que ya existe en Modpack Launcher by Fport1.

---

Quiero construir un mod de Minecraft que conecte el juego en vivo con **Modpack Launcher by Fport1** y, a través de él, con **Claude Code y otras IAs** (Codex, Gemini CLI, Grok CLI, Cursor, VS Code) mediante MCP. Ahora mismo las IAs solo ven el juego desde fuera: archivos, logs y mundos guardados. Con este mod lo verán y lo manejarán desde dentro mientras se juega.

## Alcance de esta primera versión
- **Minecraft 1.21.1**, **Fabric y NeoForge**. Nada más por ahora.
- Diseñado desde el principio para **portar**: backports (p. ej. 1.20.1) y ports a versiones nuevas (1.21.x y 26.x). Estas últimas vienen sin ofuscar y usan los nombres oficiales de Mojang.
- **Un solo mod que funciona en cliente y en servidor**: en el cliente, en el servidor integrado (un jugador) y en servidores dedicados. Lo correcto es que el servidor también lo tenga. Si solo lo tiene el cliente, el mod funciona en modo limitado: solo lo que el cliente ve y puede hacer.

## Arquitectura propuesta
- **Estructura multiloader**: `common/` con toda la lógica independiente del loader, y `fabric/` y `neoforge/` como capas finas (MultiLoader-Template o Architectury). Java 21, nombres de Mojang (Mojmap + Parchment).
- **Preparado para varias versiones**: el código que depende de la versión de Minecraft va aislado detrás de interfaces pequeñas (adaptadores), para que un port solo toque esos adaptadores. Evaluar Stonecutter para compilar varias versiones desde la misma base cuando toque portar.
- **Mínimos mixins**: preferir eventos de Fabric API / NeoForge. Documentar cada mixin que haga falta y por qué.
- **Lados**:
  - **Cliente**: estado del jugador y la cámara, capturas de pantalla, recarga de resource packs, comandos de cliente y datos de render (FPS, chunks visibles).
  - **Servidor** (integrado o dedicado): mundo, entidades, TPS/MSPT, registros dinámicos, ejecutar comandos, recargar datapacks, colocar estructuras y eventos del juego.
  - **Cliente ↔ servidor**: paquetes propios (custom payloads) por la conexión normal del juego. Así, en multijugador, la IA del jugador llega al servidor sin abrir ningún puerto nuevo, siempre que tenga permiso.

## Conexión con el launcher (lo que ya existe y hay que respetar)
El launcher ya tiene un **puente local** para las IAs:
- Es un servidor HTTP en `127.0.0.1` con un puerto aleatorio y una clave aleatoria, guardados en `<userData del launcher>/ai-bridge.json` como `{ "port", "token", "pid", "version" }`.
- Las peticiones son `POST /instance/<id>/<acción>` con `Authorization: Bearer <token>` y cuerpo JSON.
- Acciones actuales: launch, stop, state, log, crashes, content, toggle, remove, restore, install, install-file, link, search, versions, files, files/read, files/nbt, files/write, deobf, class, lessons, lessons/add, lessons/rate, registry, resource, world, world/rule, world/copy, project/create, project/validate, docs y community.
- Un **servidor MCP** (script de Node que ejecuta el propio launcher) traduce esas acciones en herramientas para las IAs. Hoy son 32 herramientas, en español: `lanzar_juego`, `leer_archivo`, `registro`, `mundo`, `documentacion`, etc. Todo lo que hace la IA aparece como actividad en el launcher.

Lo que hay que añadir en este proyecto (mod) y, después, en el launcher:
1. **Descubrimiento**:
   - Cuando el launcher abre el juego, le pasa al mod dónde está el puente, con propiedades de sistema de la JVM: `-Dfport1.bridge=<ruta a ai-bridge.json>` y `-Dfport1.instance=<id de instancia>`.
   - El mod abre un **WebSocket local** (`127.0.0.1`, puerto aleatorio) y lo **registra** en el puente con una acción nueva `live/register { port, token, side, mc, loader, modVersion, protocol }`.
   - Si el juego no lo abrió el launcher, el mod funciona igual pero sin registrarse, salvo que se configure a mano.
2. **Protocolo**: JSON-RPC 2.0 sobre WebSocket.
   - Saludo con versión de protocolo y capacidades (`hello → { protocol: 1, capabilities: [...] }`), para que launcher y mod puedan tener versiones distintas.
   - Mensajes `request/response` para acciones y `notification` para eventos.
3. **Servidor dedicado, al estilo de Plasmo Voice**:
   - El servidor puede exponer un canal propio para que el launcher del administrador (o su IA) se conecte en remoto.
   - Configuración `port = 0` = **automático: el mismo número de puerto que el servidor de Minecraft**, multiplexado en el pipeline de Netty del propio servidor. Si la conexión entrante empieza con una petición HTTP de upgrade a WebSocket en una ruta propia (p. ej. `/fport1-ai`), se desvía al canal del mod; si no, sigue siendo Minecraft normal. Así no hay que abrir otro puerto en el hosting.
   - Con un número distinto de 0 se usa ese puerto aparte.
   - Autenticación con una clave generada en el primer arranque (en `config/`), que el administrador pega en el launcher.

## Seguridad y permisos (obligatorio)
- Solo `127.0.0.1` en el canal local. En el canal remoto del servidor: clave obligatoria, opción de lista de IPs y límite de peticiones.
- En un servidor, las acciones que cambian cosas solo para operadores (nivel configurable) o para una lista de UUIDs. Por defecto, los jugadores sin permiso solo pueden leer lo que ya ven en su cliente.
- En servidores **sin el mod**: modo solo lectura del lado del cliente. Nunca dar información que el cliente no tendría (nada de ver a través de paredes ni posiciones de otros jugadores).
- Cada acción que cambia algo se registra en un log propio y se muestra en el launcher.
- Nunca se envía el chat de otros jugadores, ni datos personales, ni coordenadas fuera de la instancia.

## Qué debe poder hacer (herramientas nuevas para la IA)
Cada una con su versión de lectura y de escritura según permisos:
- **estado_en_vivo**: dimensión, posición, bioma, qué bloque o entidad se mira (con su NBT), vida y hambre, modo de juego, hora y clima.
- **rendimiento_en_vivo**: FPS (cliente), TPS/MSPT por dimensión (servidor), memoria, chunks cargados, entidades por tipo. Opcional: integración con spark si está instalado.
- **registro_en_vivo**: volcado de los registros reales en ejecución, incluidos los dinámicos (biomas, dimensiones, encantamientos, variantes) y lo que los mods registran por código.
- **ejecutar_comando**: como el jugador o como el servidor, con permisos. Devuelve la salida del comando.
- **recargar**: `/reload` (datapacks) y recarga de resource packs (F3+T), devolviendo los errores que salgan.
- **captura**: captura de pantalla del cliente (opcional: desde una posición y rotación de cámara concretas), guardada en la instancia para que la IA la vea.
- **colocar_estructura**: pegar una estructura o esquemática en una posición (para probar construcciones).
- **inspeccionar**: bloque o entidad en una posición, con NBT y block entity.
- **observar_eventos**: suscribirse a eventos (muerte, logro, cambio de dimensión, errores de funciones de datapack, avisos de lag, crash inminente) y recibirlos como notificaciones.
- **ir_a / camara** (solo en un jugador o con permiso): teletransportar o mover la cámara para comprobar algo.

## Alimentar el aprendizaje de la IA (fport1social: Firestore y Storage)
El launcher ya tiene un **aprendizaje colectivo** en el Firebase de fport1social (proyecto `fport1-social`). Las reglas las publica el repositorio **fport1web**, y el mod se adapta a ellas, no al revés. Colecciones actuales:
- `crash_signatures`: huella anónima de cada crash.
- `ai_lessons`: lecciones de la IA, con tipo (crash, config, compatibilidad, construccion, mundo, rendimiento, mecanica) y votos que suben o bajan según funcionen.
- `play_sessions`: resumen de cada partida (mods, mundo, qué pasó, rendimiento), sacado de archivos y logs.
- `launcher_installs` / `launcher_days`: estadísticas de uso.

Las reglas limitan exactamente qué campos existen (`hasOnly`) y cuánto puede subir cada contador. Cualquier dato nuevo exige cambiar las reglas en fport1web y probarlas en el emulador.

El mod debe **enriquecer ese aprendizaje con datos en vivo** que desde fuera no se pueden obtener:
- **Rendimiento en el tiempo**: FPS y TPS/MSPT por minuto, picos de lag y su causa (qué mod, tipo de entidad o dimensión consume más; con spark si está), tiempos de carga de mundos y dimensiones.
- **Comportamiento del juego con los mods**: entidades por tipo en el tiempo, qué biomas y dimensiones se generan y cuánto cuesta cada uno, errores de funciones y JSON al recargar datapacks, avisos previos a un crash.
- **Resultado de lo que hace la IA** (la señal más valiosa): medir antes y después de cada cambio de la IA (instalar o cambiar un mod, una config, un datapack) si mejoró el rendimiento, desaparecieron los errores o el juego arrancó. Así el aprendizaje sabe qué funciona de verdad, no solo lo que la IA cree.

Cómo:
- **Por defecto, a través del launcher**: el mod manda los datos al puente local y el launcher los limpia (su función `sanitize`), aplica la opción de privacidad del usuario (Ajustes › Privacidad › «Ayudar a que la IA aprenda», activada por defecto) y los sube a Firestore. Un solo sitio que decide qué sale del equipo.
- **Datos grandes** (series de rendimiento, perfiles, muestras): a **Storage**. Hoy Storage solo permite el catálogo de @fport1 (`fport1/projects/**`) y los adjuntos del chat. Hay que diseñar con fport1web una ruta nueva (p. ej. `ai-data/…`) con límite de tamaño y de tipos, idealmente con subida firmada desde una API de la web (como `/api/chat-media`) o con autenticación anónima de Firebase, **nunca** con escritura libre anónima.
- **Servidores dedicados sin launcher**: el mod del servidor puede subir directamente, solo si el administrador lo activa en `config/`, con los mismos límites y la misma limpieza, y nunca datos de jugadores concretos.
- **Privacidad (obligatorio)**: nada de nombres de jugadores ni de mundos, UUIDs, IPs, coordenadas, semillas, chat, carteles, libros ni capturas (salvo que el usuario las envíe a propósito). Los datos se agregan (conteos, medias, picos), no se registra lo que hace cada jugador.
- **Entregable**: una propuesta de campos y colecciones nuevas, con sus reglas de Firestore y Storage, para hacerla en fport1web antes de programar la subida.

## Integración con otros mods (fase 2, opcional)
Detectar e interactuar, solo si están instalados:
- voz: grupos de Plasmo Voice / Simple Voice Chat;
- Custom Skyboxes: comandos del cielo;
- AAA Particles: efectos;
- Flashback / ReplayMod: empezar y parar una grabación.

Esto sirve para montar y ensayar eventos desde la IA.

## Calidad
- Tests: GameTest para la lógica del servidor, un servidor dedicado sin interfaz en CI, y un test de integración con un puente del launcher simulado.
- Configuración con valores seguros por defecto; textos en español e inglés.
- Publicación en Modrinth y CurseForge para Fabric y NeoForge 1.21.1, con el mismo número de versión en los dos loaders.

## Entregables por fases
1. Esqueleto multiloader que compila y arranca en cliente y servidor (Fabric y NeoForge 1.21.1).
2. Canal local + registro en el puente del launcher + `estado_en_vivo`, `rendimiento_en_vivo` y `ejecutar_comando` en un jugador.
3. Paquetes cliente ↔ servidor con permisos y modo solo lectura sin mod en el servidor.
4. Canal remoto del servidor con `port = 0` automático.
5. Resto de herramientas (captura, recargar, registro_en_vivo, colocar_estructura, observar_eventos).
6. Datos en vivo para el aprendizaje: medición antes y después de los cambios de la IA, series de rendimiento, y propuesta de colecciones y reglas (Firestore/Storage) para fport1web.
7. Especificación de lo que hay que añadir en el launcher (acciones `live/*` del puente y herramientas MCP nuevas) para hacerlo en su repositorio.

Antes de escribir código, propón la estructura del repositorio, el protocolo (mensajes y esquemas JSON) y el plan de ports, y espera mi confirmación.
