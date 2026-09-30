#!/bin/sh
# =============================================================================
# LatteCoffe API — preflight de configuración del contenedor.
# =============================================================================
# Se ejecuta ANTES que la app y aborta (exit 78 = EX_CONFIG de sysexits) si la
# configuración no es apta para arrancar. Motivo: en un despliegue real lo
# típico es que el contenedor quede "vivo" con un secreto de relleno o sin
# secreto, y que el primer síntoma sea un 401 en producción, no un arranque
# ruidoso. Aquí el fallo es inmediato y dice qué arreglar.
#
# IMPORTANTE — una sola fuente de verdad:
# la validación de secreto débil la hace `isWeakSecret()` del propio backend
# (`backend/src/config/env.ts`, exportado en `dist/config/env.js`). Este script
# NO reimplementa la lista de patrones: la importa. Si mañana se añade un
# patrón a `WEAK_SECRET_PATTERNS`, el contenedor lo hereda sin tocar este fichero.
#
# Comportamiento por entorno de aplicación:
#   APP_ENV=production -> aborta si el secreto es débil (además de lo que ya
#                         valida `env.ts` al importar, p. ej. no sembrar cuentas
#                         de sistema en producción).
#   APP_ENV=staging    -> sólo aborta si el secreto falta o es absurdamente
#                         corto (<32 chars), porque es una entrega de
#                         demostración que necesita cuentas de prueba.
# =============================================================================
set -eu

EXIT_CONFIG=78

log() {
    printf '[lattecoffe] %s\n' "$1" >&2
}

if [ -z "${DATABASE_JWT_SECRET:-}" ]; then
    log "ABORTO: DATABASE_JWT_SECRET no esta definida."
    log "       Definala en .env y rearranca: docker compose up -d api"
    exit "$EXIT_CONFIG"
fi

# La app resuelve APP_ENV sobre NODE_ENV (ver backend/src/config/env.ts).
APP_ENV="${APP_ENV:-${NODE_ENV:-production}}"
export APP_ENV

# Importar `dist/config/env.js` ejecuta `buildEnv()`, que ya lanza
# EnvironmentError con el mensaje completo si algo está mal — incluido el caso
# "secreto débil en producción". El `try/catch` existe sólo para que ese error
# salga como una línea accionable y con el código de salida de configuración
# (78), en vez de como una traza de Node. Además se comprueba `isWeakSecret()`
# por si `APP_ENV` llegara por una vía que la app no lee.
if node --input-type=module -e '
  const secret = process.env.DATABASE_JWT_SECRET ?? "";
  const appEnv = process.env.APP_ENV ?? process.env.NODE_ENV;
  try {
    const { isWeakSecret } = await import("file:///app/dist/config/env.js");
    if (secret.length < 32) {
      throw new Error("DATABASE_JWT_SECRET debe tener al menos 32 caracteres (tiene " + secret.length + ").");
    }
    if (appEnv === "production" && isWeakSecret(secret)) {
      throw new Error("DATABASE_JWT_SECRET es debil para APP_ENV=production. Debe ser aleatorio y no contener patrones de ejemplo (changeme, secret, password, test, lattecoffe...).");
    }
  } catch (error) {
    console.error("[lattecoffe] CONFIGURACION INVALIDA: " + (error?.message ?? String(error)));
    console.error("           Revise .env (plantilla en .env.example). El contenedor NO arranca.");
    process.exit(78);
  }
'; then
    log "Preflight OK (APP_ENV=${APP_ENV}). Arrancando: $*"
else
    rc=$?
    if [ "$rc" -eq 0 ]; then rc=$EXIT_CONFIG; fi
    log "Preflight FALLIDO. El contenedor no arranca (exit ${rc})."
    exit "$rc"
fi

# `tini` como PID 1 reenvía SIGTERM al proceso final. El backend maneja SIGTERM
# para drenar el HTTP y cerrar SQLite con wal_checkpoint; sin init, Node no
# recibe la señal y el contenedor muere con la base en WAL.
exec /usr/bin/tini -- "$@"
