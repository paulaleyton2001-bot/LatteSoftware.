# LatteCoffe POS — Despliegue y producción

Cómo se instala, arranca, respalda y opera el sistema. Contratos normativos:
[`DESIGN.md`](./DESIGN.md), [`API.md`](./API.md),
[`../backend/README.md`](../backend/README.md). Este documento **describe** un
despliegue; no lo ejecuta: los unit de systemd, el bloque de nginx y el script de
backup son plantillas para adaptar y copiar, no existen en el repositorio.
Etiquetas: **[impl]** = comportamiento que el código ya garantiza, verificado
leyendo el fichero citado. **[rec]** = recomendación de despliegue, no está en el código.

## 0. Resumen: las tres vías, y cuál usar

| Vía | Para qué | Sección |
|---|---|---|
| **Docker + Compose** | Servidor de la entrega, y la recomendada en general. Imagen multi-stage, volumen para SQLite, healthcheck, usuario no root | §3.0 |
| **Node + systemd + nginx** | Instalación sobre el host sin contenedores, con control fino del proceso y TLS propio | §3.1 en adelante |
| **Túnel público temporal** | Que un teléfono alcance el backend sin cables, **para una demostración**. URL aleatoria y sin SLA | §3.5 |

La entrega usa las tres: contenedor, y encima un quick tunnel para que el APK funcione
con datos de red. El frontend va aparte (§4): la URL del backend se le inyecta **en
tiempo de compilación**, y por eso un APK ya construido queda atado a la URL que tenía
el día del build.

## 1. Requisitos de producción

| Componente | Mínimo | Verificado | Nota |
|---|---|---|---|
| Node.js | **22** | v26.10.0 | `better-sqlite3@13.0.3` declara `"engines": {"node": ">=22"}` **[impl]** |
| npm | 10+ | 12.1.0 | `npm ci` exige lockfile; hay `backend/package-lock.json` **[impl]** |
| better-sqlite3 | 13.0.3 | 13.0.3 | Trae SQLite **3.53.4** embebido (`deps/sqlite3/sqlite3.h`), sin `node-gyp` si hay prebuild **[impl]** |
| Flutter | 3.22 estable | — | `frontend/pubspec.yaml` **[impl]** |
| Docker | 24 o superior | 29.6.1 | Sólo para la vía §3.0. `buildx` multi-stage, `HEALTHCHECK` y `depends_on: service_healthy` |

> **Contradicción detectada, no corregida:** `backend/package.json` declara
> `"engines": {"node": ">=20.11.0"}` y `backend/README.md` §1 repite «mínimo 20.11».
> Ambas son incorrectas: `better-sqlite3@13.0.3` exige `>=22`. Planifique para Node 22+.

**SO [rec]:** Debian 12 / Ubuntu 22.04 LTS o cualquier POSIX con `systemd`.
Windows no está soportado: el apagado ordenado, las rutas de migración y el unit asumen POSIX.

| Recurso | Mínimo | Recomendado | Motivo |
|---|---|---|---|
| CPU | 1 vCPU | 2 vCPU | `better-sqlite3` es **síncrono y single-threaded**: la E/S bloquea el event loop **[impl]** |
| RAM | 1 GB | 2 GB | El proceso con 20 módulos cargados ronda 150–300 MB; el resto es caché de página de SQLite **[impl]** |
| Disco | 20 GB | 50 GB SSD | 34 tablas (`0001_init.sql`); el fichero crece con `orders` y `audit_logs` **[impl]** |

**Por qué el disco importa.** SQLite **es un fichero**, así que el almacenamiento
local es requisito de infraestructura, no un detalle. WAL escribe de forma
append-only (`synchronous = NORMAL`), de modo que sobre disco lenticular o de red
el WAL crece y las transacciones se acumulan. La fiabilidad depende de que el WAL
y el fichero principal estén **en el mismo volumen con escrituras coherentes**:
partirlos entre disco local y NFS/SMB rompe la recuperación tras un corte de luz.
No hay particionado horizontal: el escritor es único a nivel de fichero (§9). Y
cada copia de seguridad produce **otro fichero**, así que hacen falta el doble de
espacio. **[rec]** Base en SSD local o disco de bloque persistente del proveedor,
**nunca** NFS/SMB ni volumen de Docker sobre NFS; active journaling (`data=ordered`
en ext4, `barrier=1` en XFS); copias en un volumen **distinto**, porque un respaldo
en el mismo disco no sobrevive a la pérdida del disco.

## 2. Variables de entorno

Plantilla: `backend/.env.example`. Validación: `backend/src/config/env.ts` (zod sobre
`process.env`, ejecutado **al importar el módulo**: un valor inválido aborta antes de
abrir la base o escuchar en el puerto). `.env` se busca en `DOTENV_CONFIG_PATH` y luego
en `backend/.env`, sin sobrescribir variables ya presentes (`process.env[k] ??= v`) **[impl]**.

### 2.1 Tabla completa

| Variable | Defecto | Oblig. | Validación / efecto | Riesgo si se deja |
|---|---|---|---|---|
| `NODE_ENV` | `development` | No | enum `development\|test\|staging\|production` | **Alto**: sin HSTS, con stack en errores |
| `APP_ENV` | = `NODE_ENV` | No | enum; **manda sobre `NODE_ENV`** | **Crítico**: sin `production` no hay validación estricta |
| `PORT` | `3000` | No | entero 0–65535 | Bajo |
| `HOST` | `0.0.0.0` | No | string no vacío | Medio: expone el 3000 fuera del proxy |
| `APP_NAME` | `LatteCoffe API` | No | string no vacío | Nulo |
| `APP_VERSION` | `1.0.0` | No | semver estricto | Nulo (salida mal formada aborta) |
| `DATABASE_PATH` | `./data/lattecoffe.sqlite` | No | relativa → `backend/`; `:memory:` permitido | **Alto**: dentro del árbol de código |
| `DATABASE_BUSY_TIMEOUT_MS` | `5000` | No | entero 0–120000 | Medio: `0` convierte toda contención en 409 inmediato |
| `DATABASE_JWT_SECRET` | — | **Sí** | ≥32 chars; en producción **aborta** si es débil (`<32`, carácter repetido, <8 distintos, o contiene `cambie`, `changeme`, `secret`, `password`, `admin`, `root`, `test`, `demo`, `example`, `placeholder`, `lattecoffe`, `qwerty`…) | **Crítico**: firma HS256 de access y refresh |
| `JWT_ACCESS_TTL` | `15m` | No | segundos o `15m`/`1h` | Medio: `1d` amplía la ventana de robo |
| `JWT_REFRESH_TTL_DAYS` | `30` | No | entero 1–365 | Medio |
| `BCRYPT_COST_ROUNDS` | `12` | No | entero 10–15 | Bajo: `15` multiplica el login por ~8 |
| `PASSWORD_RESET_TOKEN_TTL_MINUTES` | `30` | No | entero 1–1440 | Bajo |
| `RESET_PASSWORD_LINK_BASE_URL` | `http://localhost:5173/reset-password` | No | **sólo se usa en el log de desarrollo** **[impl]** | Inocuo en producción |
| `CORS_ORIGINS` | `http://localhost:3000` | No | CSV; `*` habilita cualquier origen **con credenciales** **[impl]** | **Crítico**: `*` deja que cualquier sitio actúe como operador desde el navegador de un cajero |
| `LOG_LEVEL` | `info` | No | `fatal…trace`, `silent` | `debug` = ruido; `silent` = ceguera |
| `RATE_LIMIT_WINDOW_MS` | `60000` | No | entero ≥1000 | Subirlo desactiva el límite global |
| `RATE_LIMIT_MAX` | `300` | No | entero ≥1; ventana global | **Alto** si se relaja: freno de fuerza bruta por IP |
| `AUTH_RATE_LIMIT_MAX` | `20` | No | entero ≥1; ventana = `RATE_LIMIT_WINDOW_MS` | **Crítico**: límite de `/api/v1/auth/*` |
| `AUTH_PASSWORD_RATE_LIMIT_WINDOW_MS` | `3600000` | No | entero ≥1000 | — |
| `AUTH_PASSWORD_RATE_LIMIT_MAX` | `3` | No | entero ≥1; `forgot-password` + `reset-password`, **contador separado** **[impl]** | **Alto**: freno de enumerar cuentas y martillear correo |
| `PAYMENT_PROVIDER` | `MOCK` | No | `MOCK` no conecta a nada (cobro en mostrador) | Sin `PAYMENT_SECRET`, otro valor **aborta** en producción **[impl]** |
| `PAYMENT_SECRET` | `''` | Condic. | obligatoria en producción si `PAYMENT_PROVIDER != MOCK` **[impl]** | Innecesaria con `MOCK` |
| `DEFAULT_CURRENCY` | `COP` | No | 3 letras; fallback mientras `businesses` esté vacía | Nulo |
| `DEFAULT_TIMEZONE` | `America/Bogota` | No | fallback equivalente | Nulo |
| `SEED_ON_MIGRATE` | `false` | No | booleano; `true` ⇒ `npm start` ejecuta `up()` y `runSeed()` **[impl]** | **Crítico** en producción |
| `SEED_SYSTEM_ACCOUNTS` | `true` (desarrollo) / `false` (producción) | No | en producción se **fuerza a `false`**; ponerlo `true` **aborta** el arranque **[impl]** | Ninguno si se acepta el valor de producción |
| `SEED_SYSTEM_ACCOUNTS_PASSWORD` | `LatteCofee#2026` | No | contraseña de `owner@`/`admin@`/`manager@`/`cajero@lattecoffe.co` | **Crítico** fuera de producción: escrita en `.env.example` y en el README, luego pública |
| `SEED_DEMO_DATA` | `true` | No | leído perezosamente de `process.env` al sembrar, no por zod; **ignorado en producción** aunque valga `true` **[impl]** | Con `true` en staging llena la base de datos falsos |
| `SEED_DEMO_PASSWORD` | `''` → reutiliza la de sistema | No | si queda vacía **y** la de sistema también, no se crean esos usuarios y la semilla avisa por log **[impl]** | Hereda el riesgo de la de sistema |
| `MIGRATIONS_DIR` | (auto) | No | **`tsc` no copia los `.sql`**: `resolveMigrationsDir()` busca `src/database/migrations` incluso desde `dist/` **[impl]** | **Alto** si falta en un despliegue compilado: `migrate` aborta |
| `DOTENV_CONFIG_PATH` | (auto) | No | ruta al `.env` **[impl]** | Bajo |

### 2.2 Cambios obligatorios antes de abrir al público

| Variable | En `.env.example` | Qué poner | Por qué |
|---|---|---|---|
| `APP_ENV` / `NODE_ENV` | `development` | `production` | Activa todas las validaciones estrictas |
| `DATABASE_JWT_SECRET` | `cambie-esto-...` | `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` | Única barrera criptográfica del sistema |
| `CORS_ORIGINS` | tres `localhost` | `https://pos.lattecoffe.co,https://www.lattecoffe.co` | Los `localhost` no aportan nada; `*` sería apertura total |
| `DATABASE_PATH` | `./data/lattecoffe.sqlite` | `/var/lib/lattecoffe/lattecoffe.sqlite` | Ruta absoluta fuera del árbol de código |
| `HOST` | `0.0.0.0` | `127.0.0.1` si hay nginx delante | Evita el 3000 sin TLS saltándose el proxy |
| `SEED_ON_MIGRATE` | `false` | `false` (confirmado) | Si es `true`, el arranque crea esquema y datos |
| `SEED_DEMO_DATA` | `true` | `false` | En producción ya se ignora; hacerlo explícito no depende de esa salvaguarda |
| `SEED_SYSTEM_ACCOUNTS_PASSWORD` | `LatteCofee#2026` | una distinta | Si alguien despliega con `APP_ENV=development` por error |
| `PAYMENT_PROVIDER` / `PAYMENT_SECRET` | `MOCK` / vacío | `MOCK` / vacío | Sin pasarela; con otro proveedor el arranque aborta |

En producción `SEED_SYSTEM_ACCOUNTS` se fuerza a `false`, así que **`npm run seed`
NO crea `owner@lattecoffe.co` ni las otras tres cuentas**: el primer `OWNER` hay que
crearlo a mano antes de que nadie pueda operar **[impl]**.

**Sobre la entrega, que corre con `APP_ENV=staging` y no `production`.** El despliegue
de `entrega/` usa `staging` a propósito, y es una excepción consciente: con
`APP_ENV=production` el backend se niega a sembrar datos de demostración y a crear las
cuentas de sistema, así que no habría catálogo ni forma de entrar, que es justo lo que se
entrega. El precio es que el preflight del contenedor sólo aborta con secreto débil en
`production`; en `staging` aborta igualmente si el secreto **falta** o mide menos de 32
caracteres. Para un despliegue real: `APP_ENV=production`,
`SEED_SYSTEM_ACCOUNTS=false`, y el primer `OWNER` creado a mano **[rec]**.

## 3. Despliegue del backend

Hay dos vías. La **3.0** es la que usa la entrega y la recomendada para un servidor: una
imagen de Docker construida desde `backend/Dockerfile` y orquestada con
`docker-compose.yml`. La **3.1** en adelante es el despliegue directo sobre el host con
Node y systemd, y sigue siendo válida si no se quiere usar contenedores.

### 3.0 Con Docker (la vía de la entrega)

Todo lo necesario está en la raíz del repositorio: `docker-compose.yml`,
`.env.example` y `backend/Dockerfile`.

```bash
cp .env.example .env
# 1. Generar un secreto REAL y pegarlo en .env (campo DATABASE_JWT_SECRET)
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
# 2. Poner la contraseña de las cuentas de demo (campo SEED_SYSTEM_ACCOUNTS_PASSWORD).
#    ⚠️ entrecomillada: lleva '#' y dotenv cortaría ahí.

docker compose config --quiet                 # valida el compose; no arranca nada
docker compose build                          # imagen multi-stage
docker compose run --rm api npm run migrate:prod
docker compose run --rm api npm run seed:prod
docker compose up -d api
curl -s http://localhost:3000/api/v1/health
```

#### La imagen (`backend/Dockerfile`)

Dos etapas. La **`build`** instala Python, `make` y `g++` (toolchain mínima), hace
`npm ci` **con** las dependencias de desarrollo, compila TypeScript con
`npm run build`, y termina con `npm prune --omit=dev`. La **`runtime`** copia de ahí el
`node_modules` ya podado —incluido el binario nativo de `better-sqlite3` ya compilado—
más `dist/`, y no lleva compilador **[impl]**.

| Decisión | Por qué |
|---|---|
| Usuario `node` (uid 1000), nunca root | Un compromiso en la app no da root en el host |
| `HOST=0.0.0.0`, `EXPOSE 3000` | Sin esto el contenedor escucha sólo en loopback y no responde al reenvío de puerto **[impl]** |
| `DATABASE_PATH=/data/lattecoffe.sqlite` | La base vive en el volumen, **fuera** de `/app` |
| `HEALTHCHECK` contra `/api/v1/health` con `curl --fail` | Un 503 (base caída) tiene que contar como fallo, no como "sano" |
| `tini` como PID 1 | Node recibe el `SIGTERM` y puede drenar el HTTP y cerrar SQLite con `wal_checkpoint(TRUNCATE)`. Sin init el contenedor muere con la base en WAL **[impl]** |
| `docker/entrypoint.sh` antes de arrancar | Valida la configuración y **aborta con exit 78** si en `APP_ENV=production` el secreto JWT es débil |
| El `CMD` **no** migra ni siembra | El esquema nunca se crea al arrancar: son comandos explícitos. Migrar en cada restart sería una carrera |

#### Las dos trampas, y cómo las resuelve

**Trampa 1 — `npm run migrate` usa `tsx`, que es una `devDependency`.** Un
`npm ci --omit=dev` rompe las migraciones. Comprobado dentro del contenedor:

```
$ docker exec lattecoffe-api npm run migrate
> tsx src/database/cli.ts up
sh: 1: tsx: not found
```

Solución: **en la imagen no se usa `tsx`**. `src/database/cli.ts` es TypeScript normal,
`tsc` lo compila a `dist/database/cli.js` y el migrador y el seeder corren con `node`
pelado. Por eso existen los scripts `migrate:prod`, `migrate:status:prod`,
`migrate:rollback:prod` y `seed:prod` en `backend/package.json`, distintos de los de
desarrollo **[impl]**.

**Trampa 2 — `tsc` no copia los `.sql` a `dist/`,** y `resolveMigrationsDir()` localiza
la carpeta probando rutas relativas. Reproducido en el servidor:

```
$ docker run --rm … --entrypoint sh lattecoffe-api:1.0.0 \
    -c "rm -rf /app/src /app/migrations; env -u MIGRATIONS_DIR node dist/database/cli.js status"
DatabaseError: … /app/src/database/migrations
Defina MIGRATIONS_DIR o ejecute las migraciones desde el repositorio (npm run migrate).
```

Solución doble: los `.sql` se copian a `/app/migrations` y se fija
`MIGRATIONS_DIR=/app/migrations`, que es el override que el propio migrador respeta; y
además se copian a la ruta que el sondeo encontraría, como red de seguridad **[impl]**.

#### El preflight de arranque

`docker/entrypoint.sh` no reimplementa la lista de secretos débiles: **importa
`isWeakSecret()` del propio backend** (`dist/config/env.js`). Así hay una sola definición
de "secreto débil" en todo el sistema, y si mañana se añade un patrón a
`WEAK_SECRET_PATTERNS` el contenedor lo hereda sin tocar el script **[impl]**.

```
$ docker run --rm -e APP_ENV=production \
    -e DATABASE_JWT_SECRET="changeme-secret-de-lattecoffe-demo-2026" \
    lattecoffe-api:1.0.0 true
[lattecoffe] CONFIGURACION INVALIDA: DATABASE_JWT_SECRET es débil para APP_ENV=production. …
[lattecoffe] Preflight FALLIDO. El contenedor no arranca (exit 78).
```

Con `APP_ENV=staging` —que es lo que usa la entrega, porque hace falta sembrar las
cuentas de prueba— aborta igualmente si el secreto **falta** o mide menos de 32
caracteres.

#### Persistencia

El servicio `api` monta el volumen nombrado `lattecoffe-api-data` en `/data`.
`docker compose down` **no** se lo lleva; `docker compose down -v` sí, y eso destruye la
base. Para una instalación de verdad, `docker compose down -v` debería ser un comando
que nadie escriba por sorpresa **[rec]**. La copia de seguridad está en §5.

El puerto se publica con `"${API_BIND:-127.0.0.1}:${API_PORT:-3000}:3000"`. El valor por
defecto es **loopback a propósito**: el API no queda expuesto a internet, y el acceso
público es cosa del túnel (§3.5) o de un nginx con TLS (§3.4).

### 3.1 Build y arranque (sin Docker)

```bash
sudo useradd --system --home /opt/lattecoffe --shell /usr/sbin/nologin lattecoffe
sudo rsync -a --exclude node_modules --exclude dist --exclude .git ./ /opt/lattecoffe/
sudo -u lattecoffe bash -lc '
  cd /opt/lattecoffe/backend && node -v && npm ci && npm run build && npm test'
```

Tres avisos verificados **[impl]**. (1) `npm run build` (`tsc -p tsconfig.build.json`)
produce `dist/` con **sólo `.js`**: `tsc` **no copia los `.sql`** y
`resolveMigrationsDir()` los busca en `src/database/migrations` incluso desde
`dist/`, así que un despliegue con sólo `dist/` hace fallar `npm run migrate` (copie
`src/database/migrations/` o fije `MIGRATIONS_DIR`). (2) **No use `--omit=dev`**:
`tsx` es `devDependency` y lo usan `migrate`, `migrate:status`, `migrate:rollback` y
`seed`; sin devDependencies esos cuatro fallan, aunque `npm start` sí funciona.
(3) `server.ts` abre la base, comprueba salud, cuenta migraciones pendientes y sólo
entonces escucha: con `SEED_ON_MIGRATE=false` **nunca crea el esquema**, escribe un
`warn` si faltan y arranca igual. El log de arranque es JSON en `stdout` (pino, sin
fichero) e incluye `port`, `env`, `version`, `database` y `routes` con los 20 prefijos.

### 3.2 Migraciones

**Son un comando explícito y NUNCA automáticas al arrancar**: con
`SEED_ON_MIGRATE=false`, `server.ts` no llama a `up()`, sólo cuenta pendientes
**[impl]**. Mecánica de `src/shared/database/migrator.ts` **[impl]**: lee
`src/database/migrations/*.sql` en orden lexicográfico (los `.down.sql` se saltan),
calcula el **SHA-256** de cada fichero, registra cada aplicada en `_migrations (id,
name, checksum, applied_at, execution_ms)`, **aborta** si una ya aplicada cambió de
checksum o su fichero desapareció (editar historia está prohibido; la corrección es
una migración nueva), aplica cada una en su **propia** transacción
`BEGIN IMMEDIATE`/`COMMIT` con `ROLLBACK` si falla, y rechaza ficheros con `BEGIN`,
`COMMIT`, `ROLLBACK`, `SAVEPOINT` o `RELEASE` (analiza el esqueleto del SQL sin
comentarios ni literales). `PRAGMA` sí se permite.

| Momento | ¿Migrar? |
|---|---|
| Primera instalación | Sí: `npm run migrate` **y** `npm run seed`. Sin `seed`, `/api/v1/meta/roles` da 503 y **ningún endpoint protegido deja pasar a nadie** **[impl]** |
| Despliegue con migraciones nuevas | Sí, explícitamente |
| Cada reinicio del servicio | No: `up()` es idempotente |
| Automáticamente en `npm start` | Nunca, salvo `SEED_ON_MIGRATE=true` |

**[rec]** Parar el servicio, migrar, arrancar: con el servidor en vivo, una
migración que recree una tabla compite por el lock de escritura con los cajeros y
puede agotar `busy_timeout` y devolver 409.

```bash
sudo systemctl stop lattecoffe-api
sudo -u lattecoffe bash -lc 'cd /opt/lattecoffe/backend && npm run migrate && npm run migrate:status'
sudo systemctl start lattecoffe-api
```

**Comprobar:** `npm run migrate:status` imprime una línea por migración con
`aplicada` / `PENDIENTE` / `ALTERADA`, checksum de 12 caracteres, fecha, duración y
si existe `down`. Si aparece `ALTERADA` el historial está roto: no aplique nada más
hasta crear una migración correctiva. **Revertir:** `npm run migrate:rollback`
ejecuta el `.down.sql` de la **última** aplicada y borra su fila (así `migrate`
puede volver a aplicarla). Sólo una, y **exige su `.down.sql`**: sin él falla con
mensaje explícito en lugar de adivinar un `DROP`. No hay rollback múltiple **[impl]**.

### 3.3 systemd

```ini
# /etc/systemd/system/lattecoffe-migrate.service
[Unit]
Description=LatteCoffe POS - migraciones SQLite (oneshot)
After=local-fs.target
[Service]
Type=oneshot
User=lattecoffe
Group=lattecoffe
# env.ts resuelve PACKAGE_ROOT desde el módulo: DATABASE_PATH relativo y el
# directorio de migraciones se calculan desde aquí.
WorkingDirectory=/opt/lattecoffe/backend
# KEY=VALOR, sin `export`; comillas sólo si el valor las necesita.
EnvironmentFile=/etc/lattecoffe/api.env
# tsx es devDependency: este unit asume devDependencies instaladas, o que se haya
# copiado src/database/migrations/ junto a dist/.
ExecStart=/usr/bin/npm run migrate
# El seed crea el negocio singleton y la matriz RBAC. No se puede encadenar con
# `migrate`: cli.ts acepta un único subcomando (up|status|rollback|seed).
ExecStart=/usr/bin/npm run seed
RemainAfterExit=yes
TimeoutStartSec=300
NoNewPrivileges=true
PrivateTmp=true
[Install]
WantedBy=multi-user.target
```

```ini
# /etc/systemd/system/lattecoffe-api.service
[Unit]
Description=LatteCoffe POS API (Node.js + Express 5 + SQLite)
# network-online, no network.target: se necesita ruta, no un NIC.
After=network-online.target
Wants=network-online.target
# Las migraciones corren ANTES. Con RemainAfterExit=yes, si ya está activo no se
# repite: tras desplegar código nuevo, `systemctl restart lattecoffe-migrate`.
Requires=lattecoffe-migrate.service
After=lattecoffe-migrate.service
[Service]
Type=simple
User=lattecoffe
Group=lattecoffe
WorkingDirectory=/opt/lattecoffe/backend
EnvironmentFile=/etc/lattecoffe/api.env
# node directo y no `npm start`: el intermediario de npm no recibe SIGTERM de
# forma fiable y puede dejar el hijo huérfano.
ExecStart=/usr/bin/node /opt/lattecoffe/backend/dist/server.js
# on-failure y NO always: el apagado ordenado sale con process.exit(0) tras
# SIGTERM, y `always` provocaría un bucle de reinicio en cada `systemctl stop`.
Restart=on-failure
RestartSec=5
# SIGTERM es la señal que server.ts maneja: deja de aceptar conexiones, drena el
# HTTP y cierra SQLite con wal_checkpoint(TRUNCATE).
KillSignal=SIGTERM
KillMode=mixed
# 20 s > SHUTDOWN_TIMEOUT_MS (10 s, server.ts:27). Si systemd matara antes se
# perdería la ventana de drenaje y SQLite cerraría con work pendiente.
TimeoutStopSec=20
StandardOutput=journal
StandardError=journal
SyslogIdentifier=lattecoffe-api
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictSUIDSGID=true
# Crea /var/lib/lattecoffe con el propietario correcto y lo hace escribible pese
# a ProtectSystem=strict. DATABASE_PATH debe apuntar aquí.
StateDirectory=lattecoffe
[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now lattecoffe-migrate lattecoffe-api
journalctl -u lattecoffe-api -f          # sudo systemctl restart lattecoffe-api
# [rec] permisos
sudo chown -R lattecoffe:lattecoffe /var/lib/lattecoffe && sudo chmod 700 /var/lib/lattecoffe
sudo chmod 600 /var/lib/lattecoffe/lattecoffe.sqlite /etc/lattecoffe/api.env
```

### 3.4 nginx

```nginx
# /etc/nginx/sites-available/lattecoffe-api
server {   # HTTP: sólo redirección, para que el TLS no se pueda saltar por http://
    listen 80; listen [::]:80; server_name pos.lattecoffe.co;
    location / { return 301 https://$host$request_uri; }
}
server {
    listen 443 ssl; listen [::]:443 ssl; http2 on; server_name pos.lattecoffe.co;
    ssl_certificate     /etc/letsencrypt/live/lattecoffe.co/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/lattecoffe.co/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_session_cache   shared:SSL:10m; ssl_session_timeout 1d;
    ssl_stapling on; ssl_stapling_verify on;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "no-referrer" always;
    # helmet ya pone HSTS en producción y NO pone CSP: la API no sirve HTML.
    # El backend rechaza >1 MB (JSON_BODY_LIMIT='1mb') y nginx debe estar
    # alineado: más estricto daría 413 con HTML en vez del 400 del contrato;
    # más laxo wasteful subiría el cuerpo para que Express lo rechace.
    client_max_body_size 1m;
    client_body_buffer_size 128k; client_body_timeout 15s;
    location / {
        proxy_pass http://127.0.0.1:3000;
        # Express usa `trust proxy = 1` (un salto). Con otro balanceador delante
        # hay que subirlo, o el rate limit por IP contará la IP del balanceador.
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Request-Id      $request_id;
        # No reescribir lo que el backend ya expone: X-Request-Id, Retry-After y
        # RateLimit-* están en exposedHeaders del CORS.
        proxy_connect_timeout 5s; proxy_send_timeout 30s; proxy_read_timeout 30s;
    }
    location = /api/v1/health { access_log off; proxy_pass http://127.0.0.1:3000; }
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
curl -fsS https://pos.lattecoffe.co/api/v1/health | jq
```

**Por qué TLS también en LAN [rec].** El POS manda el bearer token en
`Authorization` de cada petición autenticada: en HTTP plano viaja legible para
cualquiera del segmento, y una red de cafetería con la caja, el portátil de
reservas y el wifi de clientes es justo ese caso. Además, sin HTTPS la web pierde
WebCrypto (§4) y la sesión persistente. Un certificado interno (`step-ca`,
`mkcert`) basta: importa el cifrado, no que la cadena sea pública. El sistema no
tiene pasarela de pagos (el datáfono se registra con `method='CARD'` y la aprobación
en `providerReference`, `BR-SEC-006`), pero el token sigue siendo reutilizable
durante `JWT_ACCESS_TTL` y `JWT_REFRESH_TTL_DAYS`.

### 3.5 Túnel público temporal (sólo para la demostración)

Un backend en un servidor doméstico no es alcanzable desde un teléfono. Para la entrega
se usa un **quick tunnel** de Cloudflare: gratis, sin cuenta, y da una URL `https`
pública en segundos. **No es un despliegue de producción** y hay que decirlo claro
**[rec]**.

Está declarado en `docker-compose.yml` dentro del **perfil opcional** `tunnel`, así que
`cloudflared` **no** se instala como dependencia del proyecto: corre como el contenedor
`cloudflare/cloudflared:latest`.

```bash
# En el servidor
cd ~/lattecoffe

docker compose --profile tunnel up -d tunnel
docker compose logs tunnel | grep -o 'https://[a-z-]*\.trycloudflare\.com' | head -1
# -> https://<algo>.trycloudflare.com

# Comprobar desde CUALQUIER máquina, no desde el servidor
curl -s https://<esa-url>/api/v1/health
curl -s https://<esa-url>/api/v1/menu | head -c 200

docker compose --profile tunnel stop tunnel     # parar (el API sigue por dentro)
docker compose --profile tunnel up -d tunnel    # volver a levantar
```

El túnel depende de que el servicio `api` esté **sano**: lleva
`depends_on: { api: { condition: service_healthy } }`, de modo que no puede salir un
túnel apuntando a un contenedor que aún no responde.

**Lo que hay que advertir de esta URL:**

- **Es aleatoria y cambia en cada arranque.** No hay forma de fijarla sin una cuenta de
  Cloudflare y un dominio.
- **No hay SLA.** Cloudflare puede cortarla, y el túnel se cae si se reinicia el host.
  El `restart: unless-stopped` del contenedor no protege de una caída de red larga.
- **Como el API está en producción real, esto lo expone a internet sin rate limit
  propio** más allá del de la aplicación. Para una demostración con datos de prueba es
  aceptable; para un negocio abierto al público, no: eso es nginx con TLS (§3.4).

Para un despliegue estable: dominio propio, cuenta de Cloudflare, `cloudflared tunnel`
con nombre y certificado permanente, y nginx delante. La app no cambia; lo único que
cambia es la URL con la que se compila (§4).

### 3.6 Reconstruir el APK cuando cambia la URL

Como la URL va incrustada en el APK, **cambiar el túnel obliga a recompilar**:

```bash
export PATH=$PATH:~/development/flutter/bin
export ANDROID_HOME=$HOME/Android/Sdk
export ANDROID_SDK_ROOT=$ANDROID_HOME
export JAVA_HOME=/usr/lib/jvm/java-17-amazon-corretto   # Java 25 rompe Gradle
cd frontend

flutter build apk --release \
  --dart-define=API_BASE_URL=https://<la-url-nueva>/api/v1
cp build/app/outputs/flutter-apk/app-release.apk ../entrega/LatteCoffee-release.apk
```

Verificar que la URL correcta quedó dentro del APK (≈100 s de build):

```bash
cd /tmp && rm -rf verif && mkdir verif && cd verif
unzip -o -q -j ~/ruta/al/repo/entrega/LatteCoffee-release.apk 'lib/*/libapp.so'
strings lib/arm64-v8a/libapp.so | grep -E 'trycloudflare|localhost:3000'
```

## 4. Despliegue del frontend

`AppConfig.apiBaseUrl` es `String.fromEnvironment('API_BASE_URL', defaultValue:
'http://localhost:3000/api/v1')`: la URL se inyecta **en tiempo de compilación** y
`isUsingDefaultApiUrl` queda a `true` si se compiló sin ella **[impl]**. El valor
**incluye el prefijo `/api/v1`**; omitirlo da 404 en todo.

```bash
# Web -> build/web/
flutter build web --release --dart-define=API_BASE_URL=https://pos.lattecoffe.co/api/v1
# Android APK -> build/app/outputs/flutter-apk/app-release.apk (instalación directa)
flutter build apk --release --dart-define=API_BASE_URL=https://pos.lattecoffe.co/api/v1
# Android Play -> build/app/outputs/bundle/release/app-release.aab
flutter build appbundle --release --dart-define=API_BASE_URL=https://pos.lattecoffe.co/api/v1
# iOS -> .app / .ipa
flutter build ios --release --dart-define=API_BASE_URL=https://pos.lattecoffe.co/api/v1
flutter build ipa --release --dart-define=API_BASE_URL=https://pos.lattecoffe.co/api/v1
# Desarrollo: emulador Android usa http://10.0.2.2:3000/api/v1 (alias del loopback
# del host); iOS simulador y web usan http://localhost:3000/api/v1
```

**Web, servirla.** Reutilizar el bloque TLS de §3.4 con `root
/var/www/lattecoffe-web` y `try_files $uri $uri/ /index.html`, más `expires 30d`
para `js|wasm|css|png|jpg|svg|ttf|otf|json|ico` y `Cache-Control "no-store, no-cache,
must-revalidate"` en `index.html`, que nunca debe cachear porque es el que apunta a
los bundles versionados. **[rec]** Deploy atómico para no servir un bundle a medio
construir: `cp -a build/web/. /var/www/lattecoffe-web-$(date +%s)/` y después
`ln -sfn` sobre `/var/www/lattecoffe-web`.

**HTTPS es obligatorio, no una recomendación [impl].** `TokenStorage` usa
`flutter_secure_storage`, que en web cifra `localStorage` con **WebCrypto**,
disponible sólo en contexto seguro: **HTTPS o `localhost`**. Sin HTTPS el plugin
falla y `TokenStorage.save()` degrada a "sin sesión persistente": la app funciona,
pero el operador tiene que iniciar sesión en cada recarga. El origen web debe
aparecer **literalmente** en `CORS_ORIGINS`.

**Firma de Android.** `--release` implica shrinking y **firma obligatoria**. En este
repositorio el behaviour real es más permisivo que el que se suele recomendar, y es
deliberado: `android/app/build.gradle` **no falla** si falta `android/key.properties`,
sino que cae a la clave de **debug** y avisa por consola. Así se puede generar un APK
"de release" que **no es publicable**, sin que el build se rompa. Para una instalación
de verdad hay que poner la clave y comprobar el resultado:

```bash
# el fichero existe: build firmado con la clave del proyecto
# el fichero NO existe: aviso en consola "ATENCION: … se firma con la clave de DEBUG"
ls -l android/key.properties          # gitignored, chmod 600
```

`key.properties` lleva `storePassword`, `keyPassword`, `keyAlias` y `storeFile`, y
`android/app/build.gradle` referencia `signingConfigs.release`. Play Console rechaza el
bundle si `versionCode` no sube. `R8` está **desactivado a propósito**
(`minifyEnabled false`): un fallo de ofuscación en el APK de una entrega es muy difícil
de diagnosticar en un teléfono.

**Permisos y tráfico en claro en Android.** Dos cosas que no son evidentes y que
condicionan si el APK funciona **[impl]**:

- **`android.permission.INTERNET` tiene que estar en `src/main/AndroidManifest.xml`.**
  El template de Flutter lo declara sólo en `src/debug` y `src/profile` (para el hot
  reload), así que **un APK de release se compila sin él** y no puede hacer ni una
  petición HTTP: el login falla con un error de red inexplicable.
- **El tráfico en claro se gobierna con `network_security_config.xml`, no con
  `usesCleartextTraffic`.** Un agente anterior había puesto
  `android:usesCleartextTraffic="true"` en el manifiesto principal; se cambió. Con un
  backend HTTPS no hace falta, y dejarlo global expondría los tokens de sesión en
  cualquier Wi-Fi ajena. Lo que hay ahora es `base-config` con
  `cleartextTrafficPermitted="false"` y una **excepción mínima** sólo para `localhost`,
  `127.0.0.1` y `10.0.2.2` (el `adb reverse` del taller y el alias del emulador). Es una
  **lista blanca, no un interruptor general**, y aplica a los tres build types porque
  vive en `src/main/res`. Un APK que apunte a un túnel HTTPS no necesita tocar nada
  **[rec]**.

**Firma de iOS.** Requiere **macOS con Xcode**: no hay build de iOS desde Linux. La
firma exige Apple Developer Program activo, certificado de distribución,
`.mobileprovision` con el Bundle ID registrado y `DEVELOPMENT_TEAM` /
`PRODUCT_BUNDLE_IDENTIFIER` en `ios/Runner/Configs/AppInfo.xcconfig`. Sin ellos
`flutter build ipa` falla en la fase de archivo **[impl]**.

## 5. Persistencia y copias de seguridad de SQLite

**Dónde está la base en la entrega.** Con la vía de Docker (§3.0) el fichero no está en
`backend/data/`: está en el volumen nombrado `lattecoffe-api-data`, en
`/data/lattecoffe.sqlite`. Copiarlo exige el mismo cuidado de la regla de abajo, porque
el contenedor está escribiendo. La forma correcta de respaldar el volumen es parar el
escritor o usar una de las tres APIs de (a), (b) y (c) de §5.1 **[rec]**.

```bash
# Lo RÁPIDO, sólo aceptable con el contenedor parado (docker compose stop api):
docker compose stop api
docker run --rm -v lattecoffe-api-data:/data -v "$PWD":/out alpine \
  tar czf /out/lattecoffe-backup.tgz -C /data .
docker compose start api
# y después: login real contra la copia (§5.3). integrity_check NO basta.
```

**Por qué NO copiar el `.sqlite` en caliente [impl].** La conexión se abre en **WAL**
(`connection.ts`: `journal_mode = WAL`, `foreign_keys = ON`, `busy_timeout`,
`synchronous = NORMAL`). En WAL, un `cp` del fichero principal con el servidor
escribiendo produce una copia **inconsistente**: parte del contenido está en el
fichero y parte en el `-wal` que no se copió. El `cp` puede además copiar páginas a
mitad de un checkpoint y devolver cabecera y contenido descuadrados. `PRAGMA
integrity_check` sobre esa copia suele **pasar** (los datos parecen coherentes) y el
fallo aparece semanas después, cuando alguien descubre que falta un pedido. Copiar a
mano el `-wal` y el `-shm` no resuelve nada: deja la ventana abierta. Regla: **nunca
`cp`, `rsync`, `tar` ni `scp` con el servidor en marcha**. Además SQLite bloquea el
destino al escribir, así que copiar dentro del directorio de trabajo puede fallar con
`SQLITE_BUSY` y dejar un fichero a medias.

### 5.1 Las tres opciones, verificadas

Las tres existen y se ejecutaron contra `better-sqlite3@13.0.3` con el SQLite 3.53.4
embebido. Verificación: `lib/methods/backup.js` existe y `lib/database.js:68` lo
engancha como `Database.prototype.backup`; `@types/better-sqlite3/index.d.ts:87`
declara la firma **[impl]**.

**(a) `db.backup()` — API de backup online de SQLite. Es la recomendada con el motor
abierto.** Es `sqlite3_backup_*`: copia página a página con snapshot coherente y **se
reanuda automáticamente** si la escritura fuente avanza. Devuelve
`Promise<{totalPages, remainingPages}>`, **rechaza `:memory:` como destino** y **exige
que el directorio de destino exista** (`fs.access` → `TypeError`). La callback
`progress` puede devolver un número de páginas por paso.

```js
// /opt/lattecoffe/backend/backup.mjs   (ESM: package.json tiene "type":"module")
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import Database from 'better-sqlite3';
const BACKEND_ROOT = '/opt/lattecoffe/backend';   // env.ts resuelve las relativas contra aquí
const raw = process.env.DATABASE_PATH ?? './data/lattecoffe.sqlite';
const src = raw === ':memory:' || isAbsolute(raw) ? raw : resolve(BACKEND_ROOT, raw);
const dir = '/var/backups/lattecoffe';
await mkdir(dir, { recursive: true });            // obligatorio para db.backup()
const dest = `${dir}/lattecoffe-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`;
const db = new Database(src, { readonly: true });
try {
  const meta = await db.backup(dest, { progress: ({ remainingPages, totalPages }) => {
    process.stdout.write(`backup: ${totalPages - remainingPages}/${totalPages} paginas\n`);
    return 500;                                    // páginas por paso
  } });
  process.stdout.write(`backup completo: ${dest} (${meta.totalPages} paginas)\n`);
} finally { db.close(); }
```

Lo que hace segura la copia no es `readonly: true` sino el algoritmo de
`sqlite3_backup`; `readonly` sólo evita que el backup añada competencia de escritura.

**(b) `VACUUM INTO`. Alternativa válida.** SQLite 3.27+ (aquí 3.53.4) escribe una
copia **compactada** y consistente. Verificado que acepta parámetro enlazado, lo que
evita concatenar la ruta en el SQL:

```js
import Database from 'better-sqlite3';
const db = new Database('/var/lib/lattecoffe/lattecoffe.sqlite');
try { db.prepare('VACUUM INTO ?').run('/var/backups/lattecoffe/vacuum.sqlite'); }
finally { db.close(); }
```

Trade-off: **no puede ejecutarse dentro de una transacción** (verificado:
`SQLITE_ERROR: cannot VACUUM from within a transaction`), por eso abre conexión
propia; y reescribe todo el contenido, así que el pico de I/O es mayor.

**(c) `sqlite3 .backup`. La más simple.** Verificado con `sqlite3 3.53.4`: usa la
misma API online por debajo, así que también es segura con el motor en marcha, y no
requiere Node ni script que mantener.

```bash
sqlite3 /var/lib/lattecoffe/lattecoffe.sqlite \
  ".backup '/var/backups/lattecoffe/cli-$(date -u +%Y%m%dT%H%M%SZ).sqlite'"
sqlite3 /var/backups/lattecoffe/cli-<fecha>.sqlite "PRAGMA integrity_check;"
```

| | (a) `db.backup()` | (b) `VACUUM INTO` | (c) `sqlite3 .backup` |
|---|---|---|---|
| Seguro con el motor abierto | Sí (API online) | Sí | Sí |
| Reanuda si la escritura avanza | Automática | No (snapshot) | Automática |
| Salida compacta | No | **Sí** | No |
| I/O y espacio extra | Bajo / base | Alto / base | Bajo / base |
| Dependencias | Node + `better-sqlite3` | Node + `better-sqlite3` | Sólo `sqlite3` |

**[rec]** (c) por simplicidad en un despliegue de una máquina; (a) si se quiere
control del progreso y métricas en un script propio. (b) sólo si el espacio es el
problema y se quiere una copia compacta.

### 5.2 Cadencia, rotación y destino

| Qué | Cuándo | Dónde | Retención |
|---|---|---|---|
| Backup en caliente | cada hora | `/var/backups/lattecoffe/` | 48 h |
| Backup diario | 03:00 | `.../daily/` | 14 días |
| Antes de migrar | manual, siempre | `.../pre-migrate/` | 90 días |
| Copia externa | semanal, fuera de horario | fuera del local | 6 meses |

```bash
find /var/backups/lattecoffe -maxdepth 1 -name 'lattecoffe-*.sqlite' -type f -mmin +2880 -delete
find /var/backups/lattecoffe/daily -maxdepth 1 -name '*.sqlite' -type f -mtime +14 -delete
sha256sum /var/backups/lattecoffe/lattecoffe-*.sqlite > /var/backups/lattecoffe/SHA256SUMS
```

**Antes de cualquier `npm run migrate`, backup y comprobar que existe:** un
`.down.sql` mal escrito puede perder datos. `/var/backups` merece la misma
confidencialidad que la base — contiene hashes bcrypt, `token_hash` de refresh
tokens, emails y el histórico de cobros. `chmod 700`, sin acceso a usuarios no de confianza.

### 5.3 Prueba de restauración

**Un backup que nunca se ha restaurado no es un backup.** Es la afirmación más
importante de esta sección: el más común del mundo está corrupto y nadie lo sabe
hasta que hace falta. **[rec]** Ejecutar **al menos una vez al mes**.

```bash
sqlite3 /var/backups/lattecoffe/lattecoffe-<fecha>.sqlite "PRAGMA integrity_check;"
mkdir -p /tmp/restore-test
cp /var/backups/lattecoffe/lattecoffe-<fecha>.sqlite /tmp/restore-test/prod.sqlite
sqlite3 /tmp/restore-test/prod.sqlite "
  SELECT count(*) AS tablas FROM sqlite_master WHERE type='table';
  SELECT name, applied_at FROM _migrations ORDER BY id;
  SELECT count(*) AS pedidos FROM orders; SELECT count(*) AS pagos FROM payments;"
DATABASE_PATH=/tmp/restore-test/prod.sqlite APP_ENV=staging NODE_ENV=staging \
DATABASE_JWT_SECRET=<secreto-de-pruebas-no-el-de-produccion> \
  node /opt/lattecoffe/backend/dist/server.js &
curl -fsS http://127.0.0.1:3000/api/v1/health | jq '.data.database'   # migrationsPending: 0
# El paso que de verdad prueba el backup: login real contra la copia, que valida
# que los hashes bcrypt se copiaron. integrity_check sólo dice que las páginas
# están sanas.
curl -sS -X POST http://127.0.0.1:3000/api/v1/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"<un-owner-real>","password":"<su-contraseña>"}' | jq '.success'
kill %1; rm -rf /tmp/restore-test
```

## 6. Migración futura a PostgreSQL

Detalle completo en [`DESIGN.md` §10](./DESIGN.md): §10.1 portable, §10.2 no portable,
§10.3 checklist de 15 pasos, §10.4 fechas, §10.5 confirmación.

**Lo que ya es portable [impl]**, y por qué evita reescribir el dominio: dinero en
**enteros de centavos** (`INTEGER` sin coma flotante → `INT`/`BIGINT`); fechas en
**`TEXT` ISO-8601 UTC** y horas `HH:MM`, donde el orden lexicográfico coincide con el
cronológico y `start_at <= :now` funciona igual en ambos motores; PK **enteras**
`INTEGER PRIMARY KEY AUTOINCREMENT` (el tipo sigue siendo `number`/`int`); **repositorios
tras interfaces** (`X.repository.ts` sin SQL) más `X.repository.sqlite.ts`, de modo que
se añade `X.repository.postgres.ts` sin tocar el service; y **índices parciales**
`WHERE status IN (...)`, CHECK, UNIQUE compuestos y `snake_case`, con sintaxis idéntica
o casi idéntica.

**Qué habría que cambiar exactamente.** (1) `AUTOINCREMENT` → `BIGSERIAL` +
`PRIMARY KEY`, sólo en el DDL de migraciones. (2) `last_insert_rowid()` →
`RETURNING id`: el cambio más invasivo, afecta a **todas las inserciones** y queda
confinado a los repositorios. (3) **`PRAGMA` desaparece**: `journal_mode` no aplica
(MVCC), `foreign_keys` es siempre activo, `busy_timeout` → `lock_timeout` /
`statement_timeout` del pool, y `shared/database/connection.ts` deja de tener
equivalente. (4) `BEGIN IMMEDIATE` → `BEGIN` + `COMMIT`/`ROLLBACK`: un
`pg-unit-of-work.ts` implementando **la misma** `IUnitOfWork`. (5) Conexión síncrona
→ pool asíncrono: `IUnitOfWork.run` pasa a `async`, único cambio de firma en la base de
código. (6) `json_extract(x,'$.k')` → `x->>'k'`, `TEXT` JSON → `JSONB` y reconstruir
el índice de idempotencia de pagos; `CHECK (json_valid(x))` **no existe** en PG.
(7) Triggers de `updated_at` → `CREATE FUNCTION set_updated_at()` + trigger por tabla;
`strftime(...)` → `to_char(now() AT TIME ZONE 'UTC', ...)`. (8) `LIKE` → `ILIKE`,
`GROUP_CONCAT` → `string_agg`, `INSERT OR IGNORE` → `ON CONFLICT DO NOTHING`,
booleanos `0/1` → `BOOLEAN`, `REAL` de stock → `NUMERIC(14,3)`, y sentinelas
`SQLITE_CONSTRAINT_*` → `23505`/`23503`/`23514` mapeadas en un solo fichero.
(9) **Verificación obligatoria**: comparar la salida de los endpoints de reportes entre
ambos motores con el mismo dataset antes de cortar.

`DESIGN.md` §10.5 afirma que el dominio **no** cambia; el coste es mantener dos
runners de migración durante la transición, porque los `.sql` actuales no son portables.

## 7. Seguridad operativa

Checklist antes de abrir al público. **[impl]** = garantizado por el código.

- **Configuración.** `APP_ENV=production` y `NODE_ENV=production`.
  `DATABASE_JWT_SECRET` de 48 bytes aleatorios, único por entorno, en gestor de
  secretos (en producción el arranque aborta si es débil; rotarlo invalida todos los
  access y refresh tokens emitidos). `CORS_ORIGINS` con los orígenes reales y exactos,
  nunca `*`. `SEED_SYSTEM_ACCOUNTS` no activado (activarlo aborta, a propósito).
  `SEED_ON_MIGRATE=false` y `SEED_DEMO_DATA=false`. `SEED_SYSTEM_ACCOUNTS_PASSWORD`
  cambiada. `PAYMENT_PROVIDER=MOCK` con `PAYMENT_SECRET` vacío. `LOG_LEVEL=info`.
- **Primer acceso.** `npm run seed` ejecutado: sin matriz RBAC, `/api/v1/meta/roles`
  da 503 y nadie puede operar. Primer `OWNER` creado **a mano**: en producción la
  semilla no crea cuentas. Contraseña con 3 de 4 clases (más estricta que `DESIGN.md`
  11.1). `SELECT email FROM users WHERE email LIKE '%@lattecoffe.co';` para confirmar
  que no queda ninguna cuenta con la contraseña de la semilla.
- **Ficheros y permisos.** `DATABASE_PATH` absoluta, **fuera del árbol de código** y
  del web root. `chmod 700` en el directorio de datos, `600` en el `.sqlite` y en
  `api.env`. `ProtectSystem=strict` + `StateDirectory=` en el unit. Proceso como
  usuario de sistema `nologin`, nunca `root`. `/var/backups/lattecoffe/` con los
  mismos permisos: contiene bcrypt y tokens.
- **Red.** TLS vigente con HSTS (`helmet` lo añade solo en producción: `maxAge
  31536000`, `includeSubDomains`). `HOST=127.0.0.1` si hay nginx delante.
  `client_max_body_size` en nginx alineado con `JSON_BODY_LIMIT='1mb'`. Sin proxy
  intermedio mal contado: el rate limit por IP depende de `trust proxy = 1`.
- **Logs.** Salida por journald con retención; JSON en `stdout`, una línea por evento,
  `requestId` en cada una. El `redact` de pino cubre `authorization`, `cookie`,
  `set-cookie`, `password`, `passwordHash`, `token`, `refreshToken`, `accessToken`,
  `cardNumber`, `cvv`, `cvc`, `securityCode`. Acceso al journal restringido: contiene
  emails, IPs y códigos de pedido. `/api/v1/health` no genera línea de acceso por
  petición (`autoLogging.ignore`): bien para una sonda de 1 s, malo para espiar tráfico.
- **Lo que el sistema ya protege [impl].** Login con mensaje y código idénticos para
  email inexistente y contraseña incorrecta, más un `compare` señuelo para que el
  tiempo de respuesta no lo delate. Límites 300/min, 20/min en `/auth/*` y 3/hora en
  recuperación de contraseña. Rotación de refresh tokens con detección de reuso: un
  token revocado revoca **toda** la familia y devuelve 401, y en la base sólo se guarda
  su SHA-256. Cambiar roles revoca los refresh tokens (`BR-RBAC-007`). Ningún stack
  trace en la respuesta en producción. El número de tarjeta nunca se persiste
  (`BR-SEC-006`). `audit_logs` se escribe siempre, independiente del `LOG_LEVEL`.

## 8. Monitoreo y operación

### 8.1 Endpoints de salud

| Endpoint | Público | Devuelve |
|---|---|---|
| `GET /api/v1/health` | Sí | `status`, `name`, `version`, `uptimeSeconds`, `database.connected`, `database.migrationsPending`, `checks.database`, `checks.scheduler` |
| `GET /api/v1/meta/enums` | Sí | Enums y transiciones: referencia única para el cliente |
| `GET /api/v1/meta/roles` | Sí | 6 roles, 83 permisos, matriz. **503** si RBAC no está sembrado |
| `GET /` | Sí | Nombre, versión, prefijo de la API |

`/api/v1/health` **[impl]**: **200** `status:'ok'` si la BD responde; **200**
`status:'degraded'` si responde pero `migrationsPending > 0` (funciona pero el esquema
no está al día); **503** con `error.details.reason='DATABASE_UNAVAILABLE'` si la BD no
responde. **Nunca 500.** Sonda: `curl -fsS localhost:3000/api/v1/health | jq '.data |
{status, uptimeSeconds, database}'` — como `ExecStartPre` del unit **[rec]**.

### 8.2 Qué revisar

| Señal | Dónde | Por qué |
|---|---|---|
| `degraded` + `migrationsPending > 0` | `/health` | Código nuevo sin migrar: el síntoma más común de un despliegue mal hecho |
| 503 sostenido | `/health` | Disco lleno, fichero borrado, permisos perdidos, `SQLITE_CANTOPEN`. Ver `journalctl -u lattecoffe-api` |
| `warn` "hay migraciones pendientes" | log de arranque | `server.ts` avisa en cada arranque si `countPending() > 0` |
| `uptimeSeconds` reiniciándose | `/health` | `Restart=on-failure` en bucle: el primer error está en `journalctl` |
| 503 en `/meta/roles` | respuesta | Falta `npm run seed`; sin matriz **nadie puede operar** |
| Volumen de 429 | `warn` con `limit`, `windowMs`, `path` | §8.4 |
| Tamaño de `.sqlite` y `-wal` | disco | `-wal` grande = checkpoint que no se completa; el backend hace `wal_checkpoint(TRUNCATE)` al cerrar **[impl]** |

### 8.3 Si la base se bloquea

`SQLITE_BUSY` significa "**otra** conexión tiene el lock de escritura". No es un bug:
es la serialización de SQLite funcionando **[impl]**. **Una sola conexión por proceso**:
`connection.ts` mantiene un singleton `getConnection()`, y abrir dos conexiones al mismo
fichero en WAL multiplica los conflictos; el `UnitOfWork` entrega esa misma instancia,
nunca una por petición. **`busy_timeout` (5000 ms)**: ante `SQLITE_BUSY` se espera en
lugar de fallar. **`BEGIN IMMEDIATE` en toda escritura**: toma el lock **al abrir**, no
en el primer `SELECT`, que es la defensa real contra dos cajeros reservando la misma
silla — con `BEGIN DEFERRED` (el default) ambas leerían el mismo snapshot, ambas
insertarían y la segunda fallaría en el `COMMIT` (`DESIGN.md` §8.2 lo tabula).
**`SQLITE_BUSY`/`SQLITE_LOCKED` → `409 CONFLICT_ERROR` con
`details.code='RESOURCE_BUSY'`**, nunca 500. Y un `await` dentro de una transacción es
un riesgo: `runInTransactionSync` es la opción recomendada y el código avisa si una
transacción asíncrona salta al event loop con el lock retenido.

**[rec]** Ante un `RESOURCE_BUSY` sostenido: **no reiniciar**, porque eso no elimina
un lock externo. `lsof /var/lib/lattecoffe/lattecoffe.sqlite*` para encontrar al
dueño: sospechar de un `sqlite3` CLI abierto, un script de backup mal escrito, un
`VACUUM INTO` colgado o una **segunda instancia** del backend sobre el mismo fichero
(un `npm run dev` olvidado). Si la contención es legítima entre instancias,
consolidar en una: SQLite con WAL no escala horizontalmente (§9). Subir
`DATABASE_BUSY_TIMEOUT_MS` a 15000 si el conflicto es transitorio y las transacciones
cortas; por encima, el usuario espera más de lo aceptable.

### 8.4 Interpretar un 429

**[impl]** `error.code='RATE_LIMIT_ERROR'`, HTTP 429, `error.details={code, limit,
windowMs, retryAfterSeconds, path}` y cabeceras `Retry-After` (segundos), `RateLimit-Limit`,
`RateLimit-Remaining`, `RateLimit-Reset`. Tres contadores independientes, todos por IP
normalizada con `ipKeyGenerator` (que agrupa el `/64` de una IPv6 para que no se evada
cambiando de subred):

| Limitador | Ventana | Máx/IP | Se aplica a |
|---|---|---|---|
| Global | `RATE_LIMIT_WINDOW_MS` = 60 s | `RATE_LIMIT_MAX` = 300 | Toda la API |
| Auth | `RATE_LIMIT_WINDOW_MS` = 60 s | `AUTH_RATE_LIMIT_MAX` = 20 | `/api/v1/auth/*` |
| Recuperación | `AUTH_PASSWORD_RATE_LIMIT_WINDOW_MS` = 3600 s | `AUTH_PASSWORD_RATE_LIMIT_MAX` = 3 | `forgot-password` y `reset-password` |

`windowMs: 60000` y `limit: 300` es el límite global: con varios terminales tras la
**misma** IP NAT, 300/min puede quedarse corto, y subirlo es legítimo en ese caso —
distinguirlo de un abuso es la clave. `limit: 20` en `/auth/*` es fuerza bruta o
reintentos en bucle: **no se sube**. `limit: 3` en recuperación de contraseña significa
que alguien enumera cuentas o usa el backend para martillear un correo: es el indicador
más grave de los tres, y hay que revisar `audit_logs`. El `Retry-After` de recuperación
es de **una hora**, no de un minuto, porque se lee de la ventana del limitador que
disparó y no de la global. En el cliente, `maxRetries = 2` y sólo para peticiones
idempotentes (`GET`), nunca `POST`: un reintento ciego de `POST /payments` puede cobrar
dos veces.

## 9. Escalado

**Escala bien [impl]:** lecturas concurrentes en WAL (los lectores no bloquean al
escritor), y trabajo de Node mientras SQLite no esté en medio de una transacción.
**No escala [impl]:** SQLite es un único fichero con un único escritor a nivel de
fichero — dos procesos sobre el mismo `.sqlite` funcionan, pero cada escritura se
serializa, así que añadir réplicas **empeora** la contención de locks (`DESIGN.md`
§8.1: la estrategia no es evitar la concurrencia sino serializar las secciones
críticas); y los **reportes** (`/reports`) agregan sobre `orders`, `order_items`,
`payments` y `audit_logs`, que crecen de forma monótona, y como son **síncronos** un
`SELECT` de segundos **para toda la API**.

**La caché de permisos [impl]:** no hay caché en el backend — `requirePermission` lee
`role_permissions` en cada petición protegida, y `GET /auth/me` devuelve la lista
completa de claves (`BR-RBAC-005`) para que el frontend no duplique la matriz;
`role_permissions` **sólo** se modifica por migración o endpoint administrativo
(`BR-RBAC-008`). De ahí tres consecuencias: un cambio de permiso surte efecto en la
siguiente petición sin invalidación; cambiar los roles de un usuario **revoca sus
refresh tokens** (`BR-RBAC-007`), así que hasta `JWT_ACCESS_TTL` (15 min) conserva
permisos que ya no tiene; y el frontend cachea permisos en `TokenStorage` y en memoria,
de modo que cerrar sesión en el navegador **no revoca nada en el servidor** — para cortar
el acceso hay que usar `POST /auth/logout-all`.

**Cuándo migrar a PostgreSQL [rec]:** latencia de `/reports` > 1 s medida con
`curl -w '%{time_total}'` en horario de apertura; `/health` reiniciándose por OOM;
`.sqlite` > 4–5 GB; más de un proceso backend necesitando escribir (más de una sede o
más de un servidor); necesidad de HA con dos réplicas arrancando a la vez, que SQLite
no permite; o `SQLITE_BUSY` que no se resuelve con `busy_timeout`. Hasta ninguno de
esos umbrales **SQLite es la elección correcta**: un local, dos o tres terminales,
decenas de miles de pedidos al año. El coste de operar PostgreSQL (un proceso más que
supervise, autenticación, PITR, RAM) no se justifica antes, y cuando llegue
`DESIGN.md` §10 deja el trabajo confinado al DDL, a `*.repository.sqlite.ts` →
`*.repository.postgres.ts` y a `connection.ts`.

## 10. Despliegue en desarrollo

```bash
cd backend && cp .env.example .env
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"  # -> DATABASE_JWT_SECRET
npm ci && npm run migrate    # esquema: 34 tablas + _migrations
npm run seed                 # RBAC + negocio + sede/zonas/sillas + demo
npm run dev                  # tsx watch src/server.ts -> http://localhost:3000
```

`SEED_DEMO_DATA` se lee **perezosamente de `process.env` al sembrar**, no por zod al
arrancar, así que se cambia entre ejecuciones sin que `config/env.ts` la rechace
**[impl]**. `npm run seed` siembra 6 roles, 83 permisos, la matriz, el negocio, la sede
+ 5 zonas + 25 sillas, 6 categorías, 24 productos, 5 cupones, empleados, clientes,
reservas, alquileres y 18 pedidos, con códigos de demo fijos desde 900000
(`ORD-900001`, `RES-900001`, `RENT-900001`, `PAY-900001`).
`SEED_DEMO_DATA=false npm run seed` deja **sólo la estructura**: roles, permisos, matriz,
negocio, sede/zonas/sillas y las cuatro cuentas de sistema. Ambas son **idempotentes** y
**no destructivas**: si la cuenta ya existe no se toca, así que cambiar
`SEED_SYSTEM_ACCOUNTS_PASSWORD` y reejecutar `seed` **no** cambia la contraseña de una
cuenta existente — hay que cambiarla en la cuenta (`POST /api/v1/auth/change-password`).
Entrecomillar siempre las contraseñas con `#`: sin comillas `dotenv` corta ahí.

**Reiniciar la base.** Parar el servidor **primero**: copiar el fichero con el proceso
escribiendo es exactamente el error que §5 explica.

```bash
pkill -f 'tsx watch src/server.ts' || pkill -f 'node dist/server.js'
cd backend
mkdir -p /tmp/dbsnap && sqlite3 data/lattecoffe.sqlite ".backup '/tmp/dbsnap/$(date +%s).sqlite'"
# Los TRES ficheros van juntos: borrar sólo el .sqlite y dejar -wal/-shm produce un
# estado inconsistente.
rm -f data/lattecoffe.sqlite data/lattecoffe.sqlite-wal data/lattecoffe.sqlite-shm
npm run migrate && npm run seed && npm run dev
```

Verificación de una instalación nueva: `npm run typecheck && npm test`;
`npm run migrate:status` con 0 pendientes y 0 `ALTERADAS`;
`curl -fsS localhost:3000/api/v1/health | jq`; y un `POST /api/v1/auth/login` con
`cajero@lattecoffe.co` / `LatteCofee#2026` devolviendo 200.

## Anexo. Comandos citados, verificados en `backend/package.json`

`npm run dev` = `tsx watch src/server.ts`; `npm run build` = `tsc -p tsconfig.build.json`;
`npm start` = `node dist/server.js`; `npm run typecheck` = `tsc --noEmit`;
`npm run lint` = `tsc --noEmit --pretty`; `npm test` = `vitest run`;
`npm run test:watch` = `vitest`; y `npm run migrate` / `migrate:status` /
`migrate:rollback` / `seed` = `tsx src/database/cli.ts up|status|rollback|seed`.
Ningún comando acepta subcomandos adicionales: `cli.ts` lee `process.argv[2]` y sólo
reconoce `up`, `status`, `rollback` y `seed`.

Los cuatro scripts `:prod` que usa la imagen de Docker **no** pasan por `tsx`:
`migrate:prod` = `node dist/database/cli.js up`, `migrate:status:prod` =
`node dist/database/cli.js status`, `migrate:rollback:prod` =
`node dist/database/cli.js rollback` y `seed:prod` = `node dist/database/cli.js seed`.
Exigen `npm run build` antes, porque ejecutan el JavaScript compilado. Son los que
permiten que la imagen final no lleve ninguna `devDependency` (§3.0, trampa 1).
