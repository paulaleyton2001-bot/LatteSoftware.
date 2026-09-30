# syntax=docker/dockerfile:1
#
# LatteCoffe API — imagen de producción multi-stage.
#
# Stage 1 (`build`)     compila TypeScript y compila better-sqlite3.
# Stage 2 (`runtime`)   Node mínimo, usuario no root, sin toolchain de build.
#
# Las dos trampas de `docs/DESPLIEGUE.md` y cómo se resuelven aquí:
#
#   1. `npm run migrate` usa `tsx`, que es devDependency. Un `npm ci --omit=dev`
#      en runtime rompe las migraciones. SOLUCIÓN: no se usa `tsx` en la
#      imagen. `src/database/cli.ts` es TypeScript normal y `tsc` lo compila a
#      `dist/database/cli.js`, así que el migrador y el seeder corren con `node`
#      pelado. Se verificó en local: `node dist/database/cli.js up|seed|status`
#      funciona sin `tsx` instalado. Se añaden scripts `migrate:prod` etc. en
#      package.json que invocan ese CLI compilado.
#
#   2. `tsc` NO copia los `.sql` a `dist/`, y el migrador resuelve el directorio
#      por sondeo de rutas relativas. En un contenedor ese sondeo es frágil
#      (depende de qué se copió). SOLUCIÓN: los `.sql` se copian explícitamente
#      a `/app/migrations` y se fija `MIGRATIONS_DIR=/app/migrations`, que es
#      el override que `resolveMigrationsDir()` respeta. Además se copia también
#      a la ruta que el sondeo encontraría, como red de seguridad.
#
# better-sqlite3 es nativo. Se compila en el stage `build` con toolchain
# completa y se copia el `.node` ya compilado al runtime, que no tiene ni
# compilador. Es la vía fiable: no depende de que exista un prebuild para la
# plataforma concreta.
#
# Preflight de arranque: `docker/entrypoint.sh` valida la configuración ANTES de
# arrancar la app y ABORTA (exit 78) si en `APP_ENV=production` el secreto JWT es
# débil. No reimplementa la lista de patrones: importa `isWeakSecret()` del
# propio backend desde `dist/config/env.js`, para que el contenedor y la
# aplicación compartan una única definición de "secreto débil".


# =============================================================================
# Stage 1 — build
# =============================================================================
FROM node:22-bookworm-slim AS build

# Toolchain mínima para compilar better-sqlite3 desde el fuente nativo.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      python3 \
      make \
      g++ \
      ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Capa de dependencias: se copia primero package.json + lock para que `npm ci`
# se reutilice en caché mientras no cambie el árbol de dependencias.
COPY package.json package-lock.json ./

# Se instalan TODAS las dependencias (incluidas dev) porque el stage de build
# necesita `typescript` para compilar. El runtime NO las hereda.
RUN npm ci

# Código fuente y migraciones.
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src

# Compila TypeScript. `tsc` no copia los `.sql` (trampa 2), así que el CLI de
# migraciones queda en `dist/database/cli.js` y los `.sql` se copian aparte.
RUN npm run build

# SeReduce a dependencias de producción. `npm prune` mantiene el binario nativo
# ya compilado de better-sqlite3 en node_modules.
RUN npm prune --omit=dev


# =============================================================================
# Stage 2 — runtime
# =============================================================================
FROM node:22-bookworm-slim AS runtime

# `tini` como PID 1: reenvía SIGTERM, que el backend usa para el apagado
# ordenado (drenar conexiones y cerrar SQLite con wal_checkpoint). Sin init,
# Node no recibe la señal y el contenedor se mata con la base en WAL.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini curl \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    APP_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    NPM_CONFIG_UPDATE_NOTIFIER=false

# La base vive en el volumen, FUERA del arbol de codigo del contenedor.
ENV DATABASE_PATH=/data/lattecoffe.sqlite

# Trampa 2 resuelta: ruta explicita a los `.sql`, no por sondeo.
ENV MIGRATIONS_DIR=/app/migrations

WORKDIR /app

# Preflight de configuración (aborta con secreto débil en producción).
COPY docker/entrypoint.sh /usr/local/bin/lattecoffe-entrypoint
RUN chmod 0755 /usr/local/bin/lattecoffe-entrypoint

# Dependencias de producción (ya podadas, con better-sqlite3 compilado).
COPY --from=build /app/node_modules ./node_modules

# Manifiesto y JavaScript compilado. El CLI de migraciones va incluido: es lo
# que permite `node dist/database/cli.js up` sin `tsx` en la imagen.
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/dist ./dist

# Trampa 2 resuelta: los `.sql` llegan al contenedor en una ruta fija y
# explícita, en vez de depender del sondeo de rutas relativas de `tsc`.
COPY --from=build /app/src/database/migrations ./migrations
# Red de seguridad: la misma carpeta en la ruta que el sondeo encontraria, para
# que el migrador encuentre migraciones aunque `MIGRATIONS_DIR` se pierda.
COPY --from=build /app/src/database/migrations ./src/database/migrations

# Usuario no root con home. Node 22 trae el usuario `node` (uid 1000).
RUN mkdir -p /data && chown -R node:node /data /app
USER node

EXPOSE 3000

# Sonda de vida contra el endpoint real de la API. `curl` está instalado arriba.
# `--fail` para que un 503 (base caída) cuente como fallo, no como " vivo".
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl --fail --silent --show-error http://127.0.0.1:3000/api/v1/health || exit 1

# El preflight corre antes y hace `exec tini -- CMD`, así que `tini` sigue siendo
# PID 1 y Node recibe directamente las señales (tini las reenvía).
ENTRYPOINT ["/usr/local/bin/lattecoffe-entrypoint"]

# El servidor NO crea el esquema al arrancar: las migraciones son un comando
# explícito (`docker compose exec api npm run migrate:prod`). Por eso el CMD es
# sólo levantar el API, no migrar y sembrar en cada restart.
CMD ["node", "dist/server.js"]
