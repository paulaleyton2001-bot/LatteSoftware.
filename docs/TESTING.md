# Testing

Cómo se ejecuta la suite, qué cubre, qué no cubre y cómo añadir tests. Los
números son **reales**, de `npm test` en `backend/` (vitest 5.0.2).

---

## 1. Comandos y configuración

```bash
cd backend
npm test              # vitest run
npm run test:watch    # vitest en watch
npm run typecheck     # tsc --noEmit
npm run lint          # alias de typecheck formateado
npm run build         # tsc -p tsconfig.build.json
```

Última ejecución completa:

```
Test Files  21 passed (21)
     Tests  626 passed (626)
  Duration  28.45s
```

[`vitest.config.ts`](../backend/vitest.config.ts): `include` cubre las dos
familias (unitarios en `src/`, integración HTTP en `tests/`), `testTimeout` de
30 s (la primera prueba de un fichero paga las 34 tablas, sus índices, sus
triggers, la semilla y varios hash bcrypt), `hookTimeout` de 60 s, `isolate:
true` —cada fichero en su propio contexto de módulos y por tanto en su propio
proceso, que es lo que permite 21 bases en memoria simultáneas— y
`passWithNoTests: true`.

[`tests/helpers/test-env.ts`](../backend/tests/helpers/test-env.ts) fija el
entorno **antes** de que se importe nada de `src/`, porque `config/env.ts`
valida `process.env` en el momento del import y `dotenv` sólo rellena variables
a `undefined`.

| Variable | Tests | Producción |
|---|---|---|
| `DATABASE_PATH` | `:memory:` | `./data/lattecoffe.sqlite` |
| `LOG_LEVEL` | `silent` | `info` |
| `BCRYPT_COST_ROUNDS` | `10` | `12` |
| `RATE_LIMIT_MAX` / `AUTH_RATE_LIMIT_MAX` | `1000000` | `300` / `20` |
| `AUTH_PASSWORD_RATE_LIMIT_MAX` | `3` (1 h) | `3` (1 h) |
| `JWT_ACCESS_TTL` | `15m` | `15m` |

El coste de bcrypt baja a 10 **sólo** para que la suite no tarde minutos: la
política de contraseñas (longitud, clases, triviales) se prueba entera. Los TTL
no se falsean. El único fichero con los limitadores activos es
`validation.spec.ts`, porque el 429 es parte de lo que hay que probar.

---

## 2. El harness compartido

Dos ficheros, y son la pieza que hace barato añadir tests.

**`test-env.ts`** sólo asigna `process.env`. No importa nada del proyecto: su
cuerpo se ejecuta en el primer `import` de la cadena, antes de que se evalúe
`config/env.ts`. Por eso el harness lo importa primero y cada spec lo recibe de
rebote.

**`harness.ts`**: `createTestContext()` levanta una base SQLite **en memoria**
con las migraciones y la semilla aplicadas (las mismas que en producción: mismo
SQL, misma matriz de RBAC; si la matriz viniera vacía, lanza), la **app Express
completa** con la misma cadena de middlewares y los mismos routers, devuelta
sin `listen` para que la use `supertest`, y un agente con `User-Agent`
explícito (`supertest` no lo envía, y sin él `device_info` quedaría a `NULL`).

| Utilidad | Para qué |
|---|---|
| `ctx.loginAsRole(role)` / `accessTokenFor(role)` | Login de las 4 cuentas de sistema |
| `ctx.get/post/patch/delete(path, body?, token?)` | Peticiones con `Authorization: Bearer` si se pasa token |
| `ctx.db` | La conexión, para aserciones directas: contar filas, leer un saldo |
| `ctx.createUser({ email, roles })` | Crea un usuario con los roles indicados, en una transacción |
| `ctx.uniqueEmail()` | Email único por test, de un contador. Evita chocar correos |
| `ctx.issueResetTokenFor(email)` | Emite un token de reseteo con el mismo `TokenService` que la API, porque en producción el token viaja por correo y aquí no hay proveedor |
| `ctx.container` | El contenedor de DI, para invocar services sin HTTP |

**Regla de oro: reutiliza este fichero, no escribas otro.** Es la única forma de
que la base en memoria, la semilla de RBAC y las cuatro cuentas de sistema sean
las mismas en todas las suites.

---

## 3. Inventario de la suite

21 ficheros, 626 tests, todos en verde.

### Unitarios (en `src/`, junto al código) — 74 tests

| Fichero | Tests | Qué cubre |
|---|---|---|
| [`money.spec.ts`](../backend/src/shared/utils/money.spec.ts) | 31 | `roundHalfUp` (`0.4→0`, `0.5→1`, `0.6→1`, `-0.5→0`), suma/resta/negación, `multiplyMinor`, `applyTaxBp`, `allocateMinor` (prorrateo sin perder centavos), `formatMinor` |
| [`state-machines.spec.ts`](../backend/src/shared/domain/state-machines.spec.ts) | 22 | Las 5 tablas de transiciones de `DESIGN.md` §6: `orders`, `chair_reservations`, `chair_rentals`, `chairs`, `payments` |
| [`datetime.spec.ts`](../backend/src/shared/utils/datetime.spec.ts) | 21 | `nowIso`/`toIso`, `parseIso`, `addMinutes`/`addDays`/`diffMinutes`, `startOfDayUtc`, `localDateKey`/`localTimeKey`, y **`overlaps` (BR-RES-001)**: parcial, contención, extremos que se tocan, disjuntos, consigo mismo, offsets normalizados a UTC |

### De integración HTTP (en `tests/`) — 552 tests

| Fichero | Tests | Qué cubre |
|---|---|---|
| [`reports.spec.ts`](../backend/tests/reports.spec.ts) | 74 | Los 12 endpoints de reportes, zona horaria del negocio, rangos, agrupación por día/hora/mes, KPIs, exportación CSV, RBAC, coherencia entre reportes |
| [`orders.spec.ts`](../backend/tests/orders.spec.ts) | 46 | TAKEAWAY / DINE_IN / CHAIR_RENTAL, orden de cálculo del dinero, atómicaidad (rollback total), ciclo de estados, inmutabilidad tras `COMPLETED`, edición de líneas, recibo, alcance de cliente |
| [`reservations.spec.ts`](../backend/tests/reservations.spec.ts) | 42 | Doble reserva, cotización sin escritura, máquina de estados, check-in, cancelación, extensión, caducidad y su job, alcance, RBAC, auditoría |
| [`catalog.spec.ts`](../backend/tests/catalog.spec.ts) | 41 | Categorías, productos, disponibilidad, duplicado, recetas, menú público, `resolveUnitPrice` (BR-PRICE-001), permisos |
| [`spaces.spec.ts`](../backend/tests/spaces.spec.ts) | 38 | Zonas y sillas, máquina de estados de silla, mapa, disponibilidad, historial, baja con sesiones vivas, RBAC, auditoría |
| [`auth.spec.ts`](../backend/tests/auth.spec.ts) | 38 | Registro, login, rotación y **detección de reuso**, logout / logout-all, recuperación y cambio de contraseña, perfil y sesiones, anti-enumeración |
| [`discounts.spec.ts`](../backend/tests/discounts.spec.ts) | 36 | Cupones PERCENT/FIXED, validación con importe, cupón por categoría, consumo dentro de la transacción, recorte por `max_discount_minor` |
| [`rentals.spec.ts`](../backend/tests/rentals.spec.ts) | 31 | Importe (mínimo 30 min, pro-rata, `ceil` por segundos), overage al precio congelado, walk-in, extensión, cierre, RBAC, auditoría |
| [`inventory.spec.ts`](../backend/tests/inventory.spec.ts) | 29 | Alta de ítems, movimientos, saldo y `balance_after`, stock negativo, ajustes, alertas de bajo stock, proveedores, permisos |
| [`payments.spec.ts`](../backend/tests/payments.spec.ts) | 29 | Métodos, idempotencia, efectivo y cambio, datáfono, cobro completo, reembolsos, alcance de cliente |
| [`business.spec.ts`](../backend/tests/business.spec.ts) | 26 | Lectura pública, edición, horario, días festivos, estado del local |
| [`rbac.spec.ts`](../backend/tests/rbac.spec.ts) | 25 | CUSTOMER no administra usuarios, permisos por rol, protección del último OWNER, ciclo de vida, `GET /meta/roles` |
| [`notifications.spec.ts`](../backend/tests/notifications.spec.ts) | 24 | Bandeja, marcar leídas, preferencias, franja silenciosa, encolado por canal |
| [`seed.spec.ts`](../backend/tests/seed.spec.ts) | 24 | Idempotencia, catálogo y sillas de demo, **coherencia aritmética de los 18 pedidos sembrados**, cuentas de demo |
| [`validation.spec.ts`](../backend/tests/validation.spec.ts) | 20 | `.strict()` en body / query / params, formato y rango, **429 real de rate limit**, envoltorio de respuesta |
| [`locations.spec.ts`](../backend/tests/locations.spec.ts) | 18 | Listado, alta, edición y baja lógica de sedes |
| [`security-regression.spec.ts`](../backend/tests/security-regression.spec.ts) | 7 | Regresión de los **dos IDOR** corregidos en reservas (§7) |
| [`migration-0003.spec.ts`](../backend/tests/migration-0003.spec.ts) | 4 | Paridad de esquema y datos de `0003`, CHECK nuevo que acepta y viejo que rechaza, reversión abortada sin dejar la tabla a medias |

---

## 4. Casos críticos cubiertos

Verificado leyendo los ficheros, no de memoria.

| Escenario | Qué comprueba el test | Dónde |
|---|---|---|
| **Doble reserva** (BR-RES-002/003) | Segunda reserva solapada → `409 CHAIR_ALREADY_RESERVED` con el código ganador; sólo queda 1 fila en la base | `reservations.spec.ts:138` |
| Extremos que se tocan no se solapan | 14:00-16:00 y 16:00-18:00, ambas aceptadas | `reservations.spec.ts:200` |
| Reserva `PENDING` también bloquea | 409 en el segundo intento | `reservations.spec.ts:216` |
| **Caducidad** (BR-RES-004) | `EXPIRED` en una `CONFIRMED` vencida y en un `PENDING` pasado su gracia de 30 min; el job es idempotente; sólo un ADMIN lo lanza | `reservations.spec.ts:800-879` |
| **Cancelación** (BR-RES-008) | Exige motivo y libera la silla; no la libera si queda otra reserva viva por delante; una terminal no se puede volver a cancelar | `reservations.spec.ts:550-634` |
| **Extensión de silla** (BR-RES-010/012) | Recalcula la proyección sin cambiar el precio congelado; 409 si choca; 400 si `newEndAt` no avanza; una `ACTIVE` no se extiende | `reservations.spec.ts:635-718` |
| Extensión de alquiler (BR-RENTAL-011) | Movimiento al precio congelado; overage sobre el plan ya extendido; mínimo 5 min; 422 si está cerrado | `rentals.spec.ts:383-457` |
| **Overage** (BR-RENTAL-003/004) | Cobra el exceso al precio **congelado** aunque la silla haya subido; 0 si se va antes; perdonable por MANAGER con motivo | `rentals.spec.ts:219-285` |
| **Pedido con silla** (BR-ORDER-012/015) | `CHAIR_RENTAL` sin silla, sin reserva o con líneas de producto son 422 legible; el total del alquiler se suma; al completar, la silla pasa a `CLEANING` | `orders.spec.ts:1044-1155` |
| **Takeaway** | 201 con `order_number` y snapshots | `orders.spec.ts:292` |
| **Dine-in** | Sin silla (barra sin asignar, BR-ORDER-009) y con silla validada | `orders.spec.ts:1156-1185` |
| **Pago exitoso** (BR-PAY-008) | El cobro completo deja el pedido `COMPLETED`; un `CONFIRMED` pasa con un paso; no se cobra un `DRAFT` ni un `CANCELLED` | `payments.spec.ts:510-587` |
| **Pago idempotente** (BR-PAY-001) | Sin `Idempotency-Key` es 400 y no cobra; clave repetida devuelve el mismo pago; clave nueva con saldo 0 es 409 | `payments.spec.ts:206-282` |
| Efectivo insuficiente (BR-MONEY-007/008) | Se rechaza antes de tocar la caja; el cambio no se guarda como pago; con datáfono cobrar de más es 422 | `payments.spec.ts:336, 447` |
| **Inventario insuficiente** (BR-INV-002) | 5 pedidos con 1 en stock → `422 NEGATIVE_STOCK_BLOCKED` y **nada** escrito: ni cabecera, ni línea, ni movimiento, ni saldo | `orders.spec.ts:650` |
| **Producto desactivado** (BR-PRICE-006) | En un pedido, `422 PRODUCT_UNAVAILABLE`; desaparece del menú público con 404; disponibilidad comercial separada de la existencia en stock | `orders.spec.ts:622`, `catalog.spec.ts:301, 735` |
| Complemento ajeno (BR-PRICE-012) | `422 ADDON_NOT_IN_PRODUCT` | `orders.spec.ts:628` |
| **Silla bloqueada** | No abre alquiler en silla bloqueada (`CHAIR_BLOCKED`) ni en limpieza (`CHAIR_NOT_BOOKABLE`); tampoco reserva una en mantenimiento | `rentals.spec.ts:324, 332`, `reservations.spec.ts:755` |
| **Usuario sin permisos** | CUSTOMER recibe 403 con `details.required` en cada endpoint de `/users`; no puede ver ni cancelar la reserva de otro (404, no 403); un CASHIER lee inventario pero no mueve stock | `rbac.spec.ts:51`, `reservations.spec.ts:904`, `inventory.spec.ts:555` |
| Último OWNER (BR-RBAC-003) | Nadie se borra ni desactiva a sí mismo; el último OWNER no se degrada ni se borra; con dos, uno puede renunciar | `rbac.spec.ts:210-364` |
| Anti-enumeración | Login con el mismo mensaje y código si el email no existe; `forgot-password` responde 200 exista o no | `auth.spec.ts:237, 405` |
| Reuso de refresh | Un token ya revocado revoca la familia y devuelve 401 con `TOKEN_REUSE` | `auth.spec.ts:322` |
| Rate limiting real | `forgot-password`: `[200, 200, 200, 429]` con `Retry-After` y `RateLimit-Limit: 3`; el límite se comparte con `reset-password` | `validation.spec.ts:178-216` |
| Coherencia de la semilla | `subtotal + impuesto - descuento === total` en los 18 pedidos; `paid_minor` es la suma de cobros aprobados; impuesto del 19 % por línea | `seed.spec.ts:390-574` |

### Lo que NO tiene test

| Escenario | Estado |
|---|---|
| **Pago fallido** (datáfono rechaza, queda `payments.status = 'FAILED'`) | **Sin test.** El estado está en el CHECK del esquema y en el enum, pero ninguna prueba lo produce por HTTP. Los pagos rechazados del sistema son de validación de entrada, no de rechazo del proveedor |
| **Concurrencia real** (`Promise.all` sobre la misma silla) | **Sin test.** La doble reserva se prueba en **secuencial**: la segunda petición llega cuando la primera ya confirmó. Es la garantía funcional, no la prueba del `SQLITE_BUSY` entre dos conexiones |
| **`SQLITE_BUSY` → `409 RESOURCE_BUSY`** | **Sin test.** La traducción existe en `translateSqliteError`; dispararla exigiría dos conexiones reales y un bloqueo manual |
| **Aislamiento entre negocios** (BR-SEC-008) con dos negocios reales | **Sin test.** En v1 hay un negocio singleton (`businesses.id = 1`); se verifica que el `businessId` sale del token, no multi-tenancy |
| **Job de expiración programado** | **Sin test.** Se prueba el endpoint del job y su idempotencia, no un planificador |
| **Matriz completa rol × permiso** | **Sin test.** El alcance por cliente sí está cubierto en reservas, alquileres, pedidos y pagos, pero no hay un test que itere los 83 permisos × 6 roles |
| **Recuperación por correo real** | No hay proveedor: el enlace sólo se registra en desarrollo |

---

## 5. Concurrencia y zona horaria

**Concurrencia.** `BEGIN IMMEDIATE` serializa las secciones críticas
([`BASE-DE-DATOS.md`](./BASE-DE-DATOS.md) §7). Se verifica de dos formas
complementarias:

1. **Funcionalmente, en secuencial.** El bloque `Doble reserva: el caso de los
   dos clientes` de `reservations.spec.ts` es el test más importante de la
   suite: es el escenario de carrera que define si el sistema es correcto o
   sólo lo parece. Cubre solapamiento parcial, `PENDING` que bloquea,
   confirmación que revalida, y la regresión del índice `0002` (dos reservas
   `CONFIRMED` que no se solapan: ambas 200).
2. **Unitariamente.** `overlaps()` en `datetime.spec.ts` fija la semántica del
   solapamiento con 6 tests, incluida la normalización de offsets a UTC.

Lo que no se prueba: dos escrituras simultáneas de verdad. La suite corre en un
solo proceso con una sola conexión, así que el event loop ya serializa y
`BEGIN IMMEDIATE` apenas llega a ser observable.

**Zona horaria.** Hay un `describe` entero en `reports.spec.ts`: `Zona horaria
del negocio: el corte de día es local, no UTC`. El primer test es la aserción de
la que dependen los demás:

```ts
expect(TODAY_START.toISOString()).toMatch(/T05:00:00\.000Z$/);
```

El día local de Bogotá empieza a las **05:00:00Z** (UTC-5). En la base todo
instante es ISO-8601 **UTC**; el negocio razona en hora local. Un café vendido a
las 21:30 en Bogotá está a las **02:30 UTC del día siguiente**: si un reporte
agrupara por `substr(created_at,1,10)` en UTC, esa venta caería en el día
equivocado y el "total de hoy" no cuadraría con la caja.

Los tests cubren la venta de las 21:30 de **hoy** (que en UTC es mañana), la de
las 21:30 de **ayer** (que en UTC es hoy y no debe entrar), que `yesterday` es
el día local anterior y no las 24 h previas, que `groupBy=month` agrupa por mes
local, y que el desglose semanal usa `0 = domingo`. La implementación está en
[`reports.tz.ts`](../backend/src/modules/reports/reports.tz.ts): el offset se lee
de `Intl.DateTimeFormat` en el instante concreto, así que funciona con cualquier
zona IANA y con el horario de verano.

---

## 6. Regresión de IDOR

[`security-regression.spec.ts`](../backend/tests/security-regression.spec.ts)
existe para fijar dos agujeros que la suite anterior **no cubría**: todos los
tests de alcance usaban un `customerId` que era el del propio actor, o lo
omitían. Ninguno usaba el de **otro** cliente.

1. **`POST /reservations` con `customerId` de otro usuario.**
   `resolveCustomerId` devolvía `input.customerId` tal cual sin comprobar el rol.
   Un CUSTOMER podía crear una reserva a nombre de un tercero, o una "de
   mostrador" sin dueño que bloqueaba la silla y que luego no podía ni ver para
   cancelar.
2. **Reservas de mostrador (`customer_id IS NULL`).** `assertCanAccess` devolvía
   `ok` en cuanto `row.customer_id === null`, así que cualquier cliente
   autenticado podía leer, confirmar y cancelar reservas de mostrador ajenas,
   con `reservations:cancel` en marca `P`.

La regla que ambas correcciones hacen cumplir: **el id de usuario sale siempre
del token**. El fichero prueba las dos caras: el cajero **sí** puede seguir
creando una reserva sin cliente, y el 404 al recurso ajeno llega **antes** de
mutar nada.

---

## 7. Cómo añadir un test

**Integración HTTP** (el caso habitual):

```ts
// tests/mi-nueva-suite.spec.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestContext, type TestContext } from './helpers/harness.js';

let ctx: TestContext;
let adminToken: string;

beforeAll(async () => {
  ctx = await createTestContext();          // base en memoria + migraciones + semilla
  adminToken = await ctx.accessTokenFor('ADMIN');
});

afterAll(() => {
  ctx.close();
});

describe('Mi suite', () => {
  it('hace lo que dice el nombre y cita la regla (BR-MIAREA-001)', async () => {
    const response = await ctx
      .post('/api/v1/orders', { /* body */ }, adminToken)
      .expect(201);

    // Se comprueba el ENVOLTORIO, no sólo el status: el contrato exige
    // { success, data, meta } y el código va en error.details.code.
    expect(response.body.success).toBe(true);
    expect(response.body.data.totalMinor).toBe(100_000);

    // Y se puede asertar sobre la base, sin pasar por la API.
    const row = ctx.db
      .prepare('SELECT COUNT(*) AS total FROM orders')
      .get() as { total: number };
    expect(row.total).toBe(1);
  });
});
```

- El **nombre del test cita la regla** que verifica: es lo que hace la suite
  rastreable contra `DESIGN.md` §7.
- El **dinero se comprueba en centavos enteros** y con el valor exacto: 2 h ×
  $5.000/h = $10.000 → `1000000`. Un redondeo mal hecho se ve como
  `expected 999999 to be 1000000`.
- Emails con `ctx.uniqueEmail()`, nunca literales.
- Los datos se crean **por la API**, no insertando a mano: así el test cubre
  también las validaciones.

**Unitario de una función pura**:

```ts
// src/modules/catalog/catalog.pricing.spec.ts
import { describe, expect, it } from 'vitest';

import { resolveUnitPrice } from './catalog.pricing.js';

const AHORA = '2026-06-15T12:00:00.000Z';
const base = { basePriceMinor: 500_000 } as const;

describe('resolveUnitPrice — BR-PRICE-001', () => {
  it('(1) sin promo y sin variante devuelve el precio base', () => {
    expect(
      resolveUnitPrice(
        { ...base, promoPriceMinor: null, promoStartsAt: null, promoEndsAt: null },
        null,
        AHORA,
      ),
    ).toEqual({ unitPriceMinor: 500_000, source: 'BASE' });
  });

  it('(2) la promo activa gana sobre la variante de precio absoluto', () => {
    expect(
      resolveUnitPrice(
        { ...base, promoPriceMinor: 400_000, promoStartsAt: AHORA, promoEndsAt: null },
        { priceDeltaMinor: null, priceMinor: 450_000 },
        AHORA,
      ),
    ).toEqual({ unitPriceMinor: 400_000, source: 'PROMO' });
  });
});
```

Para el total de un pedido, `computeOrderTotals()` en
[`order-pricing.ts`](../backend/src/modules/orders/order-pricing.ts) tiene la
misma firma pura: recibe líneas cotizadas, el importe del cupón ya resuelto y
las tasas por línea, y devuelve los totales redondeados. Es la razón por la que
ese fichero existe **fuera** de `OrdersService`: si viviera dentro, probar
"tres líneas de 33 y un cupón del 10 %" exigiría montar la base y llamar a un
endpoint.

---

## 8. Frontend

**El frontend no tiene ningún test ejecutado.** En el entorno donde se
construyó el backend no había SDK de Flutter ni de Dart (`flutter` y `dart` no
están instalados), así que `flutter test` no se pudo ejecutar ni una vez.

| Ruta | Contenido |
|---|---|
| [`frontend/test/README.md`](../frontend/test/README.md) | Declara tres suites que "deberían existir cuando se instale el SDK": `currency_formatter_test.dart`, `date_formatter_test.dart`, `status_badge_test.dart` |
| `frontend/test/` | **Sólo el README.** Cero ficheros `*_test.dart` |

**No hay ningún resultado de `flutter test` que reportar.** El código que esas
suites verificarían sí existe (`lib/core/utils/currency_formatter.dart`,
`date_formatter.dart`, `lib/shared/widgets/ui/status_badge.dart`), pero está
**sin verificar**.

### Qué habría que escribir

| Capa | Qué se prueba | Coste |
|---|---|---|
| **Utilidades puras** | `formatMinor`, `parseMinor`, `sumMinor`, duraciones, countdown. Sin widgets, sin red | Muy bajo. Lo primero |
| **Dominio** | Entidades y use cases con repositorio falso | Bajo |
| **Repositorios** | Mapeo JSON ↔ modelo, manejo de `error.code`, cabecera `Idempotency-Key` | Medio |
| **Widgets** | Que un badge con cada `ChairStatus` y `OrderStatus` resuelve a un texto no vacío | Alto. Es lo que justifica los goldens |

Las dos piezas más delicadas del cliente, que **deberían** tener test:

- **`SessionRefresher`** (single-flight del refresh). Si tres peticiones reciben
  un 401 a la vez y cada una refresca por su cuenta, la segunda reutiliza un
  token revocado y el backend revoca **todas** las sesiones del usuario. La
  clase ya está diseñada para ser comprobable en aislamiento (una ranura
  `inFlight`).
- **`TokenStorage`** (espejo en memoria y lectura coalescente). Una sesión
  corrupta debe dar `null`, no una excepción.

### Ejemplos

```dart
// test/currency_formatter_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:latte_coffee/core/utils/currency_formatter.dart';

void main() {
  test('formatMinor(500000) es $5.000, sin decimales (API.md 6.1)', () {
    expect(CurrencyFormatter.formatMinor(500000), r'$5.000');
  });

  test('parseMinor hace el viaje inverso sin perder centavos', () {
    expect(CurrencyFormatter.parseMinor(r'$5.000'), 500000);
    expect(CurrencyFormatter.parseMinor(r'5.000'), 500000);
  });

  test('BR-MONEY-001: la suma de enteros no deriva', () {
    // Con double esto daría 0.30000000000000004.
    expect(CurrencyFormatter.sumMinor(<int>[1000, 1000, 1000]), 3000);
  });
}
```

```dart
// test/session_refresher_test.dart
void main() {
  test('tres refresh concurrentes hacen UNA sola llamada a /auth/refresh', () async {
    final dio = _FakeDio();              // cuenta las llamadas a /auth/refresh
    final storage = _InMemoryTokenStorage(_session('r1'));
    final refresher = SessionRefresher(dio: dio, storage: storage);

    final resultados = await Future.wait(<Future<StoredSession?>>[
      refresher.refresh(),
      refresher.refresh(),
      refresher.refresh(),
    ]);

    expect(dio.authRefreshCalls, 1);
    // Un segundo refresh habría reutilizado un token ya revocado: el backend
    // lo detecta como REUSE y cierra TODAS las sesiones del usuario.
    expect(resultados.where((s) => s != null).length, 1);
  });
}
```

```dart
// test/status_badge_test.dart
testWidgets('los 6 ChairStatus resuelven a un texto no vacío', (tester) async {
  for (final status in const <String>[
    'AVAILABLE', 'OCCUPIED', 'RESERVED', 'BLOCKED', 'MAINTENANCE', 'CLEANING',
  ]) {
    await tester.pumpWidget(MaterialApp(home: StatusBadge.chair(status)));
    expect(find.byType(Text), findsWidgets);   // garantía anti-regresión a11y
  }
});
```

Convenciones declaradas en `frontend/test/README.md`: los nombres citan la regla
o el token que verifican, y los goldens se generan con
`flutter test --update-goldens` y se commitean, para que un cambio de token se
vea en el diff del code review.
