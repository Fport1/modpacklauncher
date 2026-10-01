# Creaciones de Fport1 en la web (catálogo público y panel de @fport1)

Mensaje para el chat de **fport1web**. El launcher (Modpack Launcher by Fport1) ya tiene el panel «Mis
creaciones» publicando en GitHub; la web tiene que leer y escribir **exactamente el mismo formato**, para que
lo publicado en un sitio se vea y se edite igual en el otro.

## Idea

- **El catálogo sigue en Firestore** (`fport1_projects` y `versions`): pocos KB por documento y ya tiene las
  reglas, el contador de descargas y el permiso de @fport1.
- **Los archivos pasan a GitHub**, porque las descargas de GitHub no cuestan nada:
  - cada versión es una **release** de GitHub con el archivo adjunto;
  - las imágenes (icono, portada, galería) van al repo público **`<cuenta>/fport1-contenido`** y se sirven
    por **jsDelivr**, fijadas al commit;
  - los proyectos antiguos siguen en Firebase Storage (`hosting: 'storage'`) y tienen que seguir viéndose.
- **El panel de publicar solo aparece si eres @fport1 y tienes GitHub conectado.**

## Formato de datos (ya lo escribe el launcher)

`fport1_projects/{id}`:

| Campo | Tipo | Notas |
|---|---|---|
| `title`, `slug`, `summary` | string | `summary` ≤ 160, una línea |
| `description` | string | **Markdown con HTML** (ver «Cómo pintar la descripción») |
| `type` | `'modpack' \| 'mod' \| 'resourcepack' \| 'datapack' \| 'shader' \| 'plugin'` | |
| `iconUrl`, `iconPath` | string | |
| `bannerUrl`, `bannerPath` | string \| null | portada ancha (≈ 4:1), arriba de la ficha |
| `gallery` | `{url, path, title?, description?}[]` | **la primera es la destacada**; el orden importa |
| `categories` | string[] | categorías fijas de Explorar (`adventure`, `magic`…) |
| `tags` | string[] | etiquetas libres, minúsculas con guiones |
| `license` | `{id, name, url?}` \| null | `id` SPDX (`MIT`, `GPL-3.0`…), `ARR` = todos los derechos reservados, `custom` con `url` |
| `openSource` | bool | código abierto o cerrado |
| `links` | `{source?, issues?, wiki?, discord?, website?, donate?}` | `source` solo se enseña si `openSource` |
| `hosting` | `'github' \| 'storage'` | dónde están los archivos (sin el campo = `storage`) |
| `github` | `{sourceRepo?, sourcePrivate?, releasesRepo}` | ver abajo |
| `clientSide`, `serverSide` | `'required' \| 'optional' \| 'unsupported'` | |
| `published`, `featured`, `downloads`, `loaders`, `gameVersions`, `latestVersion`, `createdAt`, `updatedAt` | | como hasta ahora |

`github`:
- `sourceRepo`: `owner/repo` del código. Puede ser privado si el código es cerrado (`sourcePrivate: true`).
  **Si es privado, no lo enseñes en la ficha.**
- `releasesRepo`: repo **público** donde están las releases. Es igual a `sourceRepo` si el código es abierto;
  vacío (`''`) significa el repo de contenido `<cuenta>/fport1-contenido`.

`fport1_projects/{id}/versions/{vid}`: como hasta ahora (`name`, `versionNumber`, `channel`, `loaders`,
`gameVersions`, `changelog`, `dependencies`, `downloads`, `publishedAt`). Cada `files[]` tiene ahora:

```js
{ url, path, filename, size, sha1, primary,
  host: 'github' | 'storage',
  github: { repo, tag, releaseId, assetId, htmlUrl } }   // solo si host === 'github'
```

Formatos de `path`:
- `gh-release:owner/repo:releaseId:tag`: archivo de una release;
- `gh:owner/repo:ruta/en/el/repo`: imagen del repo de contenido;
- cualquier otro: ruta de Firebase Storage (lo antiguo).

Convenciones (que la web haga lo mismo al publicar):
- etiqueta de la release: `v<versión>` en el repo del código, `<slug>-v<versión>` en el repo de contenido;
- `prerelease: true` para beta y alpha; `make_latest` solo para release;
- cuerpo de la release: el changelog, más una línea con versiones de Minecraft y loaders;
- imágenes en `media/<slug>/<tipo>-<timestamp>-<nombre>`, con URL
  `https://cdn.jsdelivr.net/gh/<owner>/fport1-contenido@<commitSha>/<ruta>` (fijada al commit, así la caché
  nunca enseña una versión vieja);
- etiquetas del repo de GitHub (topics): tags + categorías + tipo + loaders + `minecraft`, en minúsculas con
  guiones (≤ 20 y ≤ 50 caracteres cada una).

## Qué hay que hacer en la web

### 1. Catálogo público (para todos)

- `/creaciones`: lista de los proyectos con `published == true`, con los destacados primero. Filtros por tipo,
  categoría, etiqueta, loader y versión de Minecraft.
- `/creaciones/[slug]`, la ficha:
  - portada, icono, título, resumen, etiquetas, categorías;
  - marca de código abierto o cerrado, licencia (con enlace si lo tiene) y enlaces;
  - la descripción, la galería con visor y las versiones (canal, loaders, versiones, notas);
  - botón de descarga a `files[0].url` que **suma 1 a `downloads`** en el proyecto y en la versión, igual que
    el launcher (las reglas solo dejan sumar 1).
- Botón «Abrir en el launcher» si ya tenéis enlace profundo; si no, lo dejamos para después.

### 2. Cómo pintar la descripción

- Markdown con `marked`.
- El launcher coloca las imágenes así, y la web tiene que respetarlo:
  - `![título](url)`: imagen a todo el ancho;
  - `<p align="center"><img src="…" alt="…" width="600"></p>`: centrada, con ese ancho;
  - `<img src="…" alt="…" width="300" align="left|right">`: flotando, con el texto alrededor;
  - miniatura de YouTube enlazada: `[![Vídeo](https://img.youtube.com/vi/ID/maxresdefault.jpg)](https://www.youtube.com/watch?v=ID)`.
- **Sanea el HTML** con lista blanca: `p[align]`, `img[src|alt|width|height|align]`, `a[href|title]`, títulos,
  listas, tablas, `code`/`pre`, `blockquote`, `hr`, `del`, `strong`, `em`, `br`. Nada de `script`, `style`,
  `on*` ni `iframe`.
- `img[align=left/right]` necesita CSS: `float` con margen.

### 3. Conectar GitHub en la web

- **Una sola OAuth App de GitHub** para la web y el launcher (la crea el usuario y os dará los datos):
  - la web usa el flujo normal con `client_id` + `client_secret` en las variables de entorno de Vercel;
  - el launcher usa el flujo de dispositivo con el mismo `client_id`, así que hay que marcar «Enable Device
    Flow» en la app.
- Rutas:
  - `/api/github/login` redirige a GitHub con `scope=repo` y un `state` firmado;
  - `/api/github/callback` cambia el código por el token.
- **El token no va nunca al navegador**:
  - se guarda cifrado con `src/lib/crypto.js` en `github_tokens/{uid}`;
  - las reglas de esa colección son `allow read, write: if false`: solo el Admin SDK la lee.
- Solo @fport1 puede conectar y usar estas rutas; compruébalo en el servidor con la sesión, no en el cliente.
- Rutas de servidor que usa el panel:
  - repos: listar y crear, con `license_template` y topics;
  - actualizar la descripción y los topics del repo;
  - crear o editar una release y adjuntar el archivo, borrar una release (y su etiqueta);
  - subir y borrar una imagen del repo de contenido (contents API: PUT con `sha` si ya existía).

### 4. Subir archivos grandes desde la web: ojo con Vercel

- Una función de Vercel no acepta cuerpos de más de **4,5 MB**, y un mod o un modpack suele pesar más. Es
  probable que `uploads.github.com` no deje subir directamente desde el navegador (CORS); comprobadlo antes
  de elegir.
- Propuesta que funciona en cualquier caso:
  1. el navegador de @fport1 sube el archivo a Storage, a `fport1/tmp/<uid>/<id>` (las reglas de @fport1 ya
     lo permiten, o se añade esa ruta);
  2. una ruta de servidor lo copia a la release de GitHub (subir desde el servidor no tiene ese límite) y
     **borra el temporal**.
- Las imágenes son pequeñas y pueden pasar por la función.

### 5. Panel de publicar en la web (@fport1 con GitHub conectado)

Lo mismo que el launcher, con los mismos nombres:
- **Ficha**: nombre, resumen, etiquetas, categorías, cliente/servidor, destacado.
- **Descripción**: editor Markdown con barra (títulos, negrita, cursiva, tachado, listas, cita, código,
  enlace, tabla, separador, vídeo, imagen) y vista previa al lado. Al insertar una imagen se elige dónde va
  (ancho completo, centrada, izquierda, derecha) y su ancho.
- **Imágenes**: icono, portada, galería con título y descripción, flechas para ordenar, «Destacar» e
  «Insertar en la descripción».
- **Código y GitHub**:
  - código abierto o cerrado, y la licencia (abiertas: MIT, Apache-2.0, GPL-3.0, LGPL-3.0, MPL-2.0,
    AGPL-3.0, BSD-3-Clause, Unlicense, CC0-1.0, CC-BY-4.0, CC-BY-SA-4.0; cerradas: ARR, CC-BY-NC-4.0,
    CC-BY-NC-ND-4.0; u otra con nombre y enlace);
  - repo: elegir uno o crearlo, público o privado. Si el código es abierto, el repo es obligatoriamente
    público;
  - aviso de dónde se publican las versiones, y los enlaces;
  - los proyectos con `hosting: 'storage'` ofrecen «Pasar a GitHub».
- **Versiones**: subir con número, nombre, canal, loaders, versiones de Minecraft, dependencias y notas.
  Borrar una versión borra también su release.
- Al guardar, sincroniza la descripción y los topics del repo del código.

### 6. Reglas

- `fport1_projects` y `versions`: **no hace falta cambiar nada**. @fport1 ya puede escribir cualquier campo y
  los demás solo suman 1 a `downloads`.
- Nueva colección `github_tokens/{uid}`: `allow read, write: if false`.
- Si usáis el temporal de Storage del punto 4: `fport1/tmp/{uid}/**`, solo @fport1, y que caduque o se borre.

## Pruebas que pido

- Emulador: `github_tokens` no se puede leer ni escribir desde el cliente; `fport1_projects` sigue igual (los
  demás solo suman 1 a `downloads`).
- Publicar desde la web un proyecto de prueba en un repo de prueba y comprobar que el launcher lo ve en
  Explorar › Fport1 con su portada, etiquetas, licencia, enlaces, galería y versión descargable, y al revés.
- Una ficha con imágenes centradas y flotantes se ve igual en los dos.

## Avisos

- No borres ni muevas lo que ya está en Storage: los proyectos antiguos tienen que seguir descargándose.
- El token de GitHub de @fport1 da acceso a sus repos privados: nunca al cliente, nunca a los registros.
- No añadas campos al documento sin decírmelo, porque el launcher tiene que conocerlos.
