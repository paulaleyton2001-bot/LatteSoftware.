# LatteCoffe POS — Backend

Fundación del backend de un POS para cafetería con alquiler de sillas.
Node.js + Express 5 + better-sqlite3 + TypeScript estricto.

El contrato normativo es [`../docs/DESIGN.md`](../docs/DESIGN.md) y
[`../docs/API.md`](../docs/API.md). Este código los implementa literalmente:
mismos nombres de tabla, mismas columnas, mismos códigos de error y el mismo
envoltorio de respuesta.

---

## 1. Requisitos

| Herramienta | Versión verificada |
|---|---|
| Node.js | v26.10.0 (mínimo 20.11) |
| npm | 12.1.0 |
| better-sqlite3 | 13.0.3 (binario precompilado, sin `node-gyp`) |

## 2. Instalación

```bash
cd backend
npm install
cp .env.example .env      # y ajusta DATABASE_JWT_SECRET
npm run migrate           # crea el esquema (34 tablas)
npm run seed              # siembra roles, permisos, matriz RBAC y cuentas de sistema
npm run dev               # http://localhost:3000
```

Sin `npm run seed` la API arranca, pero `GET /api/v1/meta/roles` responde **503**
y ningún endpoint protegido deja pasar a nadie: `requirePermission` lee
`role_permissions`, que estaría vacía.

`.env` está en `.gitignore`. **Nunca** subas secretos al repositorio.

Para generar un secreto JWT válido:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

## 3. Variables de entorno

Todas obligatorias salvo indicación. Se validan con zod al arrancar
(`src/config/env.ts`): si falta una o el secreto es débil en
`APP_ENV=production`, el proceso aborta antes de abrir la base de datos.

| Variable | Default | Notas |
|---|---|---|
| `NODE_ENV` | `development` | `development` \| `test` \| `staging` \| `production` |
| `APP_ENV` | = `NODE_ENV` | Entorno de la aplicación. `production` activa mensajes genéricos sin stack. |
| `PORT` | `3000` | |
| `HOST` | `0.0.0.0` | |
| `APP_NAME` | `LatteCoffe API` | |
| `APP_VERSION` | `1.0.0` | Semver estricto. Se publica en `/health` y `/meta/*`. |
| `DATABASE_PATH` | `./data/lattecoffe.sqlite` | Relativa a `backend/`. `:memory:` para tests. |
| `DATABASE_BUSY_TIMEOUT_MS` | `5000` | Espera ante `SQLITE_BUSY` antes de fallar. |
| `DATABASE_JWT_SECRET` | — | **Obligatoria, mínimo 32 caracteres.** En producción se rechazan valores débiles. |
| `JWT_ACCESS_TTL` | `15m` | `900`, `15m`, `1h`, `1d`. |
| `JWT_REFRESH_TTL_DAYS` | `30` | |
| `BCRYPT_COST_ROUNDS` | `12` | 10–15. |
| `PASSWORD_RESET_TOKEN_TTL_MINUTES` | `30` | Vigencia del token de reseteo (DESIGN.md 4.1). |
| `RESET_PASSWORD_LINK_BASE_URL` | `http://localhost:5173/reset-password` | **Sólo desarrollo**: base del enlace que se registra en el log al pedir un reseteo. |
| `CORS_ORIGINS` | `http://localhost:3000` | Lista separada por comas. `*` sólo en desarrollo. |
| `LOG_LEVEL` | `info` | `fatal`…`trace`, `silent`. |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Ventana del límite global. |
| `RATE_LIMIT_MAX` | `300` | Peticiones por ventana, global. |
| `AUTH_RATE_LIMIT_MAX` | `20` | Límite más estricto de `/api/v1/auth/*` (fuerza bruta). |
| `AUTH_PASSWORD_RATE_LIMIT_WINDOW_MS` | `3600000` | Ventana del límite reforzado de recuperación de contraseña. |
| `AUTH_PASSWORD_RATE_LIMIT_MAX` | `3` | Límite reforzado de `forgot-password` y `reset-password`. Es un contador **separado** del de `/auth/*` y los dos endpoints lo comparten. |
| `PAYMENT_PROVIDER` | `MOCK` | `MOCK` no conecta a nada. |
| `PAYMENT_SECRET` | vacío | Obligatoria en producción si el proveedor no es `MOCK`. |
| `DEFAULT_CURRENCY` | `COP` | Fallback de `/meta/enums` mientras `businesses` no esté sembrada. |
| `DEFAULT_TIMEZONE` | `America/Bogota` | Idem para la zona horaria. |
| `SEED_ON_MIGRATE` | `false` | Si es `true`, `npm start` aplica migraciones y semilla. **Por defecto el arranque NO toca el esquema.** |
| `SEED_SYSTEM_ACCOUNTS` | `true` (desarrollo) | Crea `owner@`, `admin@`, `manager@` y `cajero@lattecoffe.co`. **Forzado a `false` en `APP_ENV=production`**: si se pone a `true` allí, el arranque aborta. |
| `SEED_SYSTEM_ACCOUNTS_PASSWORD` | `LatteCofee#2026` | Contraseña de esas cuentas. **Sólo desarrollo y pública**: cámbiela antes de abrir el local. La semilla **no** la restaura si la cuenta ya existe. |
| `SEED_DEMO_DATA` | `true` (desarrollo) | Siembra los datos de demostración (sede, 5 zonas, 25 sillas, catálogo, cupones, 18 pedidos…). `false` deja sólo la estructura. **Se ignora siempre en `APP_ENV=production`**, aunque valga `true`. |
| `SEED_DEMO_PASSWORD` | = `SEED_SYSTEM_ACCOUNTS_PASSWORD` | Contraseña de los empleados y clientes de demostración. Si se deja vacía y `SEED_SYSTEM_ACCOUNTS_PASSWORD` también, no se crean esos usuarios y la semilla lo avisa por log. |

`SEED_DEMO_DATA` y `SEED_DEMO_PASSWORD` se leen de `process.env` en el momento de
sembrar, no al arrancar: por eso se pueden cambiar entre ejecuciones sin tocar
`config/env.ts` (que valida el resto del entorno al importarse).

## 4. Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | `tsx watch src/server.ts`, recarga al guardar. |
| `npm run build` | `tsc -p tsconfig.build.json` → `dist/`. |
| `npm start` | `node dist/server.js` (requiere `build`). |
| `npm run typecheck` | `tsc --noEmit`. Debe dar 0 errores. |
| `npm run lint` | `tsc --noEmit --pretty` (mismo chequeo, salida formateada). |
| `npm run migrate` | Aplica las migraciones pendientes. Idempotente. |
| `npm run migrate:status` | Lista aplicadas/pendientes/alteradas con su checksum. |
| `npm run migrate:rollback` | Revierte la última aplicada usando su `.down.sql`. |
| `npm run seed` | Semilla de arranque: 6 roles, 83 permisos, matriz de RBAC, negocio singleton, cuentas de sistema y (fuera de producción) los datos de demostración. Idempotente. |
| `npm test` | `vitest run`. |

## 5. Endpoints disponibles

### Públicos (no requieren token)

| Método | Ruta | Respuesta |
|---|---|---|
| `GET` | `/api/v1/health` | `status`, `version`, `uptimeSeconds`, `database`, `checks`. 503 si la BD no responde. |
| `GET` | `/api/v1/meta/enums` | Enums, transiciones válidas, transiciones prohibidas y formatos. |
| `GET` | `/api/v1/meta/roles` | 6 roles, 83 permisos y la matriz leídos de `role_permissions`. 503 si RBAC no está sembrado. |
| `POST` | `/api/v1/auth/register` | Alta de cliente (201) con `user`, `accessToken`, `refreshToken`, `tokenType`, `expiresIn`, `sessionId`. |
| `POST` | `/api/v1/auth/login` | Autenticación (200). Mismo mensaje y código para email inexistente y contraseña incorrecta. |
| `POST` | `/api/v1/auth/refresh` | Rota el refresh token (200). Un token ya revocado revoca **toda** la familia y devuelve 401. |
| `POST` | `/api/v1/auth/forgot-password` | Siempre 200, exista o no la cuenta. Límite reforzado de 3/hora. |
| `POST` | `/api/v1/auth/reset-password` | Aplica el enlace de reseteo (200) y revoca todas las sesiones. Límite reforzado de 3/hora. |

### Autenticados (`Authorization: Bearer <accessToken>`)

| Método | Ruta | Permiso | Notas |
|---|---|---|---|
| `GET` | `/api/v1/auth/me` | autenticado | Perfil con `roles[]` y `permissions[]` resueltos. |
| `PATCH` | `/api/v1/auth/me` | `auth:profile:update` | Sólo `fullName`, `phone`, `photoUrl`. |
| `POST` | `/api/v1/auth/logout` | autenticado | Revoca la sesión actual. Idempotente. |
| `POST` | `/api/v1/auth/logout-all` | autenticado | Revoca todas las sesiones. `currentPassword` opcional. |
| `POST` | `/api/v1/auth/change-password` | autenticado | Exige la actual. Revoca el resto y rota la del propio dispositivo. |
| `GET` | `/api/v1/auth/sessions` | autenticado | Sesiones activas; marca `isCurrent`. |
| `DELETE` | `/api/v1/auth/sessions/:id` | autenticado | Revoca una sesión propia. La actual no: para eso `/logout`. |

### Usuarios (todos exigen permiso `users:*`)

| Método | Ruta | Permiso |
|---|---|---|
| `GET` | `/api/v1/users` | `users:read` |
| `POST` | `/api/v1/users` | `users:create` |
| `GET` | `/api/v1/users/:id` | `users:read` |
| `PATCH` | `/api/v1/users/:id` | `users:update` |
| `DELETE` | `/api/v1/users/:id` | `users:delete` (soft delete) |
| `POST` | `/api/v1/users/:id/roles` | `users:roles:assign` |
| `DELETE` | `/api/v1/users/:id/roles/:roleId` | `users:roles:assign` |
| `PATCH` | `/api/v1/users/:id/status` | `users:status:update` |
| `POST` | `/api/v1/users/:id/reset-password` | `users:password:reset` |

### Clientes

| Método | Ruta | Permiso | Notas |
|---|---|---|---|
| `GET` | `/api/v1/customers` | `customers:read` | Sólo roles de operador. |
| `GET` | `/api/v1/customers/me` | autenticado | Ficha del cliente autenticado, con estadísticas. |
| `GET` | `/api/v1/customers/:id` | `customers:read` | 404 si es otro cliente. |
| `PATCH` | `/api/v1/customers/:id` | `customers:update` | Propio u operador. El cliente no cambia su email. |

**Pendientes y NO registrados** (dependen de módulos que aún no existen):
`GET /customers/:id/orders`, `/:id/reservations`, `/:id/rentals` y
`/:id/payments`. Registrarlas ahora devolvería 500. El motivo está documentado en
`src/modules/customers/customers.routes.ts`.

`/meta/enums` y `/meta/roles` existen para que el frontend **no duplique** la
matriz de estados ni la de permisos: los recibe del servidor, que es la misma
fuente que valida los services y el middleware `authorize`.

## 5.1 Cuentas de sistema de desarrollo

`npm run seed` crea estas cuatro cuentas con la contraseña de
`SEED_SYSTEM_ACCOUNTS_PASSWORD` (`LatteCofee#2026` por defecto):

> ⚠️ **La contraseña por defecto es de DESARROLLO y está escrita en este README y
> en `.env.example`.** Es pública: cualquiera que lea el repositorio puede entrar
> como administrador. Antes de abrir el local, cámbiela en las cuatro cuentas
> (`POST /api/v1/auth/change-password` o el panel de usuarios) **y** ponga una
> distinta en `SEED_SYSTEM_ACCOUNTS_PASSWORD`. La semilla no es destructiva, así
> que cambiar la variable y reejecutar `npm run seed` NO cambia la contraseña de
> una cuenta que ya existe: hay que cambiarla en la cuenta. En
> `APP_ENV=production` la semilla se desactiva siempre, y poner
> `SEED_SYSTEM_ACCOUNTS=true` hace abortar el arranque a propósito.

| Email | Rol | Puede |
|---|---|---|
| `owner@lattecoffe.co` | `OWNER` | Todo, incluida la matriz de permisos. |
| `admin@lattecoffe.co` | `ADMIN` | Usuarios, roles, configuración, auditoría. |
| `manager@lattecoffe.co` | `MANAGER` | Catálogo, inventario, descuentos, zonas, sillas, reportes. |
| `cajero@lattecoffe.co` | `CASHIER` | Sala, reservas y cobro. |

`npm run seed` siembra además, fuera de producción, los DATOS DE DEMOSTRACIÓN que
hacen la API navegable sin escribir nada a mano: 1 sede, 5 zonas, 25 sillas, 6
categorías, 24 productos, 5 cupones, 6 usuarios (2 empleados y 4 clientes), 4
reservas, 3 alquileres y 18 pedidos con su historial y sus cobros. Se apagan con
`SEED_DEMO_DATA=false`, y su contraseña es `SEED_DEMO_PASSWORD` (si no se pone,
se reutiliza la de las cuentas de sistema).

La semilla es **idempotente y no destructiva**: si la cuenta ya existe no la
toca, así que cambiar su contraseña y reejecutar `npm run seed` no la restaura.
En `APP_ENV=production` la semilla se desactiva siempre.

## 5.2 Módulos montados y sus prefijos

Estos son los **20 prefijos** que `src/modules/index.ts` monta bajo
`/api/v1`. Es la lista completa: si un prefijo no está aquí, su router devuelve
404 aunque el módulo exista en `src/modules/`.

| Prefijo | Router | Qué publica |
|---|---|---|
| `/` | `system` | `GET /health`, `GET /meta/enums`, `GET /meta/roles`. |
| `/auth` | `auth` | Login, refresh, registro, perfil, sesiones y contraseñas. |
| `/users` | `users` | Altas, roles y estado del personal. |
| `/customers` | `customers` | Ficha de cliente y sus estadísticas. |
| `/business` | `business` | Negocio singleton, horario, estado abierto/cerrado, festivos. |
| `/locations` | `locations` | Sedes del negocio. |
| `/zones` | `spaces` | Zonas de una sede (una silla vive dentro de una zona). |
| `/chairs` | `spaces` | Mapa de sillas, disponibilidad, estado, historial. |
| `/reservations` | `reservations` | Reservas: crear, confirmar, check-in, extender, completar. |
| `/rentals` | `rentals` | Alquileres de silla: abiertos, extender, cerrar. |
| `/categories` | `catalog` | Categorías del catálogo. |
| `/products` | `catalog` | Productos, variantes, complementos e ingredientes. |
| `/menu` | `catalog` | Proyección **pública** de lectura del menú, sin credencial. |
| `/inventory` | `inventory` | Existencias, movimientos y alertas de stock. |
| `/orders` | `orders` | Pedidos: alta, líneas, estados, recibo e historial. |
| `/payments` | `payments` | Cobros y reembolsos. |
| `/discounts` | `discounts` | Cupones y validación de descuentos. |
| `/notifications` | `notifications` | Notificaciones del usuario y preferencias. |
| `/reports` | `reports` | Dashboard, ventas, top de productos, ocupación y export CSV. |
| `/system/jobs` | `reservations` | `POST /system/jobs/expire-reservations` (tareas programadas). |

Dos módulos aportan más de un prefijo porque el contrato los publica así
(`spaces` → `zones` + `chairs`; `catalog` → `categories` + `products` + `menu`).
`/system/jobs` se monta **al final** a propósito: comparte el prefijo `/system`
con `system`, que ya está montado en `/`. El log de arranque lista los 20
prefijos en `routes`, así que basta con mirar la primera línea al levantar el
servidor para saber qué está montado.

**Alta de pagos.** El sistema no tiene pasarela: se cobra en el mostrador, en
efectivo o con datáfono. El cobro con datáfono se registra con
`method = 'CARD'` y la aprobación del aparato en `providerReference`
(`BR-SEC-006`; nunca el número de la tarjeta). El valor `CARD_TERMINAL` existe
en `payments.provider` desde la migración `0003_card_terminal_provider.sql` y se
publica en `GET /meta/enums`.

## 6. Estructura

```
backend/
├── src/
│   ├── config/
│   │   ├── env.ts            # zod sobre process.env; aborta si falta algo
│   │   ├── constants.ts      # PAGINATION, AUTH, PASSWORD, IDENTITY, AUDIT, MONEY...
│   │   ├── container.ts      # grafo de dependencias (inyección por constructor)
│   │   └── index.ts
│   ├── shared/
│   │   ├── errors/           # AppError + 11 subclases, códigos, isAppError
│   │   ├── http/             # sendSuccess/sendError, paginación, asyncHandler
│   │   ├── logger/           # pino con `redact` de secretos
│   │   ├── utils/            # money, datetime, codes, random, jwt
│   │   ├── database/         # connection, unit-of-work, migrator, health, queries,
│   │   │                     # audit.repository(+sqlite), constraint-errors
│   │   ├── middleware/       # request-context, validate, authenticate, authorize,
│   │   │                     # error-handler, not-found, rate-limit, security
│   │   ├── services/         # audit.service (transversal, lo usan TODOS los módulos)
│   │   ├── validation/       # campos zod reutilizables (email, phone, photoUrl...)
│   │   └── domain/           # enums, permisos (PERMISSION) y máquinas de estado
│   ├── modules/
│   │   ├── index.ts          # PUNTO DE EXTENSIÓN: MODULE_ROUTERS
│   │   ├── system/           # /health, /meta/enums, /meta/roles
│   │   ├── auth/             # register, login, refresh, sesiones, contraseñas
│   │   ├── users/            # directorio de usuarios y RBAC administrativo
│   │   └── customers/        # directorio de clientes (rol CUSTOMER)
│   ├── database/
│   │   ├── cli.ts            # up | status | rollback | seed
│   │   ├── migrations/       # 0001_init.sql + 0001_init.down.sql
│   │   └── seeds/            # index.ts + roles-permissions + development-accounts
│   ├── app.ts                # createApp(): Express SIN listen (testeable)
│   └── server.ts             # listen + apagado ordenado
├── tests/                    # integración HTTP (base en memoria + migraciones)
│   ├── helpers/
│   │   ├── test-env.ts       # process.env de tests; SIEMPRE el primer import
│   │   └── harness.ts        # createTestContext(): app + base + login + factories
│   ├── auth.spec.ts
│   ├── rbac.spec.ts
│   └── validation.spec.ts
└── data/                     # SQLite (generado, gitignored)
```

### Estructura de un módulo

Cada módulo de negocio sigue la misma división por responsabilidad, que es la
que exige DESIGN.md 3.2:

```
modules/<nombre>/
├── <nombre>.routes.ts        # delgado: método, path, middleware, handler
├── <nombre>.controller.ts    # HTTP ⇄ service; sin decisiones de negocio
├── <nombre>.service.ts       # casos de uso, transacciones, reglas
├── <nombre>.repository.ts    # INTERFAZ de persistencia (contrato, sin SQL)
├── <nombre>.repository.sqlite.ts  # ÚNICO fichero con SQL del módulo
├── <nombre>.schemas.ts       # esquemas zod de body/query/params
└── <nombre>.types.ts         # DTOs de dominio (sin express, sin zod, sin driver)
```

### Reglas de capa

1. **Sólo la capa de persistencia escribe SQL**: `shared/database/` y
   `shared/utils/codes.ts` (excepción explícita: es el generador de códigos de
   negocio). Ni los services ni los controllers hacen SQL.
2. **El mapeo `snake_case` (BD) → `camelCase` (API)** ocurre en los
   repositorios/mappers, nunca en el controller.
3. **Nada de lógica de negocio en el middleware**: los middlewares autentican,
   autorizan y traducen errores.
4. **Los errores de dominio son `AppError`**, nunca `throw new Error(...)` con
   texto suelto.

## 7. Unidad de trabajo y transacciones

```ts
import { runInTransaction, runInTransactionSync } from '../shared/database/index.js';

// Síncrono (recomendado): sin salto al event loop.
const pedido = runInTransactionSync((tx) => {
  const siguiente = generateOrderNumber(tx, negocio.orderPrefix);
  tx.prepare('INSERT INTO orders (...) VALUES (...)').run(/* ... */);
  return siguiente;
});

// Asíncrono: la firma admite promesa, pero NO hagas await dentro.
const resultado = await runInTransaction(async (tx) => {
  return hacerCosa(tx);
});
```

- `BEGIN IMMEDIATE` toma el lock de escritura **al abrir**, que es la defensa
  real contra el caso de dos cajeros reservando la misma silla.
- Las llamadas anidadas se aíslan con `SAVEPOINT`; sólo la más externa hace
  `COMMIT`/`ROLLBACK`.
- `better-sqlite3` es síncrono: usa `runInTransactionSync` siempre que puedas.
  Un `await` dentro de la transacción retiene el lock mientras el control pasa
  al event loop, y otra petición puede entrar en la misma conexión. La función
  asíncrona lo detecta y registra un aviso.
- Las transacciones anidadas se detectan con `AsyncLocalStorage`, así que dos
  peticiones simultáneas nunca se cuelan en la misma transacción.
- `SQLITE_BUSY` se traduce a `409 CONFLICT_ERROR` con
  `details.code = 'RESOURCE_BUSY'`, nunca a un 500.

## 8. Cómo añadir una migración

1. Crear `src/database/migrations/000N_<nombre>.sql` (orden lexicográfico).
2. **Prohibido** `BEGIN` / `COMMIT` / `ROLLBACK` / `SAVEPOINT` / `RELEASE`: el
   runner controla la transacción. Los `PRAGMA` sí están permitidos. El runner
   analiza el fichero (sin comentarios ni literales) y aborta si detecta uno.
3. Cada migración se aplica dentro de su propia transacción: o entra entera, o
   no entra nada.
4. Crear `000N_<nombre>.down.sql` con la reversión (el `rollback` la necesita
   para poder volver a aplicar `up`).
5. `npm run migrate` y comprobar con `npm run migrate:status`.

El historial es inmutable: si editas un `.sql` ya aplicado, el checksum SHA-256
deja de coincidir y `migrate` **aborta** con un error explícito. La corrección
es una migración nueva, nunca reescribir la anterior.

Ejemplo mínimo:

```sql
-- 0002_add_chair_notes.sql
ALTER TABLE chairs ADD COLUMN cleaning_notes TEXT;
```

```sql
-- 0002_add_chair_notes.down.sql
-- SQLite 3.35+ soporta DROP COLUMN; si no, tabla nueva + copia + rename.
ALTER TABLE chairs DROP COLUMN cleaning_notes;
```

## 9. Cómo añadir un módulo nuevo

Checklist:

1. `src/modules/<nombre>/<nombre>.routes.ts` con un `Router`.
2. Handlers tipados con `asyncHandler`; responder SIEMPRE con
   `sendSuccess` / `sendCreated` / `sendPaginated` / `sendNoContent`, nunca con
   `res.json()` a pelo.
3. **Validación** con `validate({ body, query, params })`. Todos los esquemas
   deben ser `.strict()`: los campos desconocidos se rechazan con 400.
   Para listados usa `buildListQuerySchema({ ...campos })`, que ya incluye
   `page`, `pageSize`, `sort` y `order`.
4. **Autorización**: `authenticate`, luego
   `requirePermission(PERMISSION.MODULO_ACCION)` y/o `requireRoles(Role.MANAGER,
   Role.ADMIN)`. Las claves salen de `shared/domain/permissions.ts`; si el módulo
   necesita un permiso nuevo, se declara ahí, se añade su fila en la semilla y su
   marca en la matriz. Montar en `/auth` añade automáticamente el límite de tasa
   estricto.
5. **Orden estable** en todo listado: `parseSort` ya añade el desempate por
   `id`. `sort` se valida contra la allowlist del endpoint y nunca se
   interpola sin validar.
6. Registrar el router en `MODULE_ROUTERS` (`src/modules/index.ts`).
   **No tocar `app.ts`.**
7. Si necesita tablas nuevas: migración `000N_*.sql` + `.down.sql`.
8. `businessId` **nunca** se acepta en body ni query: sale del access token
   (`validate` rechaza el campo si aparece).

El orden de la cadena de middlewares es siempre
`authenticate -> requirePermission -> validate -> handler`: primero identidad,
luego autorización y sólo después la forma de la petición. Así un `CUSTOMER`
recibe 403 y no 400 por un campo mal formado.

Esqueleto (los handlers delegan en el service; el service, en el repositorio):

```ts
// src/modules/chairs/chairs.routes.ts
import { Router } from 'express';

import { PERMISSION, ChairStatus } from '../../shared/domain/index.js';
import { asyncHandler, buildListQuerySchema } from '../../shared/http/index.js';
import { authenticate, requirePermission, validate } from '../../shared/middleware/index.js';
import { getContainer } from '../../config/container.js';
import { z } from 'zod';

import { ChairsController } from './chairs.controller.js';
import { listChairsQuerySchema, chairIdParamsSchema } from './chairs.schemas.js';

const controller = new ChairsController(getContainer().chairs);

export const chairsRouter = Router();

chairsRouter.get(
  '/',
  authenticate,
  requirePermission(PERMISSION.CHAIRS_READ),
  validate({
    query: listChairsQuerySchema,
    // `parseSort` valida `sort` contra la allowlist y añade el desempate por
    // `id`; `order` sale del esquema del endpoint.
    sortable: { allowedColumns: ['code', 'status'], defaultColumn: 'code', defaultOrder: 'asc' },
  }),
  controller.list,
);

chairsRouter.get(
  '/:id',
  authenticate,
  requirePermission(PERMISSION.CHAIRS_READ),
  validate({ params: chairIdParamsSchema }),
  asyncHandler(controller.getById),
);
```

```ts
// src/modules/index.ts
export const MODULE_ROUTERS: readonly ModuleRegistration[] = Object.freeze([
  { name: 'system', path: '/', router: systemRouter },
  { name: 'chairs', path: '/chairs', router: chairsRouter },
]);
```

Y para la autorización, en el service, no en la ruta: `P` (parcial) significa
que el permiso existe pero el alcance lo resuelve el service.

```ts
// Un CUSTOMER pide /chairs/:id de otra persona: 404, no 403 (API.md 2).
if (actor.roles.includes(Role.CUSTOMER) && chair.id !== actor.id) {
  throw new NotFoundError('La silla no existe', { details: { id: chair.id, type: 'chair' } });
}
```

## 10. Formato de respuestas

Éxito (API.md 3.1):

```json
{ "success": true, "data": {}, "meta": { "requestId": "uuid", "page": 1, "pageSize": 20, "total": 137 } }
```

Error (API.md 3.2):

```json
{
  "success": false,
  "error": { "code": "VALIDATION_ERROR", "message": "La solicitud contiene campos inválidos",
             "details": [{ "path": "items[0].quantity", "message": "Debe ser mayor que 0", "code": "TOO_SMALL" }] },
  "requestId": "uuid"
}
```

- `meta.requestId` va siempre en el éxito; `requestId` va **fuera** de `error`
  en el fallo.
- El stack trace nunca se serializa. En `APP_ENV=production` los errores no
  operativos devuelven un mensaje genérico.
- Todo `5xx` no previsto se registra con su stack en el log del servidor.

## 11. Autenticación

`Authorization: Bearer <accessToken>`, JWT HS256. `src/shared/utils/jwt.ts`
implementa firma y verificación sobre `node:crypto` (HS256 es HMAC-SHA256: no
hace falta una dependencia externa). Rechaza `alg: none` y cualquier otro
algoritmo, valida `exp`/`nbf`/`iat` con tolerancia 0 y distingue
`typ: access` de `typ: refresh` (`details.code = 'WRONG_TOKEN_TYPE'`).

El token de refresh es un valor opaco: en la base de datos sólo se guarda su
SHA-256 (`refresh_tokens.token_hash`). Para emitirlo, `randomToken(32)` y
`sha256Hex()` de `shared/utils/random.ts`.

## 12. Notas de operación

- **WAL**: el esquema se crea con `journal_mode = WAL`, `foreign_keys = ON`,
  `busy_timeout` y `synchronous = NORMAL`. Una sola conexión por proceso.
- **Apagado ordenado**: `SIGTERM`/`SIGINT` dejan de aceptar conexiones, drenan
  y cierran la base. Hay 10 s de margen antes del cierre forzado.
- **Migraciones en despliegue**: comando explícito. `SEED_ON_MIGRATE=true` sólo
  para entornos efímeros de desarrollo.
- **Verificar el historial**: `npm run migrate:status` marca `ALTERADA` una
  migración aplicada cuyo fichero cambió.
- **RBAC sembrado, no calculado**: la matriz de `role_permissions` es la
  transcripción literal de DESIGN.md 9.3 y sólo cambia con una semilla o una
  migración (BR-RBAC-008). `npm run seed` la verifica contra el documento antes de
  escribir y aborta si no cuadra.

## 13. Desviaciones del contrato, y por qué

| # | Desviación | Motivo |
|---|---|---|
| 1 | **83 permisos, no 84.** | DESIGN.md 9.3 dice "Total: 84 permisos" en la prosa, pero §9.2 lista 83 claves y §9.3 tiene 83 filas (las mismas 83). Se siembran las 83 que el documento define; inventar una para llegar a 84 sería publicar en `/meta/roles` un permiso que ninguna ruta usa. La comprobación cruzada entre la matriz y `shared/domain/permissions.ts` aborta la semilla si divergen. |
| 2 | **No existe tabla `customers`.** | DESIGN.md 4.7 fija 34 tablas y ninguna es de clientes; API.md 7.3 dice que un cliente es un `users` con rol `CUSTOMER`. El registro se "crea en la misma transacción" asignando ese rol: es la única fila adicional que un cliente necesita. |
| 3 | **El negocio singleton lo siembra `npm run seed`, no la migración.** | `0001_init.sql` no contiene ningún `INSERT` y `audit_logs.business_id` es `NOT NULL` con FK a `businesses(id)`: sin la fila `id = 1` la auditoría de cualquier login fallaría. |
| 4 | **Contraseñas: 3 de 4 clases** en vez de "una letra y un número". | Es MÁS estricto que DESIGN.md 11.1 y API.md 7.1. Se eligió así porque una contraseña de dos clases es predecible; el contrato sigue siendo un subconjunto de lo aceptado, pero un cliente que pruebe `abc123` recibirá 400. |
| 5 | **Límite reforzado de recuperación de contraseña: 3/hora**, no 5/hora y 10/hora. | Lo exige el encargo de esta fase. Es más estricto que DESIGN.md 11.3 y va en un contador separado, compartido por `forgot-password` y `reset-password`. |
| 6 | **`POST /users/:id/reset-password` devuelve `meta.resetToken`, no `temporaryPassword`.** | API.md 7.2 ofrece la temporal; el encargo prohíbe devolver contraseñas. Se genera una contraseña aleatoria que nadie conoce y se entrega un token de un solo uso para que el usuario elija la suya. `POST /users` (alta sin contraseña) sí devuelve `meta.temporaryPassword` porque ahí lo manda el contrato. |
| 7 | **`change-password` devuelve tokens nuevos** (en `data`) cuando `keepCurrentSession` es `true`. | API.md 7.2 dice `data: null`, pero la sesión actual se revoca al cambiar la contraseña (BR-SEC-003): sin tokens nuevos el usuario se quedaría fuera del dispositivo desde el que la cambió. Con `keepCurrentSession: false` sí devuelve `data: null`. |
| 8 | **`GET /auth/sessions` sólo admite `sort=createdAt`.** | API.md 7.1 menciona también `lastUsedAt`, pero `refresh_tokens` no tiene esa columna y el esquema está congelado. Ordenar por ella da `400 INVALID_SORT_FIELD`. |
| 9 | **`PATCH /auth/me` no acepta `password`.** | API.md 7.1 lo menciona ahí, pero el cambio de contraseña tiene su propio endpoint que exige la actual. Aceptarlo duplicaría una regla sensible en dos sitios. |
| 10 | **Un `ADMIN` no puede borrar a otro `ADMIN`** (403 `ADMIN_ROLE_PROTECTED`). | No está en el documento. Sin la regla, un `ADMIN` con `users:delete` puede dejar el despliegue sin nadie capaz de administrar usuarios. Sólo un `OWNER` puede. El último `OWNER` sigue protegido por BR-RBAC-003 en todos los caminos. |
| 11 | **`PATCH /customers/:id` devuelve 422** cuando un cliente intenta cambiar su propio email. | API.md 7.2 enumera 400/401/403/404/409 para ese endpoint; un 422 `EMAIL_CHANGE_REQUIRES_VERIFICATION` es la forma correcta de expresar una regla de negocio que el documento no codifica. |
| 12 | **`buildListQuerySchema` es genérico** y `parsePagination` sólo mira las cuatro claves de paginación. | Arreglo de la base: con la firma anterior, `z.infer` del esquema perdía los campos propios del endpoint y cualquier listado con filtros devolvía 400 "Unrecognized key". |
| 13 | **JSON malformado responde 400**, no 500. | `error-handler` traduce los errores de `express.json()` a `400 VALIDATION_ERROR` (API.md 4). Antes llegaban como 500, culpando al servidor de un error del cliente. |
