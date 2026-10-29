# Editor de mundos (MCA Selector + WorldEdit + Axiom)

Plan apuntado el 29-10-2026 para empezar la semana del 2 de noviembre de 2026. **Todavía no hay nada hecho.**

## La idea

Editar mundos de Minecraft desde el launcher, sin abrir el juego y gastando muchos menos recursos. Es al estilo del editor de Hytale:

- un mapa del mundo como MCA Selector;
- operaciones como WorldEdit;
- herramientas como Axiom.

Todo lo pesado en Rust, sobre lo que ya hay en `native/`: regiones y NBT, probado con el servidor oficial 26.3. Sirve para mundos de instancias y para mundos de servidor que estén en el equipo.

## Fases

| Fase | Qué | Tamaño |
|---|---|---|
| 1 | **Abrir `.mca` en el explorador de archivos** (instancias y panel de servidores): la lista de chunks de la región (coordenadas, fecha, tiempo habitado, tamaño) y, al elegir uno, su NBT en el editor de siempre. Ahora un `.mca` no se puede abrir porque no es un NBT normal: es un contenedor de 1024 chunks comprimidos por separado. | Pequeña |
| 2 | **Mapa 2D como MCA Selector:** el mundo visto desde arriba con los colores reales de los bloques (sacados de las texturas del .jar) y zoom; seleccionar chunks o regiones; filtros (tiempo habitado, bioma, estructuras, fecha); borrar, exportar o importar zonas; ver por dimensión. | Media |
| 3 | **Vista 3D y operaciones de WorldEdit:** rellenar, reemplazar, copiar, pegar, rotar y voltear; importar y exportar esquemáticas (`.schem`, `.litematic`); cambiar biomas; deshacer y rehacer. | Grande |
| 4 | **Herramientas tipo Axiom o el editor de Hytale:** pinceles, esculpir terreno, pintar bloques, previsualización en vivo. | Grande |

## Detalles técnicos que hay que tener en cuenta

- **Formato de los chunks** (1.18+): secciones de 16³ con `block_states` (paleta + `long[]` empaquetado) y `biomes`. Al escribir, hay que recalcular los bits por entrada si la paleta crece.
- **Luz y alturas:** al cambiar bloques, marcar el chunk para que el juego recalcule la luz al cargarlo (`isLightOn = 0`, quitar la luz guardada) y los heightmaps. Si no, se ven zonas negras.
- **Versiones:** empezar por la 1.18 en adelante, incluido el formato 26.1 (`dimensions/<ns>/<nombre>/region`). Antes de la 1.18 el formato es otro (alturas 0–255; antes de la 1.13, IDs numéricos).
- **Mods:** los bloques de mods se conservan tal cual aunque se dibujen genéricos.
- **Seguridad:**
  - el juego o el servidor tienen que estar cerrados (como en Limpiar);
  - copia automática antes de guardar;
  - escribir a un temporal y cambiarlo al final;
  - probar cada fase abriendo el mundo con el servidor oficial.
- **3D:** valorar usar el renderizado de Horizon (Rust y wgpu, licencia MIT, en `Fport1/horizon`), que ya dibuja los mundos vanilla igual que el juego. La alternativa es hacer las mallas en Rust (greedy meshing) y dibujarlas con WebGL o WebGPU en la ventana del launcher.
- **WebAssembly:** la parte de Rust que convierte chunks en mallas se puede compilar a WebAssembly. Así se reutilizaría en el launcher, en una versión web en fport1web y más adelante en móviles.

## Orden propuesto para la primera semana

1. Fase 1 entera: abrir `.mca` y ver y editar el NBT de un chunk, guardándolo bien comprimido en su sitio.
2. Fase 2 básica:
   - mapa de una dimensión con zoom y selección de chunks;
   - borrar y exportar lo seleccionado;
   - reutilizar la limpieza que ya existe como filtro del mapa.
