# Rust en el launcher y en los servidores

Notas del 29-10-2026. Al principio era solo una lista de ideas; ya está hecha casi entera (ver «Estado»).

## Cómo está hecho

En vez de un módulo cargado dentro de Electron (napi-rs), es un **programa aparte**, `fport1-native`, en `native/`. Va así:

- El launcher lo arranca la primera vez que lo necesita y le manda trabajos: una línea de JSON por petición y otra por respuesta, con avisos de progreso (`src/main/native.ts`).
- Si el programa falla o se cuelga, el launcher no se cae, y no depende de la versión interna de Electron.
- **Siempre con respaldo:** si no está o falla, cada parte se hace en JavaScript como antes. Tras tres fallos seguidos deja de intentarlo hasta reiniciar.
- Lo compila `npm run build:native` (`scripts/build-native.js`) y queda en `native/dist/`. electron-builder lo mete en `resources/native/`. En Mac es un binario universal (Intel y Apple Silicon).
- `release.yml` instala Rust en los tres sistemas y lo compila antes de empaquetar.
- En desarrollo se usa `native/target/release/`; la variable `FPORT1_NATIVE` apunta a otro binario.

## Estado

Medido con tus datos reales en este equipo (16 hilos). Todas las comparaciones dan el mismo resultado que JavaScript.

| # | Parte | Estado | Antes (JS) → ahora (Rust) |
|---|---|---|---|
| 1 | Comprobar assets y librerías al abrir el juego | ✅ | 5.147 assets: 860 → 470 ms. Hash: 300 archivos, 900 → 63 ms |
| 2 | Zips: instalar y actualizar modpacks, `.fpack`, exportar, Horizon | ✅ | Descomprimir un mundo de 83 MB: 1,2 s → 0,3 s, sin cargarlo entero en memoria |
| 3 | Leer los datos de los mods | ✅ | 134 mods (Unlimited 3): **7,6 s → 0,18 s** |
| 4 | NBT: jugadores, mundos, nombres de Paper | ✅ | 41 archivos idénticos a prismarine-nbt en 186 ms. Bedrock sigue con prismarine |
| 5 | Escanear el almacenamiento | ✅ | 12.500 archivos (3,6 GB): 5,7 s → 0,47 s |
| 6 | Leer el .jar del juego (modelos, texturas, textos) | ❌ No compensa | Ya se abre una vez y se queda en memoria. Pedir cada entrada a otro proceso sería más lento que leerla aquí |

### Servidores

| Parte | Estado | Resultado |
|---|---|---|
| **Backups de mundos** | ✅ | 83 MB: 2,3 s → 0,7 s, mismo tamaño. Ya no se llena la memoria con mundos de varios GB |
| **Limpiar mundos** (quitar chunks sin visitar, como MCA Selector) | ✅ Nuevo | «Server nose»: 1,3 GB → 757 MB en 5 s. El servidor oficial 26.3 lo abre sin errores |
| Identificar los jars del servidor | ❌ No compensa | Cada jar se baja por FTP antes de calcular su hash: lo que tarda es la red |
| Subir y bajar por FTP/SFTP | ❌ No compensa | Lo limita la red |

**Limpiar un mundo** está en el botón «🧹 Limpiar» de cada mundo de una instancia, y en el panel de servidores al entrar en un mundo de tu equipo.
- Se elige cuánto: nadie ha estado cerca, menos de 1, de 5 o de 30 minutos.
- Primero se analiza sin tocar nada y se ve cuánto se quitaría por dimensión.
- Al confirmar, hace una copia del mundo entero en `backups/` y luego limpia.
- No deja limpiar un mundo de una instancia abierta.
- Lo que no sabe leer (chunks en LZ4 o dañados) lo deja como está.
- Limpia a la vez las regiones de entidades y de puntos de interés.

## Pendiente: proyectos aparte

- **Gestionar servidores Horizon desde el launcher** (`horizon-server` del fork `Fport1/horizon`): crear, iniciar, parar, consola y backups. Es una sección nueva del launcher, no una parte en Rust del launcher.
- **Servidor PvP 1.8 en Rust** (protocolo 1.8, combate calcado, arenas en hilos al estilo Folia): un repositorio aparte.
- **Tauri:**
  - Lo que lo motivaría es tener el launcher en móviles o que sea mucho más ligero.
  - Reutiliza la interfaz React y cambia el proceso de Node por uno en Rust.
  - El programa auxiliar de ahora serviría tal cual, así que es el primer paso hacia ahí.
