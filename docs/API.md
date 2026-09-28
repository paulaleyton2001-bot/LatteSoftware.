# LatteCoffe POS — Contrato de API REST v1

Version del documento: 1.0.0
Estado: CONGELADO (contrato normativo)
Documento complementario: [`DESIGN.md`](./DESIGN.md)

> Este documento define la API que el backend implementa y que el frontend consume. Si un endpoint difiere de lo aquí escrito, es un error. Todas las rutas, nombres de campo, tipos y códigos son normativos.

---

## Índice

1. Convenciones generales
2. Autenticación y autorización
3. Envoltorio de respuesta
4. Códigos de error
5. Paginación, orden y filtros
6. Tipos y formatos comunes
7. Endpoints
8. Notas de implementación

---

## 1. Convenciones generales

| Aspecto | Definición |
|---|---|
| **Base URL** | `http://localhost:3000/api/v1` en desarrollo. En producción, el mismo path detrás del proxy inverso. |
| **Versión** | En el path (`/api/v1`), no en header ni en query. El versionado es por URL para que el routing sea explícito y cacheable. |
| **Formato de request** | `Content-Type: application/json` en cuerpos con payload. Los `GET` y `DELETE` no llevan cuerpo. |
| **Formato de response** | Siempre `application/json; charset=utf-8`. Ningún endpoint devuelve HTML, CSV (salvo `POST /reports/export`) ni binario. |
| **Casing** | JSON en `camelCase` (`basePriceMinor`). La base de datos en `snake_case` (`base_price_minor`). El mapeo ocurre en `repositories/sqlite/mappers/`, nunca en el controller. |
| **Dinero** | `integer` en la unidad mínima (centavos). `500000` = $5.000 COP. Nunca `float`. |
| **Fechas** | `string` ISO-8601 UTC con milisegundos y `Z`: `2026-03-14T15:04:05.000Z`. Se acepta offset (`2026-03-14T10:04:05-05:00`) y se normaliza a UTC. |
| **Fechas de solo día** | `string` `YYYY-MM-DD`: `2026-03-14`. Se interpreta en la zona horaria del negocio. |
| **Horas locales** | `string` `HH:MM` 24h en la zona horaria del negocio: `08:30`. |
| **Booleanos** | `boolean` JSON (`true`/`false`), nunca `0`/`1` en la API. |
| **Cantidades** | `number`. Puede ser fraccional (`0.5`, `1.25`) para pesajes. |
| **Ids** | `integer` en request y response. Nunca como `string`. |
| **Enumerados** | `string` en mayúsculas, tal como aparecen en `GET /api/v1/meta/enums`. |
| **Campos desconocidos** | Rechazados con `400 VALIDATION_ERROR` (esquemas zod `.strict()`). No se ignoran en silencio. |
| **Códigos HTTP** | `201` en creación, `200` en lectura/actualización/acción, `204` solo en borrado sin cuerpo de respuesta, `4xx` en error del cliente, `5xx` en error del servidor. |
| **Idempotencia** | `POST /payments` exige el header `Idempotency-Key`. Los demás `POST` no son idempotentes. |
| **Correlación** | Todo request acepta `X-Request-Id` y siempre responde con el mismo valor (o uno nuevo si no viene). Aparece en `meta.requestId` y en el log del servidor. |
| **Timezone del negocio** | Todos los filtros de día (hoy, último mes) usan `businesses.timezone`, no la del servidor. |

---

## 2. Autenticación y autorización

| Aspecto | Definición |
|---|---|
| Esquema | `Authorization: Bearer <accessToken>` |
| Access token | JWT HS256, TTL 900 s (15 min). |
| Refresh token | Valor opaco, TTL 30 días, rotativo. |
| Rotación | Cada `POST /auth/refresh` emite un refresh nuevo y revoca el anterior. Si se reusa uno revocado, se revocan todas las sesiones del usuario y se registra `REFRESH_TOKEN_REUSE`. |
| Renovación automática | El cliente renueva cuando le queden menos de 60 s. Un `401 AUTHENTICATION_ERROR` con `error.code = 'TOKEN_EXPIRED'` también dispara un intento de renovación, una sola vez por request. |
| Rutas públicas | `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/forgot-password`, `POST /auth/reset-password`, `GET /health`, `GET /meta/roles`, `GET /meta/enums`. |
| Identidad de negocio | El `businessId` sale del access token. **Nunca** se acepta en body ni query. Cualquier intento se rechaza con `400 VALIDATION_ERROR` (campo no permitido). |
| Falta de credencial | `401 AUTHENTICATION_ERROR` con `error.code = 'MISSING_TOKEN'`. |
| Token inválido o corrupto | `401 AUTHENTICATION_ERROR` con `error.code = 'INVALID_TOKEN'`. |
| Credencial válida sin permiso | `403 AUTHORIZATION_ERROR` con `error.code = 'INSUFFICIENT_PERMISSIONS'` y `details.required`. Nunca `404` por falta de permiso. |
| Alcance de cliente | Un `CUSTOMER` que accede a un recurso ajeno recibe `404 NOT_FOUND_ERROR` para no revelar existencia, salvo en `/users/*`, donde recibe `403`. |

---

## 3. Envoltorio de respuesta

### 3.1 Éxito

```json
{
  "success": true,
  "data": { "...": "el recurso o la collection" },
  "meta": {
    "page": 1,
    "pageSize": 20,
    "total": 137,
    "requestId": "8f1c2b0e-4a77-4c1e-9d2a-0b6f1c2d3e4f"
  }
}
```

| Clave | Presente siempre | Presente en listas | Regla |
|---|:--:|:--:|---|
| `success` | Sí | Sí | `true` literal. |
| `data` | Sí | Sí | El recurso (objeto) o la colección (array). Puede ser `null` en acciones sin retorno de entidad. |
| `meta.requestId` | Sí | Sí | UUID v4, igual al header `X-Request-Id`. |
| `meta.page` | No | Sí | 1-based. Solo en `GET` con paginación. |
| `meta.pageSize` | No | Sí | Elementos por página solicitados (no los devueltos). |
| `meta.total` | No | Sí | Total de filas que satisfacen el filtro, sin paginar. |

Ejemplos de `meta` en endpoints sin paginación:

```json
{ "success": true, "data": { "id": 42 }, "meta": { "requestId": "..." } }
```

```json
{
  "success": true,
  "data": { "counts": { "AVAILABLE": 12, "OCCUPIED": 3 } },
  "meta": { "requestId": "...", "generatedAt": "2026-03-14T15:04:05.000Z" }
}
```

Campos adicionales permitidos en `meta`, cuando aplique: `generatedAt` (reportes y mapa), `warnings` (avisos no bloqueantes, p. ej. campos ignorados), `appliedRules` (id de reglas de negocio aplicadas, útil en cotizaciones).

### 3.2 Error

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "La solicitud contiene campos inválidos",
    "details": [
      { "path": "items[0].quantity", "message": "Debe ser mayor que 0", "code": "TOO_SMALL" }
    ]
  },
  "requestId": "3c9e7a41-88b2-4f0d-a7e6-55b0c9d1e2f3"
}
```

| Clave | Presente siempre | Regla |
|---|:--:|---|
| `success` | Sí | `false` literal. |
| `error.code` | Sí | Uno de los códigos de la sección 4. Es estable: el frontend puede ramificar por él. |
| `error.message` | Sí | Texto en español, accionable, apto para mostrar al usuario final sin加工. Nunca contiene identificadores internos, SQL ni rutas. |
| `error.details` | No | `array` de `{ path, message, code }` para validación; `object` con datos estructurados para reglas de negocio (p. ej. `{ "conflictingReservationCode": "RES-10231" }`); `array` para reglas de negocio con campos concretos. |
| `requestId` | Sí | Fuera de `error`, a nivel raíz. Debe mostrarse en pantalla de soporte. |

`error.details` tiene tres formas según el origen:

```json
// 1. Validación de esquema: siempre un array de rutas
"details": [ { "path": "email", "message": "Debe ser un correo válido", "code": "INVALID_FORMAT" } ]

// 2. Regla de negocio puntual: un objeto con datos útiles para la UI
"details": { "conflictingReservationCode": "RES-10231", "conflictingStartAt": "...", "conflictingEndAt": "..." }

// 3. Regla de negocio múltiple: un array de objetos por ítem afectado
"details": [ { "productId": 12, "code": "PRODUCT_UNAVAILABLE", "message": "El producto no está disponible" } ]
```

---

## 4. Códigos de error

| HTTP | `error.code` | Cuándo | `error.details` |
|---:|---|---|---|
| **400** | `VALIDATION_ERROR` | Fallo de esquema zod en body, query o params; campo desconocido; tipo o formato incorrecto. | `array` de `{ path, message, code }` |
| **401** | `AUTHENTICATION_ERROR` | Token ausente, inválido, expirado o revocado; credenciales incorrectas; refresh token reutilizado. `details.code` distingue: `MISSING_TOKEN`, `INVALID_TOKEN`, `TOKEN_EXPIRED`, `INVALID_CREDENTIALS`, `TOKEN_REVOKED`, `TOKEN_REUSE`. | objeto |
| **403** | `AUTHORIZATION_ERROR` | Autenticado pero sin el permiso requerido; usuario `BLOCKED` o `INACTIVE`; recurso fuera del alcance de cliente. `details.required` = permiso faltante. | objeto |
| **404** | `NOT_FOUND_ERROR` | Recurso inexistente, soft-deleted, o fuera del `businessId` del token. | objeto `{ id, type }` |
| **409** | `CONFLICT_ERROR` | Violación de unicidad; transición de estado repetida; silla ocupada; recurso ya existente; `SQLITE_BUSY`. `details.code` distingue: `DUPLICATE`, `INVALID_ORDER_TRANSITION`, `CHAIR_OCCUPIED`, `CHAIR_ALREADY_RESERVED`, `ORDER_IMMUTABLE`, `RESOURCE_BUSY`. | objeto |
| **422** | `BUSINESS_RULE_ERROR` | La petición es válida pero viola una regla de negocio. `details.code` es el identificador estable: `PRODUCT_UNAVAILABLE`, `NEGATIVE_STOCK_BLOCKED`, `CHAIR_NOT_BOOKABLE`, `RENTAL_REQUIRES_CHAIR_AND_RESERVATION`, `EMPTY_ORDER`, `ORDER_NOT_EDITABLE`, `ORDER_NOT_PAYABLE`, `ORDER_NOT_CONFIRMED`, `PAYMENT_REQUIRES_ORDER`, `PAYMENT_EXCEEDS_TOTAL`, `PROVIDER_REQUIRED`, `DISCOUNT_LIMIT_REACHED`, `DISCOUNT_EXCEEDED_PER_CUSTOMER`, `DISCOUNT_MIN_ORDER_NOT_MET`, `RESERVATION_TOO_LONG`, `ADDON_SELECTION_LIMIT`, `ADDON_NOT_IN_PRODUCT`, `ITEM_NOT_TRACKED`, `INVENTORY_SOURCE_REQUIRED`, `CHAIR_CODE_IMMUTABLE`, `LAST_OWNER_PROTECTED`, `ORDER_NOT_DELETABLE`, `MIXED_ORDER_TYPE_NOT_ALLOWED`, `INVALID_CHAIR_STATUS_TRANSITION`, `INVALID_RESET_TOKEN`, `INVALID_VARIANT_PRICE`, `RESERVATION_NOT_ACTIVE`, `FK_VIOLATION`, `DB_CONSTRAINT_VIOLATION`. | objeto o `array` |
| **402** | `PAYMENT_ERROR` | Rechazo del proveedor de pago, tarjeta declined, fondos insuficientes, timeout del proveedor. `details.provider` y `details.providerCode` (código del proveedor, no su mensaje crudo). | objeto |
| **429** | `RATE_LIMIT_ERROR` | Límite de tasa excedido. Incluye cabecera `Retry-After` en segundos y `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`. | objeto `{ limit, windowMs, retryAfterSeconds }` |
| **500** | `INTERNAL_ERROR` | Excepción no controlada. En producción el mensaje es genérico y **nunca** incluye stack trace. | `null` en producción |
| **503** | `SERVICE_UNAVAILABLE` | Base de datos no disponible, dependencia caída, o mantenimiento programado. Incluye `Retry-After`. | objeto |

Reglas transversales:

- El código HTTP y `error.code` **siempre** coinciden según la tabla. No hay `409` con `error.code = 'VALIDATION_ERROR'`.
- `error.code` es estable entre versiones. `error.message` puede cambiar sin aviso.
- Un `500` nunca contiene detalles técnicos. Para soporte se usa `requestId`.
- Los `422` de reglas de negocio **deben** citar el identificador de la regla de `DESIGN.md` en `details.ruleId` cuando exista (ej. `BR-INV-002`).

---

## 5. Paginación, orden y filtros

### 5.1 Paginación

Se aplica a todo listado. Por defecto `page=1`, `pageSize=20`.

| Parámetro | Tipo | Default | Reglas |
|---|---|---|---|
| `page` | `integer` | `1` | `>= 1`. Máximo 10 000. Más allá devuelve `400 VALIDATION_ERROR`. |
| `pageSize` | `integer` | `20` | Entre 1 y 100. `> 100` devuelve `400 VALIDATION_ERROR` con `details` en `pageSize`. |
| `sort` | `string` | el por defecto del recurso | Debe ser una columna de la **allowlist** del endpoint. Un valor fuera de la lista es `400 VALIDATION_ERROR` con `code: 'INVALID_SORT_FIELD'`. Nunca se interpola sin validar. |
| `order` | `string` | `desc` para listados recientes, `asc` para catálogos | `asc` \| `desc`. Cualquier otro valor: `400`. |

Estabilidad: todo listado ordena por una tupla `(sort, id)` para que la paginación no duplique ni omita filas cuando hay empates. Ejemplo de orden por defecto en `/orders`: `createdAt desc, id desc`.

### 5.2 Filtros de fecha para reportes

Se aplican a todos los endpoints de `/api/v1/reports/*` y a los listados con rango temporal.

| Parámetro | Tipo | Regla |
|---|---|---|
| `preset` | `string` | Uno de `today`, `yesterday`, `last7`, `last30`, `thisMonth`, `lastMonth`, `custom`. Mutuamente excluyente con `from`/`to` si se envía `custom`. |
| `from` | `string` ISO-8601 UTC | Requerido si `preset=custom`. Ambos inclusive. |
| `to` | `string` ISO-8601 UTC | Requerido si `preset=custom`. Excluido (`< to`). Si solo se envía `from`, `to = now`. |
| `timezone` | `string` | Opcional. Default `businesses.timezone`. Debe ser un identificador IANA válido. |

Resolución de `preset` (en hora local del negocio, luego convertido a UTC):

| Preset | Desde | Hasta |
|---|---|---|
| `today` | hoy 00:00:00 local | mañana 00:00:00 local |
| `yesterday` | ayer 00:00:00 local | hoy 00:00:00 local |
| `last7` | hoy − 6 días, 00:00 local | mañana 00:00 local (7 días inclusive) |
| `last30` | hoy − 29 días, 00:00 local | mañana 00:00 local (30 días inclusive) |
| `thisMonth` | día 1 del mes actual, 00:00 local | mañana 00:00 local |
| `lastMonth` | día 1 del mes anterior, 00:00 | día 1 del mes actual, 00:00 |
| `custom` | `from` (inclusive) | `to` (exclusive) |

Si `from > to`: `400 VALIDATION_ERROR` con `code: 'INVALID_DATE_RANGE'`.
Si el rango supera 366 días en reportes: `400 VALIDATION_ERROR` con `code: 'RANGE_TOO_LARGE'`.

### 5.3 Filtros comunes a los listados de negocio

| Parámetro | Aplica a | Regla |
|---|---|---|
| `q` | usuarios, productos, categorías, pedidos, clientes, sillas | Búsqueda de texto, 2 a 100 caracteres. En productos busca por `name`, `sku` y `shortDescription`. En pedidos busca por `orderNumber` y `customerNotes`. |
| `includeInactive` | produtos, categorías, sillas, zonas | `boolean`, default `false`. Solo con permiso de lectura administrativa. |
| `locationId` | zonas, sillas, pedidos, reservas, alquileres | `integer`. Filtra por sede. |
| `from` / `to` | listados con fecha | Ver 5.2. |
| `sort` / `order` | todos | Ver 5.1. |

---

## 6. Tipos y formatos comunes

Definidos en `docs/API.md` y reflejados en `GET /api/v1/meta/enums`.

### 6.1 Dinero

| Formato | Ejemplo | Nota |
|---|---|---|
| Entero en centavos | `500000` | Todos los campos `*Minor` de la API. |
| Formato de presentación | `$5.000` | Solo para textos de recibo y `label`. Nunca se usa como valor numérico. |
| Formato decimal de recibo | `$5.000,00` | Campo `display` opcional en el recibo. |

### 6.2 Enumerados

| Enum | Valores |
|---|---|
| `Role` | `CUSTOMER`, `STAFF`, `CASHIER`, `MANAGER`, `ADMIN`, `OWNER` |
| `UserStatus` | `ACTIVE`, `INACTIVE`, `BLOCKED` |
| `ChairKind` | `CHAIR`, `TABLE`, `COUNTER`, `AREA` |
| `ChairStatus` | `AVAILABLE`, `OCCUPIED`, `RESERVED`, `BLOCKED`, `MAINTENANCE`, `CLEANING` |
| `ReservationStatus` | `PENDING`, `CONFIRMED`, `ACTIVE`, `COMPLETED`, `CANCELLED`, `EXPIRED` |
| `RentalStatus` | `ACTIVE`, `EXTENDED`, `COMPLETED`, `CANCELLED` |
| `OrderType` | `TAKEAWAY`, `DINE_IN`, `CHAIR_RENTAL` |
| `OrderStatus` | `DRAFT`, `PENDING`, `CONFIRMED`, `PREPARING`, `READY`, `DELIVERING`, `COMPLETED`, `CANCELLED`, `REFUNDED` |
| `OrderItemStatus` | `PENDING`, `READY`, `CANCELLED` |
| `PaymentMethod` | `CASH`, `CARD`, `TRANSFER`, `ONLINE` |
| `PaymentProvider` | `CASH_REGISTRY`, `STRIPE`, `MERCADOPAGO`, `WOMPI`, `PAYU` |
| `PaymentStatus` | `PENDING`, `APPROVED`, `FAILED`, `REFUNDED`, `PARTIALLY_REFUNDED`, `CANCELLED` |
| `DiscountType` | `PERCENT`, `FIXED` |
| `DiscountAppliesTo` | `ALL`, `CATEGORY`, `PRODUCT` |
| `InventoryMovementType` | `PURCHASE`, `SALE`, `ADJUSTMENT`, `WASTE`, `RETURN`, `RESERVATION`, `RELEASE` |
| `OrderChannel` | `COUNTER`, `MOBILE_WEB`, `POS` |
| `ReservationSource` | `CUSTOMER`, `STAFF`, `ADMIN` |
| `NotificationType` | `ORDER_CONFIRMED`, `ORDER_READY`, `RESERVATION_CONFIRMED`, `RESERVATION_UPCOMING`, `RESERVATION_TIME_ENDING`, `RESERVATION_CANCELLED`, `PAYMENT_SUCCESS`, `PAYMENT_FAILED`, `SYSTEM` |
| `NotificationChannel` | `IN_APP`, `PUSH`, `EMAIL`, `SMS`, `WHATSAPP` |
| `NotificationStatus` | `PENDING`, `SENT`, `READ`, `FAILED` |
| `AuditAction` | `CREATE`, `UPDATE`, `DELETE`, `LOGIN`, `LOGOUT`, `LOGIN_FAILED`, `REFRESH_TOKEN_REUSE`, `MODIFY_PRODUCT`, `CHANGE_STATUS`, `PAYMENT`, `REFUND`, `EXPORT`, `PASSWORD_RESET`, `ROLE_CHANGE` |

### 6.3 Objetos de recurso (campos expuestos)

| Recurso | Campos |
|---|---|
| `User` | `id`, `email`, `fullName`, `phone`, `photoUrl`, `status`, `isStaff`, `roles[]`, `permissions[]`, `emailVerifiedAt`, `lastLoginAt`, `createdAt`, `updatedAt`. **Nunca** `passwordHash`, `passwordResetTokenHash` ni tokens. |
| `Business` | `id`, `name`, `legalName`, `logoUrl`, `taxId`, `email`, `phone`, `addressLine1`, `addressLine2`, `city`, `country`, `currencyCode`, `currencySymbol`, `locale`, `timezone`, `taxRateBp`, `taxInclusive`, `serviceFeeBp`, `tipEnabled`, `defaultTipsBp[]`, `maxReservationMinutes`, `chairDefaultPriceMinor`, `allowNegativeStock`, `lowStockAlertThreshold`, `orderPrefix`. |
| `Zone` | `id`, `locationId`, `name`, `code`, `colorHex`, `capacity`, `sortOrder`, `isActive`, `createdAt`, `updatedAt`, `chairCount`, `availableCount`. |
| `Chair` | `id`, `zoneId`, `zoneName`, `code`, `name`, `numberLabel`, `kind`, `capacity`, `pricePerHourMinor`, `status`, `statusChangedAt`, `gridX`, `gridY`, `mapWidth`, `mapHeight`, `rotationDeg`, `features[]`, `notes`, `isBookable`, `isActive`, `createdAt`, `updatedAt`. |
| `Reservation` | `id`, `code`, `businessId`, `locationId`, `zoneId`, `chairId`, `chairCode`, `customerId`, `orderId`, `status`, `startAt`, `endAt`, `durationMinutes`, `pricePerHourMinor`, `rentalTotalMinor`, `checkedInAt`, `checkedOutAt`, `cancelledAt`, `cancelReason`, `source`, `notes`, `createdAt`, `updatedAt`. |
| `Rental` | `id`, `code`, `chairId`, `chairCode`, `reservationId`, `customerId`, `status`, `startAt`, `endAt`, `plannedMinutes`, `billedMinutes`, `pricePerHourMinor`, `subtotalMinor`, `extensionsMinor`, `extraMinutesMinor`, `totalMinor`, `createdAt`, `updatedAt`. |
| `Product` | `id`, `categoryId`, `sku`, `name`, `slug`, `shortDescription`, `description`, `imageUrl`, `basePriceMinor`, `promoPriceMinor`, `promoStartsAt`, `promoEndsAt`, `taxRateBp`, `trackStock`, `isFeatured`, `isAvailable`, `isActive`, `preparationMinutes`, `sortOrder`, `variants[]`, `addons[]`, `stock` (`number`, `null` si no se trackea), `createdAt`, `updatedAt`. |
| `ProductBasic` | `id`, `sku`, `name`, `imageUrl`, `basePriceMinor`, `promoPriceMinor`, `isAvailable`, `isFeatured`, `preparationMinutes`, `categoryId`. Subconjunto devuelto con `?fields=basic`. |
| `OrderItem` | `id`, `productId`, `variantId`, `nameSnapshot`, `skuSnapshot`, `unitPriceMinor`, `quantity`, `discountMinor`, `taxMinor`, `lineTotalMinor`, `notes`, `status`, `preparationMinutes`, `addons[]`, `createdAt`, `updatedAt`. |
| `Order` | `id`, `orderNumber`, `type`, `status`, `channel`, `customerId`, `chairId`, `chairCode`, `reservationId`, `rentalId`, `tableLabel`, `subtotalMinor`, `discountMinor`, `taxMinor`, `serviceFeeMinor`, `totalMinor`, `paidMinor`, `balanceMinor`, `couponCode`, `notes`, `customerNotes`, `items[]`, `payments[]`, `placedAt`, `confirmedAt`, `preparingAt`, `readyAt`, `completedAt`, `cancelledAt`, `cancelReason`, `createdAt`, `updatedAt`. |
| `Payment` | `id`, `paymentNumber`, `orderId`, `method`, `provider`, `providerReference`, `status`, `amountMinor`, `refundedMinor`, `currencyCode`, `referenceNumber`, `receiptNumber`, `notes`, `approvedAt`, `failedAt`, `failureReason`, `createdAt`, `updatedAt`. **Nunca** `metadata` completo ni datos de tarjeta. |
| `InventoryItem` | `id`, `productId`, `ingredientId`, `name`, `sku`, `unit`, `currentStock`, `minStock`, `maxStock`, `costMinor`, `supplier`, `locationStorage`, `isTracked`, `isLowStock`, `createdAt`, `updatedAt`. |
| `InventoryMovement` | `id`, `inventoryItemId`, `inventoryItemName`, `movementType`, `quantity`, `balanceAfter`, `unitCostMinor`, `referenceType`, `referenceId`, `reason`, `performedBy`, `createdAt`. |
| `Discount` | `id`, `code`, `name`, `description`, `type`, `value`, `minOrderMinor`, `maxDiscountMinor`, `appliesTo`, `appliesCategoryId`, `appliesProductId`, `usageLimit`, `usageLimitPerCustomer`, `usedCount`, `startsAt`, `endsAt`, `isActive`, `stackable`, `createdAt`, `updatedAt`. |
| `Notification` | `id`, `type`, `title`, `body`, `channel`, `status`, `data`, `orderId`, `reservationId`, `readAt`, `sentAt`, `createdAt`. |
| `AuditLog` | `id`, `userId`, `userEmail`, `action`, `entityType`, `entityId`, `beforeData`, `afterData`, `ipAddress`, `userAgent`, `requestId`, `createdAt`. |

### 6.4 Convenciones de recursos anidados

- Los paths de ítems anidados siguen el patrón `/{parentId}/{subresource}` y la ruta literal `/{subresource}` cuando la colección se refiere al recurso actual: `GET /rentals/chair/:chairId/active`.
- Las acciones no-CRUD son `POST /{recurso}/:id/{accion}`: `confirm`, `cancel`, `check-in`, `extend`, `complete`, `refund`, `read`, `reorder`, `block`, `unblock`, `maintenance`, `complete-maintenance`, `duplicate`, `adjust`.
- Las acciones son **idempotentes en lectura de estado**: repetir una acción que ya está aplicada devuelve el estado actual con `200` y `meta.warnings: ["ALREADY_APPLIED"]`, no un error, salvo que la máquina de estados lo prohíba explícitamente (BR-ORDER: `COMPLETED -> COMPLETED` es error).

---

## 7. Endpoints

**Total: 157 endpoints.** Todos bajo `/api/v1` salvo `GET /health`.

Convenciones de las tablas de cada sección:

- `Método` y `Path` son exactos.
- `Permiso` es la clave de permiso de `DESIGN.md` sección 9.2, o `PÚBLICO`, o `autenticado` (cualquier usuario con token, con filtro de alcance por propietario en el service).
- Los endpoints de lectura responden `200` salvo `DELETE` de zonas, categorías, productos, descuentos, sillas, locales e inventario, que responden `204`.

### 7.1 Auth — `/api/v1/auth`

| Método | Path | Permiso | Descripción |
|---|---|---|---|
| POST | `/register` | `PÚBLICO` | Crear cuenta de cliente |
| POST | `/login` | `PÚBLICO` | Autenticar |
| POST | `/refresh` | `PÚBLICO` | Rotar refresh token |
| POST | `/logout` | `autenticado` | Revocar la sesión actual |
| POST | `/logout-all` | `autenticado` | Revocar todas las sesiones |
| POST | `/forgot-password` | `PÚBLICO` | Solicitar reseteo |
| POST | `/reset-password` | `PÚBLICO` | Aplicar reseteo |
| POST | `/change-password` | `autenticado` | Cambiar contraseña propia |
| GET | `/me` | `autenticado` | Perfil del actor con permisos |
| PATCH | `/me` | `auth:profile:update` | Actualizar perfil propio |
| GET | `/sessions` | `autenticado` | Listar sesiones activas |
| DELETE | `/sessions/:id` | `autenticado` | Revocar una sesión |

#### POST /api/v1/auth/register

**Body**

| Campo | Tipo | Req. | Reglas |
|---|---|:--:|---|
| `email` | `string` | Sí | Formato email, max 254. Normalizado a minúsculas. `UNIQUE`: si existe, `409 CONFLICT_ERROR` con `details.code = 'EMAIL_TAKEN'`. |
| `password` | `string` | Sí | Min 8, max 72 (límite de bcrypt), al menos una letra y un número. |
| `fullName` | `string` | Sí | Min 2, max 120. |
| `phone` | `string` | No | Regex E.164 `^\+[1-9]\d{7,14}$`. |

**Respuesta 201** — `data: { user: User, accessToken: string, refreshToken: string, tokenType: "Bearer", expiresIn: 900 }`. El usuario creado recibe el rol `CUSTOMER` y `isStaff = false`. `refreshToken` se devuelve **una sola vez**.

**Errores** — `400` (esquema), `409` (`EMAIL_TAKEN`), `429` (5 por hora).

#### POST /api/v1/auth/login

**Body** — `email` (`string`, req., email, max 254), `password` (`string`, req., min 1, max 72). `deviceInfo` (`string`, opc., max 255) y `ipAddress` se toman del request.

**Respuesta 200** — `data: { user: User, accessToken, refreshToken, tokenType: "Bearer", expiresIn: 900, sessionId: integer }`.

**Errores** — `400`, `401` con `details.code` en `INVALID_CREDENTIALS` (mensaje genérico, exista o no el email), `BLOCKED` o `INACTIVE`, `429` (10 por 15 min).

#### POST /api/v1/auth/refresh

**Body** — `refreshToken` (`string`, req., min 32, max 128).

**Respuesta 200** — `data: { accessToken, refreshToken, tokenType: "Bearer", expiresIn: 900, sessionId }`. El refresh anterior queda revocado con `replacedById` apuntando al nuevo.

**Errores** — `400`, `401` con `details.code` en `TOKEN_REVOKED` (reuso detectado: **se revocan todas las sesiones**), `TOKEN_EXPIRED`, `INVALID_TOKEN`, `403` si el usuario quedó `BLOCKED`/`INACTIVE`, `429` (60 por 15 min).

#### POST /api/v1/auth/logout

**Body** — ninguno. Revoca el refresh token cuyo `sid` coincide con el del access token.

**Respuesta 200** — `data: null`, `meta: { requestId, revokedSessions: 1 }`.

**Errores** — `401`. Idempotente: si ya estaba revocado, `200` igual.

#### POST /api/v1/auth/logout-all

**Body** — `currentPassword` (`string`, opt.) para confirmar identidad si el usuario tiene más de una sesión.

**Respuesta 200** — `data: null`, `meta: { requestId, revokedSessions: integer }`.

**Errores** — `401`, `403` si se envía `currentPassword` incorrecta.

#### POST /api/v1/auth/forgot-password

**Body** — `email` (`string`, req., email, max 254).

**Respuesta 200** — `data: null`, `meta: { requestId }`. **Siempre 200**, exista o no la cuenta, para no revelar existencia. `message` genérico: "Si la cuenta existe, enviamos el enlace de restablecimiento".

**Errores** — `400`, `429` (5 por hora).

#### POST /api/v1/auth/reset-password

**Body** — `token` (`string`, req., min 32, max 128), `password` (`string`, req., política de contraseña), `confirmPassword` (`string`, req., debe coincidir).

**Respuesta 200** — `data: null`, `meta: { requestId, sessionsRevoked: integer }`. El token es de un solo uso y se anula; todas las sesiones quedan revocadas.

**Errores** — `400` con `details.code` en `INVALID_RESET_TOKEN` (no existe, expiró o ya se usó) o `PASSWORD_MISMATCH`, `429` (10 por hora).

#### POST /api/v1/auth/change-password

**Body** — `currentPassword` (`string`, req.), `newPassword` (`string`, req., política), `confirmPassword` (`string`, req.).

**Respuesta 200** — `data: null`, `meta: { requestId, sessionsRevoked: integer }`. Revoca **todas** las sesiones salvo opcionalmente la actual vía `keepCurrentSession` (`boolean`, default `true`).

**Errores** — `400` (`PASSWORD_MISMATCH`), `401` (`currentPassword` incorrecta), `422` (`PASSWORD_TOO_WEAK`, `PASSWORD_SAME_AS_CURRENT`), `429` (10 por 15 min).

#### GET /api/v1/auth/me

**Respuesta 200** — `data: User` con `roles[]` y `permissions[]` (la unión de permisos de todos sus roles, lista completa de claves). Permite al frontend controlar navegación sin duplicar la matriz.

**Errores** — `401`.

#### PATCH /api/v1/auth/me

**Body** — `fullName` (`string`, 2-120), `phone` (`string`, E.164), `photoUrl` (`string`, URL http(s), max 500), `password` (`string`, política; requiere `currentPassword`). Al menos un campo.

**Respuesta 200** — `data: User`.

**Errores** — `400`, `401`, `422`, `429`.

#### GET /api/v1/auth/sessions

**Query** — `page`, `pageSize`, `sort` (`createdAt` \| `lastUsedAt`), `order`.

**Respuesta 200** — `data: [{ id, deviceInfo, ipAddress, createdAt, expiresAt, isCurrent }]`, `meta: { page, pageSize, total, requestId }`.

**Errores** — `401`.

#### DELETE /api/v1/auth/sessions/:id

**Body** — ninguno. Solo se puede revocar una sesión propia.

**Respuesta 200** — `data: null`, `meta: { requestId }`. Si la sesión ya estaba revocada, `200` con `meta.warnings: ["ALREADY_REVOKED"]`.

**Errores** — `401`, `404` (la sesión no existe o es de otro usuario), `422` (no se puede revocar la sesión actual: usar `POST /logout`).

---

### 7.2 Users — `/api/v1/users`

| Método | Path | Permiso | Descripción |
|---|---|---|---|
| GET | `/` | `users:read` | Listar usuarios |
| POST | `/` | `users:create` | Crear usuario |
| GET | `/:id` | `users:read` | Ver usuario |
| PATCH | `/:id` | `users:update` | Actualizar usuario |
| DELETE | `/:id` | `users:delete` | Soft delete |
| POST | `/:id/roles` | `users:roles:assign` | Asignar rol |
| DELETE | `/:id/roles/:roleId` | `users:roles:assign` | Quitar rol |
| PATCH | `/:id/status` | `users:status:update` | Cambiar estado |
| POST | `/:id/reset-password` | `users:password:reset` | Reset admin |

#### GET /api/v1/users

**Query** — `role` (`Role`), `status` (`UserStatus`), `q` (email o nombre, 2-100), `isStaff` (`boolean`), `page`, `pageSize`, `sort` (`createdAt` \| `fullName` \| `lastLoginAt`), `order`.

**Respuesta 200** — `data: User[]`, `meta: { page, pageSize, total, requestId }`.

**Errores** — `400`, `401`, `403`, `429`.

#### POST /api/v1/users

**Body** — `email` (req., email, `UNIQUE`), `password` (req., política; si se omite se genera una temporal y se devuelve una sola vez en `meta.temporaryPassword`), `fullName` (req.), `phone` (opc.), `photoUrl` (opc.), `roles` (`Role[]`, req., min 1), `sendInvitation` (`boolean`, default `false`).

**Respuesta 201** — `data: User`, `meta: { requestId, temporaryPassword? }`. Crea las filas en `user_roles` y establece `isStaff = true` si algún rol no es `CUSTOMER`.

**Errores** — `400`, `403` (un MANAGER intenta asignar ADMIN/OWNER), `409` (`EMAIL_TAKEN`), `422` (`ROLE_NOT_FOUND`), `429`.

#### GET /api/v1/users/:id

**Respuesta 200** — `data: User` con `roles[]`, `permissions[]`, `lastLoginAt`, `emailVerifiedAt`.

**Errores** — `401`, `403`, `404`.

#### PATCH /api/v1/users/:id

**Body** — `fullName`, `phone`, `photoUrl`, `email` (nuevo, revalida `UNIQUE`). No se permite cambiar `password` aquí (usar `/reset-password`).

**Respuesta 200** — `data: User`.

**Errores** — `400`, `401`, `403`, `404`, `409` (`EMAIL_TAKEN`).

#### DELETE /api/v1/users/:id

**Body** — ninguno. Soft delete: `deleted_at = now`, `status = INACTIVE`, se revocan todas las sesiones. El histórico (pedidos, pagos, auditoría) se conserva.

**Respuesta 200** — `data: { id, deletedAt, revokedSessions }`.

**Errores** — `401`, `403`, `404`, `422` (`SELF_DELETE_FORBIDDEN`).

#### POST /api/v1/users/:id/roles

**Body** — `roleId` (`integer`, req., `>= 1`).

**Respuesta 200** — `data: { user: User, assignedRoles: Role[] }`. Revoca los refresh tokens del usuario para que el cambio de permisos surta efecto en el siguiente refresh.

**Errores** — `401`, `403`, `404`, `409` (`ROLE_ALREADY_ASSIGNED`), `422` (`LAST_OWNER_PROTECTED`).

#### DELETE /api/v1/users/:id/roles/:roleId

**Respuesta 200** — `data: { userId, roleId, removedAt }`.

**Errores** — `401`, `403`, `404`, `422` (`LAST_OWNER_PROTECTED`, `SELF_ROLE_REMOVAL_FORBIDDEN`).

#### PATCH /api/v1/users/:id/status

**Body** — `status` (`UserStatus`, req.), `reason` (`string`, req. si `status = BLOCKED`, max 500).

**Respuesta 200** — `data: User`. Pasar a `BLOCKED` o `INACTIVE` revoca todas las sesiones del usuario.

**Errores** — `400`, `401`, `403`, `404`, `422` (`SELF_DEACTIVATION_FORBIDDEN`).

#### POST /api/v1/users/:id/reset-password

**Body** — `sendEmail` (`boolean`, default `true`). Si es `false`, devuelve la contraseña temporal en `meta` (una sola vez).

**Respuesta 200** — `data: { userId, sessionsRevoked, temporaryPassword? }`.

**Errores** — `401`, `403`, `404`, `422`.

---

### 7.3 Customers — `/api/v1/customers`

`customers` son usuarios con rol `CUSTOMER`. Los clientes solo acceden a su propio registro (filtro `customerId = auth.userId` en el service).

| Método | Path | Permiso | Descripción |
|---|---|---|---|
| GET | `/` | `customers:read` | Listar clientes |
| GET | `/me` | `autenticado` | Perfil de cliente del actor |
| GET | `/:id` | `customers:read` | Ver cliente |
| PATCH | `/:id` | `customers:update` | Actualizar cliente |
| GET | `/:id/orders` | `customers:read` | Pedidos del cliente |
| GET | `/:id/reservations` | `customers:read` | Reservas del cliente |
| GET | `/:id/rentals` | `customers:read` | Alquileres del cliente |
| GET | `/:id/payments` | `customers:read` | Pagos del cliente |

#### GET /api/v1/customers

**Query** — `q` (email, nombre o teléfono, 2-100), `status` (`UserStatus`), `hasOrders` (`boolean`), `createdFrom`, `createdTo` (ISO), `page`, `pageSize`, `sort` (`createdAt` \| `fullName` \| `lastOrderAt`), `order`.

**Respuesta 200** — `data: [{ id, fullName, email, phone, status, createdAt, lastLoginAt, totalOrders, totalSpentMinor, lastOrderAt }]`, `meta: { page, pageSize, total, requestId }`.

**Errores** — `400`, `401`, `403`, `429`.

#### GET /api/v1/customers/me

**Respuesta 200** — `data: { ...User, stats: { totalOrders, totalSpentMinor, activeReservations, activeRentals } }`.

**Errores** — `401`.

#### GET /api/v1/customers/:id

**Respuesta 200** — `data: { ...User, stats: { totalOrders, totalSpentMinor, firstOrderAt, lastOrderAt, totalReservations, totalRentalMinutes } }`.

**Errores** — `401`, `403`, `404`.

#### PATCH /api/v1/customers/:id

**Body** — `fullName` (2-120), `phone` (E.164), `photoUrl` (URL), `email`. Un cliente solo puede editar su propio registro y no puede cambiar su email (requiere verificación).

**Respuesta 200** — `data: User`.

**Errores** — `400`, `401`, `403`, `404`, `409`.

#### GET /api/v1/customers/:id/orders · /reservations · /rentals · /payments

**Query** — los de su recurso: `status`, `type`, `from`, `to`, `page`, `pageSize`, `sort`, `order`.

**Respuesta 200** — `data: Order[]` | `Reservation[]` | `Rental[]` | `Payment[]` con el envoltorio de paginación estándar.

**Errores** — `400`, `401`, `403`, `404`, `429`.

---

### 7.4 Business — `/api/v1/business`

| Método | Path | Permiso | Descripción |
|---|---|---|---|
| GET | `/` | `business:read` | Configuración del negocio |
| PATCH | `/` | `business:update` | Actualizar configuración |
| GET | `/hours` | `business:read` | Horarios |
| PUT | `/hours` | `business:hours:update` | Reemplazar horarios |
| GET | `/holidays` | `business:read` | Festivos |
| POST | `/holidays` | `business:holidays:manage` | Crear festivo |
| DELETE | `/holidays/:id` | `business:holidays:manage` | Eliminar festivo |

#### GET /api/v1/business

**Respuesta 200** — `data: Business` (campo `defaultTipsBp` como `string[]` en la API; se persiste como CSV).

**Errores** — `401`, `429`.

#### PATCH /api/v1/business

**Body** (todos opc., al menos uno) — `name` (1-150), `legalName`, `logoUrl`, `taxId`, `email`, `phone`, `addressLine1`, `addressLine2`, `city`, `country` (ISO-3166 alpha-2), `currencyCode` (ISO-4217, 3 letras), `currencySymbol` (max 4), `locale` (BCP-47), `timezone` (IANA; cambio afecta el cálculo de reservas → `meta.warnings: ["TIMEZONE_CHANGED"]`), `taxRateBp` (0-10000), `taxInclusive` (bool), `serviceFeeBp` (0-10000), `tipEnabled` (bool), `defaultTipsBp` (`string[]` CSV, ej. `["1000","1500","2000"]`), `maxReservationMinutes` (1-1440), `chairDefaultPriceMinor` (`>= 0`), `allowNegativeStock` (bool), `lowStockAlertThreshold` (`>= 0`), `orderPrefix` (2-8, `[A-Z0-9]`).

**Respuesta 200** — `data: Business`. Registrar en `audit_logs` con `before_data` y `after_data` completos.

**Errores** — `400`, `401`, `403`, `422` (`INVALID_TIMEZONE`, `INVALID_CURRENCY`), `429`.

#### GET /api/v1/business/hours

**Respuesta 200** — `data: [{ id, dayOfWeek (0-6), opensAt "HH:MM", closesAt "HH:MM", isClosed }]` ordenado por `dayOfWeek`. Siempre 7 filas: el seed las crea todas.

**Errores** — `401`, `403`.

#### PUT /api/v1/business/hours

**Body** — `hours`: `array` de exactamente 7 objetos, uno por `dayOfWeek` (0 a 6, sin repetidos), con `opensAt` (`"HH:MM"`, req.), `closesAt` (`"HH:MM"`, req.), `isClosed` (bool, req.). Si `closesAt <= opensAt`, el local cierra de madrugada (válido). Orden irrelevante; el servidor ordena.

**Respuesta 200** — `data: BusinessHours[]` normalizado y ordenado.

**Errores** — `400` (`INCOMPLETE_WEEK` si no llegan 7 días, `DUPLICATE_DAY_OF_WEEK`, `INVALID_TIME_FORMAT`), `401`, `403`.

#### GET /api/v1/business/holidays

**Query** — `from`, `to` (fechas `YYYY-MM-DD`), `includePast` (`boolean`, default `true`).

**Respuesta 200** — `data: [{ id, holidayDate, name, isClosed }]`, `meta: { page, pageSize, total, requestId }`.

**Errores** — `400`, `401`, `403`.

#### POST /api/v1/business/holidays

**Body** — `holidayDate` (`"YYYY-MM-DD"`, req., `UNIQUE` con `business_id`), `name` (1-150, req.), `isClosed` (bool, default `true`).

**Respuesta 201** — `data: { id, holidayDate, name, isClosed }`.

**Errores** — `400`, `401`, `403`, `409` (`HOLIDAY_ALREADY_EXISTS`), `429`.

#### DELETE /api/v1/business/holidays/:id

**Respuesta 200** — `data: { id, deletedAt }`.

**Errores** — `401`, `403`, `404`.

---

### 7.5 Locations — `/api/v1/locations`

| Método | Path | Permiso | Descripción |
|---|---|---|---|
| GET | `/api/v1/locations` | `locations:read` | Listar sedes |
| POST | `/api/v1/locations` | `locations:create` | Crear sede |
| GET | `/api/v1/locations/:id` | `locations:read` | Ver sede |
| PATCH | `/api/v1/locations/:id` | `locations:update` | Actualizar sede |

#### GET /api/v1/locations

**Query** — `isActive` (`boolean`), `q` (nombre, 2-100), `page`, `pageSize`, `sort` (`name` \| `createdAt`), `order`.

**Respuesta 200** — `data: [{ id, name, address, phone, isActive, zonesCount, activeChairsCount, createdAt, updatedAt }]`, `meta: { page, pageSize, total, requestId }`.

**Errores** — `400`, `401`, `403`, `429`.

#### POST /api/v1/locations

**Body** — `name` (1-150, req., `UNIQUE` por negocio), `address` (max 300), `phone` (max 40), `isActive` (bool, default `true`).

**Respuesta 201** — `data: Location`.

**Errores** — `400`, `401`, `403`, `409` (`LOCATION_NAME_TAKEN`), `429`.

#### GET /api/v1/locations/:id

**Respuesta 200** — `data: { ...Location, zones: Zone[], stats: { totalChairs, availableChairs, occupiedChairs } }`.

**Errores** — `401`, `403`, `404`.

#### PATCH /api/v1/locations/:id

**Body** — `name`, `address`, `phone`, `isActive`. Desactivar una sede (`isActive = false`) impide nuevos pedidos, reservas y alquileres en ella, pero **no** cancela los existentes.

**Respuesta 200** — `data: Location`, `meta.warnings: ["EXISTING_BOOKINGS_KEPT"]` si había pedidos o reservas activos.

**Errores** — `400`, `401`, `403`, `404`, `409`.

---

### 7.6 Zones — `/api/v1/zones`

| Método | Path | Permiso | Descripción |
|---|---|---|---|
| GET | `/` | `zones:read` | Listar zonas por sede |
| POST | `/` | `zones:create` | Crear zona |
| GET | `/:id` | `zones:read` | Ver zona |
| PATCH | `/:id` | `zones:update` | Actualizar zona |
| DELETE | `/:id` | `zones:delete` | Soft delete |
| POST | `/reorder` | `zones:update` | Reordenar |

#### GET /api/v1/zones

**Query** — `locationId` (`integer`, req., filtro principal), `isActive` (bool), `includeInactive` (bool, default `false`), `q` (nombre, 2-100), `page`, `pageSize`, `sort` (`sortOrder` \| `name` \| `capacity`), `order`.

**Respuesta 200** — `data: Zone[]` con `chairCount`, `availableCount` y `countsByStatus` por zona, `meta: { page, pageSize, total, requestId }`.

**Errores** — `400` (`locationId` ausente), `401`, `403`, `429`.

#### POST /api/v1/zones

**Body** — `locationId` (`integer`, req., debe existir y estar activa), `name` (1-100, req., `UNIQUE` por sede), `code` (max 8, `UNIQUE` por negocio, `[A-Z0-9]`), `colorHex` (regex `^#[0-9A-Fa-f]{6}$`, default `#6B7280`), `capacity` (`>= 0`, default 0; si se omite, se calcula de las sillas), `sortOrder` (default = `max(sort_order) + 1`), `isActive` (bool, default `true`).

**Respuesta 201** — `data: Zone`.

**Errores** — `400`, `401`, `403`, `404` (sede inexistente), `409` (`ZONE_NAME_TAKEN`, `ZONE_CODE_TAKEN`).

#### GET /api/v1/zones/:id

**Respuesta 200** — `data: { ...Zone, location: { id, name }, chairs: Chair[], countsByStatus: { AVAILABLE, OCCUPIED, RESERVED, BLOCKED, MAINTENANCE, CLEANING } }`.

**Errores** — `401`, `403`, `404`.

#### PATCH /api/v1/zones/:id

**Body** — `name`, `code`, `colorHex`, `sortOrder`, `isActive`. `capacity` es de solo lectura (se recalcula de las sillas); si se envía, se ignora con `meta.warnings: ["CAPACITY_IS_DERIVED"]`.

**Respuesta 200** — `data: Zone`.

**Errores** — `400`, `401`, `403`, `404`, `409`.

#### DELETE /api/v1/zones/:id

**Body** — ninguno. Soft delete. No se permite si tiene sillas activas: `422 BUSINESS_RULE_ERROR` con `code: 'ZONE_NOT_EMPTY'`, `details.chairCount`.

**Respuesta 200** — `data: { id, deletedAt }`.

**Errores** — `401`, `403`, `404`, `422` (`ZONE_NOT_EMPTY`).

#### POST /api/v1/zones/reorder

**Body** — `locationId` (`integer`, req.), `items`: `array` req. de `{ id: integer, sortOrder: integer >= 0 }`. Puede ser parcial: solo se actualizan los indicados. Se ejecuta en una transacción.

**Respuesta 200** — `data: Zone[]` reordenadas.

**Errores** — `400` (`DUPLICATE_ID`, `ZONE_LOCATION_MISMATCH`), `401`, `403`, `404`.

---

### 7.7 Chairs — `/api/v1/chairs`

Una sola entidad para silla, mesa, barra y salón, vía `kind`. Los códigos son únicos globales.

| Método | Path | Permiso | Descripción |
|---|---|---|---|
| GET | `/` | `chairs:read` | Listar sillas |
| GET | `/map` | `chairs:map` | Mapa con zonas y contadores |
| POST | `/` | `chairs:create` | Crear silla |
| GET | `/:id` | `chairs:read` | Ver silla |
| PATCH | `/:id` | `chairs:update` | Actualizar silla |
| DELETE | `/:id` | `chairs:delete` | Soft delete |
| PATCH | `/:id/status` | `chairs:status:update` | Cambiar estado |
| GET | `/:id/availability` | `chairs:read` | Ocupación por rango |
| GET | `/:id/history` | `chairs:history:read` | Historial de uso |
| POST | `/:id/block` | `chairs:status:update` | Bloquear |
| POST | `/:id/unblock` | `chairs:status:update` | Desbloquear |
| POST | `/:id/maintenance` | `chairs:status:update` | Enviar a mantenimiento |
| POST | `/:id/complete-maintenance` | `chairs:status:update` | Cerrar mantenimiento |

#### GET /api/v1/chairs

**Query** — `locationId` (integer, req.), `zoneId` (integer), `status` (`ChairStatus`), `kind` (`ChairKind`), `q` (`code` o `name`, 2-50), `isBookable` (bool), `includeInactive` (bool, default `false`), `page`, `pageSize` (default 100 en este endpoint, máximo 200), `sort` (`code` \| `name` \| `capacity` \| `pricePerHourMinor` \| `statusChangedAt` \| `sortOrder`), `order`.

**Respuesta 200** — `data: Chair[]` ordenadas por zona y grilla, `meta: { page, pageSize, total, requestId, countsByStatus: { AVAILABLE, OCCUPIED, RESERVED, BLOCKED, MAINTENANCE, CLEANING } }`.

**Errores** — `400`, `401`, `403`, `429`.

#### GET /api/v1/chairs/map

**Query** — `locationId` (integer, req.), `zoneId` (integer, opc., filtra el mapa a una zona), `includeInactive` (bool, default `false`).

**Respuesta 200** — `data: { location: { id, name }, zones: [{ ...Zone, bounds: { minX, minY, maxX, maxY }, chairs: Chair[] }], countsByStatus: { ... }, totals: { chairs, available, occupied, reserved, blocked, maintenance, cleaning, capacity } }`, `meta: { requestId, generatedAt }`. Todo lo necesario para pintar el plano sin cálculos adicionales en el cliente.

**Errores** — `400`, `401`, `403`, `429` (120 por minuto).

#### POST /api/v1/chairs

**Body** — `zoneId` (integer, req., debe existir y estar activa), `code` (req., 2-30, `[A-Z0-9-]`, `UNIQUE` global, no reutilizable tras baja), `name` (max 100), `numberLabel` (max 20), `kind` (`ChairKind`, default `CHAIR`), `capacity` (1-50, default 1), `pricePerHourMinor` (integer `>= 0`; default = `businesses.chairDefaultPriceMinor`), `gridX` (0-1000, default 0), `gridY` (0-1000, default 0), `mapWidth` (1-20, default 1), `mapHeight` (1-20, default 1), `rotationDeg` (0 \| 90 \| 180 \| 270, default 0), `features` (`string[]` de `wifi` \| `outlet` \| `view` \| `accessible` \| `tv` \| `quiet`, default `[]`), `notes` (max 500), `isBookable` (bool, default `true`), `isActive` (bool, default `true`).

**Respuesta 201** — `data: Chair` con `status = AVAILABLE` siempre. Recalcula `zones.capacity`.

**Errores** — `400`, `401`, `403`, `404` (zona inexistente), `409` (`CHAIR_CODE_TAKEN`), `429`.

#### GET /api/v1/chairs/:id

**Respuesta 200** — `data: { ...Chair, zone: { id, name, colorHex }, currentReservation: Reservation | null, currentRental: Rental | null, stats: { totalReservations, totalRentalMinutes, totalRevenueMinor, utilizationRate } }`.

**Errores** — `401`, `403`, `404`.

#### PATCH /api/v1/chairs/:id

**Body** — `zoneId`, `name`, `numberLabel`, `kind`, `capacity`, `pricePerHourMinor`, `gridX`, `gridY`, `mapWidth`, `mapHeight`, `rotationDeg`, `features`, `notes`, `isBookable`, `isActive`. `status` y `code` se gestionan por otros endpoints: `code` solo si la silla no tiene historial, `status` solo por los endpoints de acción. Enviar cualquiera de los dos da `422` con `code: 'FIELD_NOT_EDITABLE'`.

Cambiar `pricePerHourMinor` **no** altera reservas ni alquileres existentes (BR-PRICE-010); el `meta.warnings` lo señala: `["PRICE_CHANGE_AFFECTS_ONLY_NEW"]`.

**Respuesta 200** — `data: Chair`.

**Errores** — `400`, `401`, `403`, `404`, `409` (`CHAIR_CODE_TAKEN`), `422` (`CHAIR_CODE_IMMUTABLE`, `FIELD_NOT_EDITABLE`, `CHAIR_IN_USE` si está `OCCUPIED` y se cambia `zoneId`).

#### DELETE /api/v1/chairs/:id

**Body** — `reason` (`string`, req., max 300). Soft delete. Bloqueado si la silla está `OCCUPIED`: `422` con `code: 'CHAIR_IN_USE'`. Requiere cerrar antes el alquiler.

**Respuesta 200** — `data: { id, deletedAt, reason }`. Las reservas futuras no se cancelan: quedan como histórico y el frontend debe avisar.

**Errores** — `400`, `401`, `403`, `404`, `422` (`CHAIR_IN_USE`).

#### PATCH /api/v1/chairs/:id/status

**Body** — `status` (`AVAILABLE` \| `BLOCKED` \| `MAINTENANCE` \| `CLEANING`, req.), `reason` (`string`, req. si `BLOCKED` o `MAINTENANCE`, max 300).

Rechaza `OCCUPIED` y `RESERVED` con `422` y `code: 'INVALID_CHAIR_STATUS_TRANSITION'` (BR-CHAIR-003). Valida la transición contra la máquina de estados de `DESIGN.md` 6.4.

**Respuesta 200** — `data: Chair` con `statusChangedAt` actualizado.

**Errores** — `400`, `401`, `403`, `404`, `422` (`INVALID_CHAIR_STATUS_TRANSITION`, `CHAIR_HAS_ACTIVE_BOOKING`).

#### GET /api/v1/chairs/:id/availability

**Query** — `from` (ISO, req.), `to` (ISO, req., `> from`), `granularityMinutes` (15 \| 30 \| 60, default 30).

**Respuesta 200** — `data: { chairId, code, from, to, totalMinutes, bookedMinutes, availableMinutes, utilizationRate, slots: [{ startAt, endAt, status, reservationId, reservationCode, rentalId }] }`. `status` de cada slot: `FREE`, `RESERVED`, `OCCUPIED`, `BLOCKED`, `MAINTENANCE`, `CLEANING`. Extremos que se tocan no se marcan ocupados (BR-RES-001).

**Errores** — `400` (`INVALID_DATE_RANGE`, rango máximo 31 días), `401`, `403`, `404`.

#### GET /api/v1/chairs/:id/history

**Query** — `from`, `to` (ISO; default últimos 30 días), `type` (`reservation` \| `rental`), `page`, `pageSize`, `sort` (`startAt` \| `endAt` \| `durationMinutes` \| `revenueMinor`), `order`.

**Respuesta 200** — `data: [{ id, type, code, status, startAt, endAt, durationMinutes, billedMinutes, totalMinor, customerId, customerName }]`, `meta: { page, pageSize, total, requestId, totals: { sessions, totalMinutes, totalRevenueMinor } }`.

**Errores** — `400`, `401`, `403` (`chairs:history:read` es CASHIER+), `404`.

#### POST /api/v1/chairs/:id/block

**Body** — `reason` (`string`, req., max 300), `until` (ISO, opc.; si se envía, el scheduler la desbloquea).

**Respuesta 200** — `data: Chair` con `status = BLOCKED`. Rechazado si está `OCCUPIED`: `409` con `code: 'CHAIR_OCCUPIED'`.

**Errores** — `400`, `401`, `403`, `404`, `409` (`CHAIR_OCCUPIED`), `422`.

#### POST /api/v1/chairs/:id/unblock

**Body** — ninguno.

**Respuesta 200** — `data: Chair` con `status = AVAILABLE` (o `RESERVED` si hay una reserva confirmada que empieza ahora o antes).

**Errores** — `401`, `403`, `404`, `422` (`CHAIR_NOT_BLOCKED`).

#### POST /api/v1/chairs/:id/maintenance

**Body** — `reason` (`string`, req., max 300), `estimatedEndAt` (ISO, opc.).

**Respuesta 200** — `data: Chair` con `status = MAINTENANCE`. Las reservas futuras en la silla no se cancelan automáticamente; se listan en `meta.affectedReservations`.

**Errores** — `400`, `401`, `403`, `404`, `409` (`CHAIR_OCCUPIED`).

#### POST /api/v1/chairs/:id/complete-maintenance

**Body** — `notes` (`string`, opc., max 300), `needsCleaning` (`boolean`, default `true`).

**Respuesta 200** — `data: Chair` con `status = CLEANING` si `needsCleaning`, si no `AVAILABLE`. Idempotente: si ya está fuera de `MAINTENANCE`, `200` con `meta.warnings: ["ALREADY_APPLIED"]`.

**Errores** — `401`, `403`, `404`, `422` (`CHAIR_NOT_IN_MAINTENANCE`).

---

### 7.8 Reservations — `/api/v1/reservations`

| Método | Path | Permiso | Descripción |
|---|---|---|---|
| GET | `/` | `reservations:read` | Listar reservas |
| GET | `/quote` | `reservations:read` | Cotizar precio |
| POST | `/` | `reservations:create` | Crear reserva |
| GET | `/:id` | `reservations:read` | Ver reserva |
| POST | `/:id/confirm` | `reservations:update` | Confirmar |
| POST | `/:id/cancel` | `reservations:cancel` | Cancelar |
| POST | `/:id/check-in` | `reservations:checkin` | Check-in |
| POST | `/:id/extend` | `reservations:extend` | Extender |
| POST | `/:id/complete` | `reservations:checkin` | Check-out |

#### GET /api/v1/reservations

**Query** — `from`, `to` (ISO, req. para acotar), `chairId` (integer), `zoneId` (integer), `locationId` (integer), `customerId` (integer; un `CUSTOMER` solo ve los suyos y el filtro se ignora si envía otro id), `status` (`ReservationStatus`; acepta un solo valor), `code` (string, `RES-` + 6-12 dígitos), `page`, `pageSize`, `sort` (`startAt` \| `createdAt` \| `rentalTotalMinor` \| `status`), `order`.

**Respuesta 200** — `data: Reservation[]` con `chairCode`, `customerName`, `zoneName`, `meta: { page, pageSize, total, requestId, countsByStatus }`.

**Errores** — `400`, `401`, `403`, `429`.

#### GET /api/v1/reservations/quote

**Query** — `chairId` (integer, req.), `startAt` (ISO, req.), `endAt` (ISO, req., `> startAt`), `applyCouponCode` (`string`, opc.).

**Respuesta 200** — `data: { chair: { id, code, name, kind, capacity, pricePerHourMinor, features[] }, zone: { id, name, colorHex }, startAt, endAt, durationMinutes, billableMinutes, minApplied, pricePerHourMinor, subtotalMinor, discountMinor, taxMinor, serviceFeeMinor, totalMinor, taxRateBp, isAvailable, conflict: Reservation | null, appliedRules: ["BR-RENTAL-001","BR-RENTAL-002","BR-TAX-002"] }`, `meta: { requestId }`. No crea nada. `billableMinutes` ya aplica el mínimo de 30 min. Si hay conflicto, `isAvailable = false` y `conflict` trae la reserva que estorba (200, no 409: es una consulta).

**Errores** — `400` (`INVALID_DATE_RANGE`, `RESERVATION_TOO_LONG`), `401`, `403`, `404` (silla inexistente o no reservable).

#### POST /api/v1/reservations

**Body** — `chairId` (integer, req.), `startAt` (ISO, req., no en el pasado más de 5 min), `endAt` (ISO, req., `> startAt`, duración `<= maxReservationMinutes`), `customerId` (integer, opc.; default = el actor si es `CUSTOMER`, si no es obligatorio para reservas de cliente), `notes` (max 500), `notes` de reserva, `source` (`CUSTOMER` \| `STAFF` \| `ADMIN`, default según el rol), `sendNotification` (bool, default `true`), `createOrder` (bool, default `false`: materializa un `order` tipo `CHAIR_RENTAL` en `PENDING`).

No se envía `durationMinutes`, `pricePerHourMinor` ni `rentalTotalMinor`: los calcula el servidor.

**Respuesta 201** — `data: Reservation` con `code`, `status = PENDING`, `durationMinutes`, `pricePerHourMinor` (congelado), `rentalTotalMinor` (proyección). `meta: { requestId, appliedRules }`.

**Errores** — `400` (`INVALID_DATE_RANGE`, `PAST_DATE`), `401`, `403`, `404` (silla inexistente), `409` (`CHAIR_ALREADY_RESERVED` con `details.conflictingReservationCode`, `conflictingStartAt`, `conflictingEndAt`), `422` (`CHAIR_NOT_BOOKABLE`, `RESERVATION_TOO_LONG`, `INVALID_ADVANCE_TIME`), `429`.

#### GET /api/v1/reservations/:id

**Respuesta 200** — `data: { ...Reservation, chair: { id, code, name, kind, features[], pricePerHourMinor }, zone, location, customer: { id, fullName, phone } | null, rental: Rental | null, order: Order | null, timeline: [{ at, event, userId, userName }] }`.

**Errores** — `401`, `403`, `404`.

#### POST /api/v1/reservations/:id/confirm

**Body** — ninguno. `PENDING -> CONFIRMED`. Revalida solapamiento **dentro de la transacción**; la silla pasa a `RESERVED`. Idempotente si ya está `CONFIRMED`.

**Respuesta 200** — `data: Reservation` con `status = CONFIRMED`.

**Errores** — `401`, `403`, `404`, `409` (`CHAIR_ALREADY_RESERVED` si otra reserva se adelantó, `INVALID_RESERVATION_TRANSITION`), `422`.

#### POST /api/v1/reservations/:id/cancel

**Body** — `reason` (`string`, req., max 500), `refundPayment` (`boolean`, default `true` si el pedido tiene pagos aprobados), `notifyCustomer` (bool, default `true`).

**Respuesta 200** — `data: { ...Reservation, status: 'CANCELLED', refund: { amountMinor, paymentId } | null }`. Libera la silla.

**Errores** — `400`, `401`, `403` (`reservations:cancel`: `STAFF` no puede), `404`, `422` (`INVALID_RESERVATION_TRANSITION` si ya está `COMPLETED`, `CANCELLED` o `EXPIRED`).

#### POST /api/v1/reservations/:id/check-in

**Body** — `actualStartAt` (ISO, opc.; default `now`), `notes` (max 500), `createOrder` (bool, default `true`).

`PENDING`/`CONFIRMED` -> `ACTIVE`. Crea `chair_rentals` con `price_per_hour_minor` congelado, pone la silla en `OCCUPIED` y materializa el pedido si se pidió.

**Respuesta 200** — `data: { reservation: Reservation, rental: Rental, order: Order | null, chair: Chair }`.

**Errores** — `400`, `401`, `403`, `404`, `409` (`CHAIR_OCCUPIED`), `422` (`RESERVATION_NOT_IN_WINDOW`, `INVALID_RESERVATION_TRANSITION`).

#### POST /api/v1/reservations/:id/extend

**Body** — `newEndAt` (ISO, req., `> end_at` actual).

**Respuesta 200** — `data: Reservation` con `endAt`, `durationMinutes` y `rentalTotalMinor` recalculados. `pricePerHourMinor` no cambia. No disponible si la reserva ya está `ACTIVE` (usar `POST /rentals/:id/extend`): `422` con `code: 'RESERVATION_ALREADY_ACTIVE'`.

**Errores** — `400`, `401`, `403`, `404`, `409` (`CHAIR_ALREADY_RESERVED` si la ventana nueva choca con otra reserva o alquiler), `422`.

#### POST /api/v1/reservations/:id/complete

**Body** — `endAt` (ISO, opc.; default `now` = check-out), `notes` (max 500), `reportIssue` (`string`, opc., max 300: `NO_SHOW`, `ABANDONED`, `OTHER`).

`ACTIVE` -> `COMPLETED`. Cierra el alquiler con `billedMinutes` reales y `extraMinutesMinor` a precio congelado (BR-RENTAL-003/004). Si hay `overage > 0` y no existe un pedido abierto para el cobro, lo crea en `PENDING` con `type = CHAIR_RENTAL`.

**Respuesta 200** — `data: { reservation: Reservation, rental: Rental, order: Order | null, charge: { billedMinutes, minimumApplied, subtotalMinor, extensionsMinor, extraMinutesMinor, totalMinor, taxMinor, grandTotalMinor, currencyCode } }`, `meta: { requestId, appliedRules: ["BR-RENTAL-001","BR-RENTAL-002","BR-RENTAL-003","BR-RENTAL-004"] }`.

**Errores** — `400`, `401`, `403`, `404`, `422` (`INVALID_RESERVATION_TRANSITION`).

---

### 7.9 Rentals — `/api/v1/rentals`

| Método | Path | Permiso | Descripción |
|---|---|---|---|
| GET | `/` | `rentals:read` | Listar alquileres |
| GET | `/active` | `rentals:read` | Alquileres activos |
| GET | `/chair/:chairId/active` | `rentals:read` | Alquiler activo de una silla |
| POST | `/` | `rentals:create` | Abrir alquiler walk-in |
| GET | `/:id` | `rentals:read` | Ver alquiler |
| POST | `/:id/extend` | `rentals:extend` | Extender |
| POST | `/:id/complete` | `rentals:complete` | Cerrar y cobrar |

#### GET /api/v1/rentals

**Query** — `status` (`RentalStatus`), `chairId`, `zoneId`, `locationId`, `customerId`, `from`, `to`, `page`, `pageSize`, `sort` (`startAt` \| `endAt` \| `totalMinor` \| `billedMinutes`), `order`.

**Respuesta 200** — `data: Rental[]` con `chairCode`, `customerName`, `zoneName`, `meta: { page, pageSize, total, requestId, countsByStatus }`.

**Errores** — `400`, `401`, `403`, `429`.

#### GET /api/v1/rentals/active

**Query** — `locationId` (opc.), `zoneId` (opc.), `page`, `pageSize`, `sort` (`startAt` \| `endAt`), `order`.

**Respuesta 200** — `data: Rental[]` solo con `status IN ('ACTIVE','EXTENDED')`, cada uno con `elapsedMinutes`, `remainingMinutes`, `overtimeMinutes`, `chairCode`, `customerName`.

**Errores** — `400`, `401`, `403`, `429`.

#### GET /api/v1/rentals/chair/:chairId/active

**Respuesta 200** — `data: Rental | null` (con `chair`, `customer`, `reservation`, `order`, `elapsedMinutes`, `overtimeMinutes`, `currentCharge`). `data = null` con `200` si no hay alquiler activo: no es un `404`.

**Errores** — `401`, `403`, `404` (la silla no existe).

#### POST /api/v1/rentals

**Body** — `chairId` (integer, req.), `plannedMinutes` (1-1440, default 60), `customerId` (integer, opc.), `reservationId` (integer, opc.: si la reserva está `CONFIRMED`, se hace check-in implícito), `discountCode` (string, opc.), `notes` (max 500), `applyTax` (bool, default `true`).

No se envía `startAt` ni `pricePerHourMinor`: el servidor usa `now` y **congela** `chairs.price_per_hour_minor`.

**Respuesta 201** — `data: { rental: Rental, chair: Chair, order: Order, reservation: Reservation | null }`. La silla queda `OCCUPIED` con `statusChangedAt = now`. El pedido creado está en `PENDING` con `type = CHAIR_RENTAL`, `chairId` y `reservationId` (BR-ORDER-008).

**Errores** — `400`, `401`, `403`, `404`, `409` (`CHAIR_OCCUPIED` con `details.activeRentalCode`), `422` (`CHAIR_NOT_BOOKABLE`, `CHAIR_BLOCKED`, `RESERVATION_NOT_ACTIVE`, `DISCOUNT_*`), `429`.

#### GET /api/v1/rentals/:id

**Respuesta 200** — `data: { ...Rental, chair, zone, customer | null, reservation | null, order | null, extensions: [{ id, requestedMinutes, previousEndAt, newEndAt, additionalMinor, reason, createdAt, createdBy }], elapsedMinutes, overtimeMinutes, currentCharge }`.

**Errores** — `401`, `403`, `404`.

#### POST /api/v1/rentals/:id/extend

**Body** — `additionalMinutes` (integer, 5-1440, req.), `reason` (string, opc., max 300).

**Respuesta 200** — `data: { rental: Rental, extension: { id, requestedMinutes, previousEndAt, newEndAt, additionalMinor, pricePerHourMinor }, order: Order }`. El cobro se suma a `orders.balance_minor` del pedido abierto. Revalida que la ventana nueva no choque con otra reserva o alquiler.

**Errores** — `400`, `401`, `403`, `404`, `409` (`CHAIR_ALREADY_RESERVED`), `422` (`RENTAL_NOT_ACTIVE`, `EXTENSION_TOO_LONG`).

#### POST /api/v1/rentals/:id/complete

**Body** — `endAt` (ISO, opc.; default `now`), `notes` (max 500), `discountCode` (string, opc.), `waiveOvertime` (`boolean`, default `false`; requiere MANAGER y motivo), `waiveReason` (string, req. si `waiveOvertime`).

Calcula `billedMinutes = max(30, ceil((endAt - startAt) / 60000))`, `extraMinutesMinor` a precio congelado, actualiza el pedido y pasa la silla a `CLEANING`.

**Respuesta 200** — `data: { rental: Rental, order: Order, chair: Chair, charge: { plannedMinutes, billedMinutes, minimumApplied, overtimeMinutes, pricePerHourMinor, subtotalMinor, extensionsMinor, extraMinutesMinor, waivedMinor, discountMinor, taxMinor, serviceFeeMinor, totalMinor, currencyCode } }`, `meta: { requestId, appliedRules }`.

**Errores** — `400`, `401`, `403`, `404`, `422` (`RENTAL_NOT_ACTIVE`, `RENTAL_END_BEFORE_START`).

---

### 7.10 Categories — `/api/v1/categories`

| Método | Path | Permiso | Descripción |
|---|---|---|---|
| GET | `/` | `categories:read` | Listar categorías |
| POST | `/` | `categories:create` | Crear categoría |
| GET | `/:id` | `categories:read` | Ver categoría |
| PATCH | `/:id` | `categories:update` | Actualizar categoría |
| DELETE | `/:id` | `categories:delete` | Soft delete |
| POST | `/reorder` | `categories:update` | Reordenar |

#### GET /api/v1/categories

**Query** — `isActive` (bool), `includeInactive` (bool, default `false`), `includeProductCount` (bool, default `true`), `q` (nombre, 2-100), `page`, `pageSize` (default 50, máximo 200), `sort` (`sortOrder` \| `name` \| `createdAt`), `order`.

**Respuesta 200** — `data: [{ id, name, slug, description, imageUrl, icon, sortOrder, isActive, productCount, activeProductCount, createdAt, updatedAt }]`, `meta: { page, pageSize, total, requestId }`.

**Errores** — `400`, `401`, `403`, `429`.

#### POST /api/v1/categories

**Body** — `name` (1-100, req.), `slug` (max 120, opc.; si se omite se genera del nombre y se normaliza), `description` (max 1000), `imageUrl` (URL), `icon` (max 50), `sortOrder` (`>= 0`, default = `max + 1`), `isActive` (bool, default `true`).

**Respuesta 201** — `data: Category`. `UNIQUE(business_id, slug)`: duplicado da `409` con `code: 'CATEGORY_SLUG_TAKEN'`.

**Errores** — `400` (`INVALID_SLUG`), `401`, `403`, `409`, `429`.

#### GET /api/v1/categories/:id

**Respuesta 200** — `data: { ...Category, products: ProductBasic[] }` (productos activos de la categoría, paginados internamente a 50).

**Errores** — `401`, `403`, `404`.

#### PATCH /api/v1/categories/:id

**Body** — `name`, `slug`, `description`, `imageUrl`, `icon`, `sortOrder`, `isActive`.

**Respuesta 200** — `data: Category`.

**Errores** — `400`, `401`, `403`, `404`, `409`.

#### DELETE /api/v1/categories/:id

**Body** — `reason` (string, opc., max 300). Soft delete. Los productos quedan con `categoryId = null` (`ON DELETE SET NULL`), no se borran.

**Respuesta 200** — `data: { id, deletedAt, orphanedProducts }`.

**Errores** — `401`, `403`, `404`, `422` (`CATEGORY_HAS_PRODUCTS` si `orphanedProducts > 0` y se omite `confirmOrphan = true`).

#### POST /api/v1/categories/reorder

**Body** — `items`: `array` req. de `{ id: integer, sortOrder: integer >= 0 }`. Transaccional.

**Respuesta 200** — `data: Category[]` reordenadas.

**Errores** — `400` (`DUPLICATE_ID`), `401`, `403`, `404`.

---

### 7.11 Products — `/api/v1/products`

| Método | Path | Permiso | Descripción |
|---|---|---|---|
| GET | `/` | `products:read` | Listar productos |
| POST | `/` | `products:create` | Crear producto |
| GET | `/:id` | `products:read` | Ver producto |
| PATCH | `/:id` | `products:update` | Actualizar producto |
| DELETE | `/:id` | `products:delete` | Soft delete |
| PATCH | `/:id/availability` | `products:availability:update` | Marcar disponible/no |
| PATCH | `/:id/active` | `products:update` | Activar/desactivar |
| POST | `/:id/duplicate` | `products:duplicate` | Duplicar |
| GET | `/:id/variants` | `products:read` | Listar variantes |
| POST | `/:id/variants` | `products:update` | Crear variante |
| PATCH | `/variants/:variantId` | `products:update` | Actualizar variante |
| DELETE | `/variants/:variantId` | `products:update` | Eliminar variante |
| GET | `/:id/addons` | `products:read` | Listar complementos |
| POST | `/:id/addons` | `products:update` | Crear complemento |
| PATCH | `/addons/:addonId` | `products:update` | Actualizar complemento |
| DELETE | `/addons/:addonId` | `products:update` | Eliminar complemento |
| GET | `/:id/ingredients` | `products:read` | Listar receta |
| POST | `/:id/ingredients` | `products:update` | Añadir a la receta |
| DELETE | `/:id/ingredients/:ingredientId` | `products:update` | Quitar de la receta |

#### GET /api/v1/products

**Query** — `categoryId` (integer), `q` (nombre, SKU o descripción, 2-100), `featured` (bool), `available` (bool), `trackStock` (bool), `isActive` (bool, default `true`), `includeInactive` (bool, default `false`), `minPrice`, `maxPrice` (centavos, `>= 0`), `inStockOnly` (bool), `fields` (`basic` \| `full`, default `full`), `page`, `pageSize` (default 20, máximo 100), `sort` (`sortOrder` \| `name` \| `basePriceMinor` \| `createdAt` \| `preparationMinutes`), `order`.

**Optimización `fields=basic`**: devuelve `ProductBasic[]` con solo 10 columnas, pensado para la pantalla del POS con catálogo grande. Mantiene la respuesta por debajo de 200 KB con 500 productos. No acepta parámetros de orden distintos a los de la versión completa.

**Respuesta 200** — `data: Product[]` o `ProductBasic[]`, `meta: { page, pageSize, total, requestId, categories?: [{ id, name, count }] }`.

**Errores** — `400` (`INVALID_SORT_FIELD`), `401`, `403`, `429`.

#### POST /api/v1/products

**Body** — `categoryId` (integer, opc.), `sku` (req., 1-50, `UNIQUE`), `name` (req., 1-150), `slug` (opc.; default derivado de `name`), `shortDescription` (max 200), `description` (max 4000), `imageUrl` (URL), `basePriceMinor` (integer `>= 0`, req.), `promoPriceMinor` (int `>= 0`, opc., debe ser `< basePriceMinor`), `promoStartsAt` / `promoEndsAt` (ISO; ambas o ninguna, `endsAt > startsAt`), `taxRateBp` (0-10000, opc.; null = hereda el del negocio), `trackStock` (bool, default `false`), `isFeatured` (bool, default `false`), `isAvailable` (bool, default `true`), `preparationMinutes` (0-240, default 5), `sortOrder` (`>= 0`, default = `max + 1`), `isActive` (bool, default `true`), `variants` (`array` opc. de variantes, se crean junto al producto), `addons` (`array` opc. de complementos).

**Respuesta 201** — `data: Product` completo con `variants[]`, `addons[]`, `stock` (null si no se trackea).

**Errores** — `400` (`INVALID_SLUG`, `PROMO_PRICE_NOT_LOWER`, `PROMO_WINDOW_INVALID`), `401`, `403`, `404` (categoría inexistente), `409` (`PRODUCT_SKU_TAKEN`, `PRODUCT_SLUG_TAKEN`), `422`, `429` (60 por hora).

#### GET /api/v1/products/:id

**Respuesta 200** — `data: { ...Product, category, variants[], addons[], ingredients: [{ ingredientId, name, unit, quantity, costMinor }], stock: { currentStock, minStock, maxStock, isTracked, isLowStock } | null, priceHistory: [] }`.

**Errores** — `401`, `403`, `404`.

#### PATCH /api/v1/products/:id

**Body** — cualquiera de los campos de creación, excepto `sku` (inmutable en v1: para reutilizar un SKU hay que dar de baja el producto y crear uno nuevo) e `isAvailable` (endpoint dedicado). Cambiar `basePriceMinor` no altera pedidos existentes, porque los `order_items` guardan snapshot (BR-PRICE-004).

**Respuesta 200** — `data: Product`, `meta.warnings: ["PRICE_CHANGE_AFFECTS_ONLY_NEW"]` si se cambió el precio.

**Errores** — `400`, `401`, `403`, `404`, `409`, `422`, `429`.

#### DELETE /api/v1/products/:id

**Body** — `reason` (string, opc., max 300). Soft delete. Los `order_items` existentes conservan sus snapshots y quedan con `productId = null`.

**Respuesta 200** — `data: { id, deletedAt, affectedOrderItems }`.

**Errores** — `401`, `403`, `404`, `422`.

#### PATCH /api/v1/products/:id/availability

**Body** — `isAvailable` (`boolean`, req.), `reason` (string, opc., max 300; p. ej. `AGOTADO`, `FUERA_DE_TEMPORADA`).

No cambia `isActive`: son conceptos distintos (BR-PRICE-006). Un producto no disponible sigue en el catálogo y se puede reactivar.

**Respuesta 200** — `data: Product` con `isAvailable` actualizado.

**Errores** — `400`, `401`, `403`, `404`, `429`.

#### PATCH /api/v1/products/:id/active

**Body** — `isActive` (`boolean`, req.), `reason` (string, opc., max 300).

**Respuesta 200** — `data: Product`.

**Errores** — `400`, `401`, `403`, `404`, `429`.

#### POST /api/v1/products/:id/duplicate

**Body** — `name` (string, opc.; default `"<nombre original> (copia)"`), `sku` (string, req.; `UNIQUE`), `categoryId` (opc.), `copyVariants` (bool, default `true`), `copyAddons` (bool, default `true`), `copyIngredients` (bool, default `true`), `isActive` (bool, default `false`).

**Respuesta 201** — `data: Product`. Los identificadores de variantes y complementos son nuevos; los valores se copian. No copia stock.

**Errores** — `400`, `401`, `403`, `404`, `409` (`PRODUCT_SKU_TAKEN`), `429`.

#### GET /api/v1/products/:id/variants

**Respuesta 200** — `data: [{ id, productId, name, code, priceDeltaMinor, priceMinor, effectivePriceMinor, isDefault, sortOrder, isActive, createdAt, updatedAt }]`, `meta: { total, requestId }`. `effectivePriceMinor` es el precio ya resuelto con BR-PRICE-001, para que el cliente no lo calcule.

**Errores** — `401`, `403`, `404`.

#### POST /api/v1/products/:id/variants

**Body** — `name` (req., 1-60, `UNIQUE` por producto), `code` (max 30), `priceDeltaMinor` (integer, puede ser negativo, default 0), `priceMinor` (integer `>= 0`, opc.; si se envía sobreescribe el precio base), `isDefault` (bool, default `false`; si es `true`, las demás se desactivan como default en la misma transacción), `sortOrder` (`>= 0`), `isActive` (bool, default `true`).

**Respuesta 201** — `data: ProductVariant` con `effectivePriceMinor`.

**Errores** — `400`, `401`, `403`, `404`, `409` (`VARIANT_NAME_TAKEN`), `422` (`INVALID_VARIANT_PRICE` si el precio efectivo queda negativo), `429`.

#### PATCH /api/v1/products/variants/:variantId

**Body** — `name`, `code`, `priceDeltaMinor`, `priceMinor`, `isDefault`, `sortOrder`, `isActive`.

**Respuesta 200** — `data: ProductVariant`.

**Errores** — `400`, `401`, `403`, `404`, `409`, `422`.

#### DELETE /api/v1/products/variants/:variantId

**Body** — ninguno. Borrado lógico suave por FK (`ON DELETE SET NULL` en `order_items`): la variante desaparece del catálogo, los pedidos la conservan por snapshot.

**Respuesta 200** — `data: { id, deletedAt, affectedOrderItems }`.

**Errores** — `401`, `403`, `404`, `422` (`LAST_DEFAULT_VARIANT` si es la única variante y el producto la requiere).

#### GET /api/v1/products/:id/addons

**Respuesta 200** — `data: [{ id, productId, name, code, priceMinor, isMultiple, maxSelect, sortOrder, isActive }]`, `meta: { total, requestId }`.

**Errores** — `401`, `403`, `404`.

#### POST /api/v1/products/:id/addons

**Body** — `name` (req., 1-80, `UNIQUE` por producto), `code` (max 30), `priceMinor` (integer `>= 0`, default 0), `isMultiple` (0 \| 1, default 0; 1 = ilimitado hasta `maxSelect`), `maxSelect` (1-20, opc.; requerido si `isMultiple = 1` si se quiere tope; null = sin tope), `sortOrder`, `isActive`.

**Respuesta 201** — `data: ProductAddon`.

**Errores** — `400`, `401`, `403`, `404`, `409` (`ADDON_NAME_TAKEN`), `422` (`MAX_SELECT_REQUIRES_MULTIPLE`), `429`.

#### PATCH /api/v1/products/addons/:addonId

**Body** — `name`, `code`, `priceMinor`, `isMultiple`, `maxSelect`, `sortOrder`, `isActive`.

**Respuesta 200** — `data: ProductAddon`.

**Errores** — `400`, `401`, `403`, `404`, `409`, `422`.

#### DELETE /api/v1/products/addons/:addonId

**Respuesta 200** — `data: { id, deletedAt, affectedOrderItems }`.

**Errores** — `401`, `403`, `404`.

#### GET /api/v1/products/:id/ingredients

**Respuesta 200** — `data: [{ id, productId, ingredientId, ingredientName, unit, quantity, costMinor, lineCostMinor, stock: { currentStock, isLowStock } | null }]`, `meta: { totalCostMinor, requestId }`. `lineCostMinor` = costo de una unidad del producto según la receta.

**Errores** — `401`, `403`, `404`.

#### POST /api/v1/products/:id/ingredients

**Body** — `ingredientId` (integer, req., `UNIQUE` con `productId`), `quantity` (`number > 0`, req., hasta 3 decimales), `updateStock` (`boolean`, default `true`: si el insumo no tiene `inventory_item`, se crea con `currentStock = 0` e `isTracked = 1`).

**Respuesta 201** — `data: ProductIngredient`.

**Errores** — `400`, `401`, `403`, `404`, `409` (`INGREDIENT_ALREADY_IN_RECIPE`), `422` (`INVENTORY_SOURCE_REQUIRED`), `429`.

#### DELETE /api/v1/products/:id/ingredients/:ingredientId

**Respuesta 200** — `data: { id, productId, ingredientId, removedAt }`. No toca el inventario del insumo; solo lo saca de la receta.

**Errores** — `401`, `403`, `404`.

---

### 7.12 Orders — `/api/v1/orders`

| Método | Path | Permiso | Descripción |
|---|---|---|---|
| GET | `/` | `orders:read` | Listar pedidos |
| POST | `/` | `orders:create` | Crear pedido |
| GET | `/:id` | `orders:read` | Ver pedido |
| PATCH | `/:id` | `orders:update` | Actualizar pedido |
| DELETE | `/items/:itemId` | `orders:update` | Quitar ítem |
| POST | `/:id/items` | `orders:update` | Añadir ítem |
| PATCH | `/items/:itemId` | `orders:update` | Editar ítem |
| POST | `/:id/status` | `orders:status:update` | Transición de estado |
| POST | `/:id/confirm` | `orders:status:update` | Confirmar |
| POST | `/:id/cancel` | `orders:cancel` | Cancelar |
| POST | `/:id/assign-chair` | `orders:update` | Asignar silla |
| GET | `/:id/receipt` | `orders:receipt:read` | Recibo |
| GET | `/:id/history` | `orders:read` | Historial de estados |

#### GET /api/v1/orders

**Query** — `status` (`OrderStatus`), `type` (`OrderType`), `chairId` (integer), `locationId` (integer), `customerId` (integer; un `CUSTOMER` solo ve los suyos), `createdBy` (integer), `orderNumber` (string, `ORD-` + 6 dígitos), `q` (número de pedido o nota del cliente, 2-100), `hasUnpaidBalance` (bool), `from`, `to` (ISO), `page`, `pageSize` (default 20, máximo 100), `sort` (`createdAt` \| `placedAt` \| `totalMinor` \| `orderNumber` \| `completedAt`), `order`.

**Respuesta 200** — `data: [{ id, orderNumber, type, status, channel, customerId, customerName, chairId, chairCode, totalMinor, paidMinor, balanceMinor, itemCount, placedAt, completedAt, createdAt }]` (resumen, sin `items`), `meta: { page, pageSize, total, requestId, countsByStatus, totals: { grossMinor, netMinor, unpaidMinor } }`.

**Errores** — `400`, `401`, `403`, `429`.

#### POST /api/v1/orders

Crea el pedido completo. Los totales **siempre** los calcula el servidor (BR-ORDER-014); enviar campos de total da `400 VALIDATION_ERROR` con `code: 'FIELD_NOT_EDITABLE'`.

**Body**

| Campo | Tipo | Req. | Reglas |
|---|---|:--:|---|
| `type` | `OrderType` | No | Default `TAKEAWAY`. `CHAIR_RENTAL` exige `chairId` + `reservationId`. |
| `channel` | `OrderChannel` | No | Default `POS`. |
| `customerId` | `integer` | No | Default = actor si es `CUSTOMER`. Requiere cliente existente. |
| `chairId` | `integer` | No | Obligatorio si `type = CHAIR_RENTAL`. Opcional en `DINE_IN`. Prohibido en `TAKEAWAY` (se ignora con warning). |
| `reservationId` | `integer` | No | Obligatorio si `type = CHAIR_RENTAL`. |
| `rentalId` | `integer` | No | Si el alquiler ya arrancó. |
| `locationId` | `integer` | No | Sede. Default: la primera activa. |
| `tableLabel` | `string` | No | Max 50. Si coincide con el `code` de una silla, se desambigua (BR-ORDER-011). |
| `items` | `array` | Sí | Ver tabla inferior. Mínimo 1 en `PENDING`; puede ser `[]` solo con `place = false`. |
| `couponCode` | `string` | No | Máx 32, `[A-Z0-9_-]`. Se normaliza a mayúsculas. |
| `notes` | `string` | No | Notas internas, max 500. |
| `customerNotes` | `string` | No | Notas del cliente, max 500. |
| `place` | `boolean` | No | Default `true`. `false` deja el pedido en `DRAFT`. |

`items[]`:

| Campo | Tipo | Req. | Reglas |
|---|---|:--:|---|
| `productId` | `integer` | Sí | Debe existir, `isActive = true` y `deleted_at IS NULL`. |
| `variantId` | `integer` | No | Debe pertenecer al producto. |
| `quantity` | `number` | Sí | `> 0`, hasta 3 decimales. Fraccional permitido (pesajes). |
| `addons` | `array` | No | `[{ productAddonId: integer, quantity: integer 1-20 }]`. Todos los addons deben ser del producto (BR-PRICE-012). |
| `notes` | `string` | No | Instrucciones de preparación, max 300. |
| `status` | `OrderItemStatus` | No | Default `PENDING`. `READY` solo para productos sin preparación. |
| `preparationMinutesOverride` | `integer` | No | 0-240. Por defecto, el del producto. |

**Respuesta 201** — `data: Order` completo con `items[]` (cada uno con `addons[]`), `payments[]` (array vacío), `subtotalMinor`, `discountMinor`, `taxMinor`, `serviceFeeMinor`, `totalMinor`, `balanceMinor`, `orderNumber`, `status`. `meta: { requestId, appliedRules: ["BR-PRICE-001","BR-MONEY-003","BR-TAX-004","BR-INV-004"] }`.

Los 6 pasos de creación están detallados en `DESIGN.md` 8.5. Efectos colaterales: se reserva stock (movimiento `RESERVATION`), se incrementa `discounts.used_count` si hay cupón, se aplica el cupón en `discount_redemptions`, y se notifica al cliente.

**Errores** — `400` (`INVALID_QUANTITY`, `FIELD_NOT_EDITABLE`, `EMPTY_ORDER` en confirmación), `401`, `403`, `404` (`PRODUCT_NOT_FOUND`, `VARIANT_NOT_IN_PRODUCT`), `409` (`CHAIR_OCCUPIED`, `INVALID_ORDER_TRANSITION`, `ORDER_IMMUTABLE`), `422` (`PRODUCT_UNAVAILABLE`, `NEGATIVE_STOCK_BLOCKED`, `DISCOUNT_INVALID`, `DISCOUNT_LIMIT_REACHED`, `DISCOUNT_EXCEEDED_PER_CUSTOMER`, `DISCOUNT_MIN_ORDER_NOT_MET`, `RENTAL_REQUIRES_CHAIR_AND_RESERVATION`, `CHAIR_NOT_BOOKABLE`, `ADDON_SELECTION_LIMIT`, `ADDON_NOT_IN_PRODUCT`, `MIXED_ORDER_TYPE_NOT_ALLOWED`, `INVALID_VARIANT_PRICE`), `429` (120 por minuto).

#### GET /api/v1/orders/:id

**Respuesta 200** — `data: { ...Order, items: OrderItem[], payments: Payment[], refunds: [{ id, amountMinor, reason, createdAt }], chair: Chair | null, reservation: Reservation | null, rental: Rental | null, customer: { id, fullName, phone, email } | null, totals: { subtotalMinor, discountMinor, taxMinor, serviceFeeMinor, totalMinor, paidMinor, balanceMinor, tipMinor }, appliedDiscounts: [{ discountId, code, name, type, value, amountMinor }] }`.

**Errores** — `401`, `403`, `404` (incluye pedidos de otro cliente: no se revela existencia).

#### PATCH /api/v1/orders/:id

Solo `DRAFT` y `PENDING`. En `COMPLETED`, `CANCELLED` o `REFUNDED`: `409 CONFLICT_ERROR` con `code: 'ORDER_IMMUTABLE'`, **excepto** un body con únicamente `notes` (BR-ORDER-017).

**Body** (parcial, al menos un campo) — `notes` (max 500, interna; única excepción en pedidos cerrados), `customerNotes` (max 500), `tableLabel` (max 50), `couponCode` (string, `null` para quitarlo; solo `DRAFT`/`PENDING`), `items` (`array` completo de items, reemplaza el conjunto; recalcula totales), `locationId`.

**Respuesta 200** — `data: Order` con totales recalculados. Añadir o quitar ítems genera movimientos de inventario compensatorios (`RELEASE` de lo reservado y `RESERVATION` de lo nuevo) en la misma transacción.

**Errores** — `400`, `401`, `403`, `404`, `409` (`ORDER_IMMUTABLE`, `INVALID_ORDER_TRANSITION`), `422` (`ORDER_NOT_EDITABLE`, `NEGATIVE_STOCK_BLOCKED`, `EMPTY_ORDER`, `PRODUCT_UNAVAILABLE`, `DISCOUNT_*`), `429`.

#### POST /api/v1/orders/:id/items

**Body** — mismo esquema que `items[]` en `POST /orders`; admite varios en un solo request.

**Respuesta 201** — `data: { order: Order, addedItems: OrderItem[] }`. Recalcula `subtotalMinor`, `taxMinor`, `totalMinor`.

**Errores** — `400`, `401`, `403`, `404`, `409` (`ORDER_IMMUTABLE`), `422` (`ORDER_NOT_EDITABLE`, `NEGATIVE_STOCK_BLOCKED`, `PRODUCT_UNAVAILABLE`, `ADDON_SELECTION_LIMIT`, `MIXED_ORDER_TYPE_NOT_ALLOWED`), `429`.

#### PATCH /api/v1/orders/items/:itemId

**Body** — `quantity` (`number > 0`) o `notes` (max 300) o `status` (`PENDING` \| `READY`) o `addons` (reemplaza el conjunto; recalcula `unitPriceMinor`).

**Respuesta 200** — `data: { order: Order, item: OrderItem }`.

**Errores** — `400`, `401`, `403`, `404` (el ítem no existe, o pertenece a un pedido fuera del alcance del actor), `409` (`ORDER_IMMUTABLE`), `422` (`ORDER_NOT_EDITABLE`, `INVALID_QUANTITY`, `NEGATIVE_STOCK_BLOCKED`, `ADDON_SELECTION_LIMIT`), `429`.

#### DELETE /api/v1/orders/items/:itemId

**Body** — `reason` (string, opc., max 300).

**Respuesta 200** — `data: { order: Order, removedItem: OrderItem, recalculated: { subtotalMinor, discountMinor, taxMinor, totalMinor } }`. Libera el stock reservado de la línea. Si el pedido queda sin ítems, pasa a `DRAFT` si estaba en `PENDING`, o `422 EMPTY_ORDER` si el cliente intenta confirmar vacío.

**Errores** — `401`, `403`, `404`, `409` (`ORDER_IMMUTABLE`), `422` (`ORDER_NOT_EDITABLE`, `LAST_ITEM_REMOVAL`), `429`.

#### POST /api/v1/orders/:id/status

**Body** — `toStatus` (`OrderStatus`, req.), `reason` (string, req. si el destino es `CANCELLED` o `REFUNDED`, max 300), `pin` (`string`, opc., 4-6 dígitos; para `DELIVERING` o `COMPLETED` se puede exigir PIN de cajero).

Valida la transición contra la máquina de estados de `DESIGN.md` 6.1. Rechazos clave: `COMPLETED -> PREPARING`, `CANCELLED -> COMPLETED`, `COMPLETED -> COMPLETED`, `PENDING -> READY`.

**Respuesta 200** — `data: Order` con `status` y el timestamp correspondiente. Cada transición escribe en `order_status_history` y dispara sus efectos secundarios (notificaciones, cierre de silla, cierre de alquiler).

**Errores** — `400` (`INVALID_STATUS_VALUE`), `401`, `403`, `404`, `409` (`INVALID_ORDER_TRANSITION` con `details.from` y `details.to` y `details.allowed` = lista de destinos válidos), `422` (`EMPTY_ORDER`, `ORDER_NOT_EDITABLE`), `429`.

#### POST /api/v1/orders/:id/confirm

**Body** — `reservePayment` (`boolean`, default `false`: reserva el saldo pendiente), `notes` (opc.).

Atajo de `POST /:id/status` con `toStatus = CONFIRMED`.

**Respuesta 200** — `data: Order`.

**Errores** — `401`, `403`, `404`, `409` (`INVALID_ORDER_TRANSITION`), `422` (`EMPTY_ORDER`, `NEGATIVE_STOCK_BLOCKED`).

#### POST /api/v1/orders/:id/cancel

**Body** — `reason` (`string`, req., 2-300), `refundIfPaid` (`boolean`, default `true`), `notifyCustomer` (bool, default `true`).

Si el pedido tiene pagos aprobados y `refundIfPaid`, se crea el reembolso y el pedido pasa a `REFUNDED` en vez de `CANCELLED`. Se libera todo el stock reservado.

**Respuesta 200** — `data: { order: Order, refund: { totalMinor, payments: [{ paymentId, amountMinor }] } | null, stockReleased: [{ inventoryItemId, quantity }] }`.

**Errores** — `400`, `401`, `403`, `404`, `409` (`INVALID_ORDER_TRANSITION`), `422` (`ORDER_NOT_EDITABLE`, `REFUND_EXCEEDS_PAID`), `429`.

#### POST /api/v1/orders/:id/assign-chair

**Body** — `chairId` (integer, req.).

En `DRAFT`/`PENDING` es libre. En `CONFIRMED` en adelante, la silla destino no debe tener un alquiler `ACTIVE` de otro cliente (BR-ORDER-019).

**Respuesta 200** — `data: { order: Order, previousChairId: integer | null, chair: Chair }`.

**Errores** — `400`, `401`, `403`, `404`, `409` (`CHAIR_OCCUPIED`), `422` (`ORDER_NOT_EDITABLE`, `CHAIR_NOT_BOOKABLE`, `CHAIR_IN_USE`), `429`.

#### GET /api/v1/orders/:id/receipt

**Query** — `format` (`json`, único valor en v1; `text` acepta `text/plain` para imprimir en la caja registradora).

**Respuesta 200** — `data: { orderNumber, type, status, business: { name, legalName, taxId, addressLine1, city, currencyCode, currencySymbol }, customer: { fullName, phone } | null, items: [{ name, variantName, unitPriceMinor, quantity, addons: [{ name, priceMinor, quantity }], discountMinor, taxMinor, lineTotalMinor, notes }], totals: { subtotalMinor, discountMinor, taxMinor, serviceFeeMinor, totalMinor, paidMinor, balanceMinor, tipMinor, changeDueMinor }, payments: [{ paymentNumber, method, amountMinor, approvedAt }], refunds: [{ amountMinor, reason, createdAt }], chair: { code, name, zoneName } | null, rental: { code, startAt, endAt, billedMinutes, extraMinutesMinor } | null, placedAt, completedAt, printedAt: null }`. Todo construido **solo** con snapshots y valores almacenados (BR-ORDER-018).

**Errores** — `401`, `403`, `404`.

#### GET /api/v1/orders/:id/history

**Query** — `page`, `pageSize`, `sort` (`createdAt`), `order`.

**Respuesta 200** — `data: [{ id, fromStatus, toStatus, changedBy, changedByName, reason, createdAt }]`, `meta: { page, pageSize, total, requestId }`. El primer registro tiene `fromStatus = null`.

**Errores** — `401`, `403`, `404`.

---

### 7.13 Payments — `/api/v1/payments`

| Método | Path | Permiso | Descripción |
|---|---|---|---|
| GET | `/` | `payments:read` | Listar pagos |
| GET | `/methods` | `payments:read` | Métodos habilitados |
| POST | `/` | `payments:create` | Procesar pago |
| GET | `/:id` | `payments:read` | Ver pago |
| POST | `/:id/refund` | `payments:refund` | Reembolsar |

#### GET /api/v1/payments

**Query** — `orderId` (integer), `method` (`PaymentMethod`), `provider` (`PaymentProvider`), `status` (`PaymentStatus`), `from`, `to` (ISO; sobre `createdAt`), `referenceNumber` (string, 100), `page`, `pageSize`, `sort` (`createdAt` \| `amountMinor` \| `approvedAt`), `order`.

**Respuesta 200** — `data: [{ id, paymentNumber, orderId, orderNumber, method, provider, status, amountMinor, refundedMinor, currencyCode, referenceNumber, receiptNumber, approvedAt, failedAt, failureReason, createdAt }]`, `meta: { page, pageSize, total, requestId, totals: { approvedMinor, refundedMinor, netMinor, byMethod: { CASH, CARD, TRANSFER, ONLINE } } }`.

**Errores** — `400`, `401`, `403`, `429`.

#### GET /api/v1/payments/methods

**Respuesta 200** — `data: [{ method, enabled, providers: [{ code, label, requiresReference, isDefault }], requiresReference, allowsPartial, allowsOverpayment, minAmountMinor, maxAmountMinor }]`. Refleja `businesses` (propinas, moneda) y disponibilidad real de los adaptadores de proveedor registrados. El POS usa esta lista para construir la pantalla de cobro; no la duplica.

**Errores** — `401`.

#### POST /api/v1/payments

**Headers** — `Idempotency-Key` (UUID v4, **obligatorio**). Sin él: `400 VALIDATION_ERROR` con `code: 'IDEMPOTENCY_KEY_REQUIRED'`.

**Body** — `orderId` (integer, req., BR-PAY-002), `method` (`PaymentMethod`, req.), `amountMinor` (integer `> 0`, req.), `provider` (`PaymentProvider`, req. salvo `CASH`), `referenceNumber` (string, req. si el proveedor lo exige, max 100), `tipMinor` (integer `>= 0`, opc.; **no** entra en `totalMinor`, BR-MONEY-009), `notes` (max 300), `receiptNumber` (string, opc., max 50), `metadata` (object, opc.; solo claves de referencia, nunca datos de tarjeta, BR-SEC-006).

En `CASH`, `amountMinor` puede exceder el saldo (es el pago con cambio) y `amountMinor - balanceMinor` se devuelve como `changeDueMinor`; el pago solo imputa el saldo.

**Respuesta 201** — `data: { payment: Payment, order: Order, changeDueMinor: integer, tipMinor: integer }`. Transaccional: recalcula `orders.paid_minor` y `orders.balance_minor`, y auto-completa el pedido si el saldo queda en 0 (BR-PAY-008).

**Respuesta 200 (idempotente)** — mismo cuerpo, cuando la `Idempotency-Key` ya existe. `meta: { requestId, idempotent: true }`.

**Errores** — `400` (`IDEMPOTENCY_KEY_REQUIRED`, `INVALID_AMOUNT`), `401`, `403`, `404` (pedido inexistente), `402` (`PAYMENT_ERROR` con `details.provider` y `details.providerCode`), `409` (`PAYMENT_ALREADY_PROCESSED` si el pedido ya está `COMPLETED` y se intenta cobrar un saldo de 0), `422` (`ORDER_NOT_PAYABLE`, `ORDER_NOT_CONFIRMED`, `PAYMENT_EXCEEDS_TOTAL` en no efectivo, `PROVIDER_REQUIRED`, `PAYMENT_REQUIRES_ORDER`, `INVALID_AMOUNT_FOR_METHOD`), `429`.

#### GET /api/v1/payments/:id

**Respuesta 200** — `data: { ...Payment, order: { id, orderNumber, totalMinor, balanceMinor }, refunds: [{ id, amountMinor, reason, refundedBy, createdAt }], customer: { id, fullName } | null, processedByUser: { id, fullName } | null }`.

**Errores** — `401`, `403`, `404`.

#### POST /api/v1/payments/:id/refund

**Body** — `amountMinor` (integer `> 0`, req.), `reason` (`string`, req., 2-300), `notifyCustomer` (bool, default `true`).

`amountMinor` no puede exceder `amount_minor - refunded_minor` (BR-PAY-006). Refund total o parcial: el estado pasa a `REFUNDED` o `PARTIALLY_REFUNDED`. Si el reembolso deja el pedido con saldo 0 y el pedido estaba `COMPLETED`, no se revierte el estado del pedido: se registra en `order_status_history` como nota.

**Respuesta 201** — `data: { payment: Payment, refund: { id, amountMinor, reason, createdAt }, order: Order, remainingBalanceMinor: integer }`, `meta: { appliedRules: ["BR-PAY-006"] }`.

**Errores** — `400` (falta `reason`), `401`, `403` (`payments:refund` es MANAGER+), `404`, `422` (`REFUND_EXCEEDS_PAID`, `REFUND_NOT_ALLOWED` si el pago no está `APPROVED`/`PARTIALLY_REFUNDED`), `429`.

---

### 7.14 Discounts — `/api/v1/discounts`

| Método | Path | Permiso | Descripción |
|---|---|---|---|
| GET | `/` | `discounts:read` | Listar descuentos |
| POST | `/` | `discounts:create` | Crear descuento |
| POST | `/validate` | `discounts:validate` | Validar y cotizar |
| GET | `/mine` | `autenticado` | Cupones del cliente |
| GET | `/:id` | `discounts:read` | Ver descuento |
| PATCH | `/:id` | `discounts:update` | Actualizar descuento |
| DELETE | `/:id` | `discounts:delete` | Soft delete |

#### GET /api/v1/discounts

**Query** — `isActive` (bool), `type` (`DiscountType`), `appliesTo` (`DiscountAppliesTo`), `isExpired` (bool), `q` (code o nombre, 2-50), `page`, `pageSize`, `sort` (`createdAt` \| `code` \| `usedCount` \| `endsAt`), `order`.

**Respuesta 200** — `data: [{ id, code, name, description, type, value, minOrderMinor, maxDiscountMinor, appliesTo, appliesCategoryId, appliesProductId, usageLimit, usageLimitPerCustomer, usedCount, startsAt, endsAt, isActive, stackable, isCurrentlyValid, usageRemaining, createdAt, updatedAt }]`, `meta: { page, pageSize, total, requestId }`.

**Errores** — `400`, `401`, `403`, `429`.

#### POST /api/v1/discounts

**Body** — `code` (req., 3-32, `[A-Z0-9_-]`, normalizado a mayúsculas, `UNIQUE`), `name` (req., 1-100), `description` (max 500), `type` (`PERCENT` \| `FIXED`, req.), `value` (integer `>= 0`, req.: basis points si `PERCENT`, centavos si `FIXED`; en `PERCENT` máximo 10000 y obligatorio `maxDiscountMinor` si `value > 5000`), `minOrderMinor` (integer `>= 0`, opc.), `maxDiscountMinor` (integer `> 0`, opc.), `appliesTo` (`ALL` \| `CATEGORY` \| `PRODUCT`, default `ALL`), `appliesCategoryId` (integer, req. si `CATEGORY`), `appliesProductId` (integer, req. si `PRODUCT`), `usageLimit` (integer `> 0`, opc.; null = ilimitado), `usageLimitPerCustomer` (integer `> 0`, opc.), `startsAt` / `endsAt` (ISO; ambas o ninguna), `isActive` (bool, default `true`), `stackable` (bool, default `false`).

**Respuesta 201** — `data: Discount` con `isCurrentlyValid` calculado.

**Errores** — `400` (`INVALID_DISCOUNT_CODE`, `MAX_DISCOUNT_REQUIRED`, `PROMO_WINDOW_INVALID`), `401`, `403`, `404` (categoría o producto inexistente), `409` (`DISCOUNT_CODE_TAKEN`), `422` (`APPLIES_TO_REQUIRES_TARGET`, `PERCENT_VALUE_OUT_OF_RANGE`), `429`.

#### POST /api/v1/discounts/validate

Previsualización. No crea nada. El servidor recalcula en `POST /orders` de todos modos (BR-DISC-001).

**Body** — `code` (req., 3-32), `subtotalMinor` (integer `>= 0`, req.: el subtotal que el cliente ya conoce; si se omite, se puede enviar `orderId` en su lugar), `orderId` (integer, opc.: si se envía, el servidor usa el subtotal real del pedido), `items` (`array` opc. de `{ productId, categoryId, quantity, unitPriceMinor }`; necesario para `appliesTo != ALL`), `customerId` (integer, opc.: para validar `usageLimitPerCustomer`).

**Respuesta 200** — `data: { isValid: boolean, code: string | null, name: string | null, type, value, applicableSubtotalMinor, discountMinor, cappedByMaxDiscount: boolean, remainingUses: integer | null, minOrderMet: boolean, reason: string | null, ruleIds: [...] }`. Si no es válido, `isValid = false` con `reason` en `details.reason` y **HTTP 200**: es una consulta, no un error de la petición.

**Errores** — `400` (`INVALID_DISCOUNT_CODE`, `MISSING_VALIDATION_CONTEXT`), `401`, `403`, `404` (código inexistente).

#### GET /api/v1/discounts/mine

**Query** — `includeExpired` (bool, default `false`), `includeUsed` (bool, default `true`), `page`, `pageSize`.

**Respuesta 200** — `data: [{ id, code, name, description, type, value, maxDiscountMinor, appliesTo, startsAt, endsAt, isActive, isValid, usedAt, usedCount }]`, `meta: { page, pageSize, total, requestId }`. Solo los descuentos del cliente autenticado: los públicos vigentes más los que ya canjeó. Nunca expone descuentos internos de otros clientes.

**Errores** — `401`, `429`.

#### GET /api/v1/discounts/:id

**Respuesta 200** — `data: { ...Discount, business: { id, name }, category: { id, name } | null, product: { id, name } | null, stats: { usedCount, totalDiscountedMinor, uniqueCustomers, lastUsedAt } }`.

**Errores** — `401`, `403`, `404`.

#### PATCH /api/v1/discounts/:id

**Body** — los mismos campos de creación. El `code` se puede cambiar si no ha sido usado nunca; si `used_count > 0` y se intenta cambiar, `422` con `code: 'DISCOUNT_CODE_IN_USE'`.

**Respuesta 200** — `data: Discount`.

**Errores** — `400`, `401`, `403`, `404`, `409`, `422`.

#### DELETE /api/v1/discounts/:id

**Body** — `reason` (string, opc., max 300). Soft delete. No afecta redenciones históricas.

**Respuesta 200** — `data: { id, deletedAt, isActive: false }`.

**Errores** — `401`, `403`, `404`.

---

### 7.15 Inventory — `/api/v1/inventory`

| Método | Path | Permiso | Descripción |
|---|---|---|---|
| GET | `/items` | `inventory:read` | Listar ítems |
| POST | `/items` | `inventory:write` | Crear ítem |
| GET | `/items/:id` | `inventory:read` | Ver ítem |
| PATCH | `/items/:id` | `inventory:write` | Actualizar ítem |
| DELETE | `/items/:id` | `inventory:write` | Soft delete |
| POST | `/items/:id/adjust` | `inventory:adjust` | Ajustar saldo |
| GET | `/movements` | `inventory:movements:read` | Listar movimientos |
| POST | `/movements` | `inventory:adjust` | Crear movimiento |
| GET | `/alerts` | `inventory:read` | Alertas de stock bajo |
| GET | `/suppliers` | `inventory:read` | Listar proveedores |

#### GET /api/v1/inventory/items

**Query** — `q` (nombre o SKU, 2-100), `productId` (integer), `ingredientId` (integer), `supplier` (string, 100), `locationStorage` (string, 100), `isTracked` (bool), `isLowStock` (bool), `includeInactive` (bool, default `false`), `page`, `pageSize`, `sort` (`name` \| `currentStock` \| `updatedAt` \| `costMinor`), `order`.

**Respuesta 200** — `data: InventoryItem[]` con `isLowStock` calculado y `lowStockThreshold` efectivo (usa `minStock` o, si es 0, `businesses.lowStockAlertThreshold`), `meta: { page, pageSize, total, requestId, totals: { itemsTracked, valueMinor, lowStockCount, negativeStockCount } }`.

**Errores** — `400`, `401`, `403`, `429`.

#### POST /api/v1/inventory/items

**Body** — exactamente uno de `productId` o `ingredientId` (req., `CHECK` de la base): `productId` (integer) o `ingredientId` (integer). `name` (req., 1-150), `sku` (max 50, `UNIQUE` por negocio), `unit` (`UND` \| `KG` \| `G` \| `L` \| `ML`, default `UND`), `currentStock` (`number >= 0`, default 0; el valor inicial genera un movimiento `ADJUSTMENT` con `reason: 'INITIAL'`, no un update silencioso), `minStock` (`number >= 0`, default = `businesses.lowStockAlertThreshold`), `maxStock` (`number >= 0`, default 0), `costMinor` (integer `>= 0`, default 0), `supplier` (max 150), `locationStorage` (max 100), `isTracked` (bool, default `true`).

**Respuesta 201** — `data: InventoryItem` con el movimiento inicial en `meta.initialMovementId`.

**Errores** — `400`, `401`, `403`, `404` (producto o insumo inexistente), `409` (`INVENTORY_ITEM_EXISTS` por los índices parciales `ux_inventory_product` / `ux_inventory_ingredient`), `422` (`INVENTORY_SOURCE_REQUIRED` si se envían ambos o ninguno, `NEGATIVE_STOCK_BLOCKED` y `allowNegativeStock = 0`), `429`.

#### GET /api/v1/inventory/items/:id

**Respuesta 200** — `data: { ...InventoryItem, product: { id, name, sku } | null, ingredient: { id, name, unit } | null, recentMovements: InventoryMovement[] (últimos 20), stats: { totalIn, totalOut, averageCostMinor } }`.

**Errores** — `401`, `403`, `404`.

#### PATCH /api/v1/inventory/items/:id

**Body** — `name`, `sku`, `unit`, `minStock`, `maxStock`, `costMinor`, `supplier`, `locationStorage`, `isTracked`. `currentStock` **no** se acepta: se cambia con `POST /items/:id/adjust` para dejar rastro (BR-INV-005). Enviarlo da `422` con `code: 'FIELD_NOT_EDITABLE'`. `productId` e `ingredientId` son inmutables.

**Respuesta 200** — `data: InventoryItem`.

**Errores** — `400`, `401`, `403`, `404`, `409` (`INVENTORY_SKU_TAKEN`), `422` (`FIELD_NOT_EDITABLE`).

#### DELETE /api/v1/inventory/items/:id

**Body** — `reason` (string, req., 2-300). Soft delete. No se borran los movimientos: el histórico se conserva y queda con `inventory_item_id` intacto.

**Respuesta 200** — `data: { id, deletedAt, reason }`.

**Errores** — `400`, `401`, `403`, `404`, `422` (`ITEM_HAS_MOVEMENTS` si tiene movimientos en los últimos 30 días y no se envía `force = true`).

#### POST /api/v1/inventory/items/:id/adjust

**Body** — `newQuantity` (`number >= 0`, req.) o `deltaQuantity` (`number != 0`, req., exactamente uno de los dos), `reason` (`string`, req., 2-300), `unitCostMinor` (integer `>= 0`, opc.), `referenceType` (`ORDER` \| `PURCHASE` \| `MANUAL`, default `MANUAL`), `referenceId` (integer, opc.).

Genera un movimiento `ADJUSTMENT` con `balance_after` igual a `newQuantity`. Si el ajuste deja el saldo por debajo de cero y `allowNegativeStock = 0`: `422` con `code: 'NEGATIVE_STOCK_BLOCKED'` y `details: { currentStock, requestedQuantity, available }`.

**Respuesta 201** — `data: { item: InventoryItem, movement: InventoryMovement, isLowStock: boolean }`.

**Errores** — `400`, `401`, `403`, `404`, `422` (`NEGATIVE_STOCK_BLOCKED`, `ITEM_NOT_TRACKED`, `INVALID_ADJUSTMENT`), `429`.

#### GET /api/v1/inventory/movements

**Query** — `itemId` (integer, alias de `inventoryItemId`), `type` (`InventoryMovementType`), `referenceType`, `referenceId` (integer), `performedBy` (integer), `from`, `to` (ISO; default últimos 30 días), `page`, `pageSize` (default 50, máximo 200), `sort` (`createdAt` \| `quantity`), `order`.

**Respuesta 200** — `data: InventoryMovement[]` con `inventoryItemName` y `unit`, `meta: { page, pageSize, total, requestId, totals: { quantityIn, quantityOut, netQuantity, valueInMinor, valueOutMinor } }`.

**Errores** — `400` (`RANGE_TOO_LARGE` si supera 366 días), `401`, `403`, `429`.

#### POST /api/v1/inventory/movements

**Body** — `inventoryItemId` (integer, req.), `movementType` (`PURCHASE` \| `SALE` \| `ADJUSTMENT` \| `WASTE` \| `RETURN` \| `RESERVATION` \| `RELEASE`, req.), `quantity` (`number != 0`, req.; positivo suma, negativo resta), `unitCostMinor` (integer `>= 0`, opc.), `referenceType` (`ORDER` \| `PURCHASE` \| `MANUAL`, opc.), `referenceId` (integer, opc.), `reason` (string, req. si `WASTE` o `ADJUSTMENT`, max 300).

El movimiento se inserta **junto** al `UPDATE` del saldo, en una sola transacción, y `balance_after` refleja el saldo ya actualizado (BR-INV-010). `SALE`, `RESERVATION` y `RELEASE` no se pueden crear manualmente: los genera el flujo de pedidos: `422` con `code: 'MOVEMENT_TYPE_NOT_MANUAL'`.

**Respuesta 201** — `data: { item: InventoryItem, movement: InventoryMovement }`, `meta: { appliedRules: ["BR-INV-001","BR-INV-002","BR-INV-010"] }`.

**Errores** — `400`, `401`, `403`, `404`, `422` (`ITEM_NOT_TRACKED`, `MOVEMENT_TYPE_NOT_MANUAL`, `NEGATIVE_STOCK_BLOCKED`, `REASON_REQUIRED`), `429`.

#### GET /api/v1/inventory/alerts

**Query** — `supplier` (string, 100), `locationStorage` (string, 100), `includeNegative` (bool, default `true`), `severity` (`LOW` \| `OUT` \| `NEGATIVE`, opcional), `page`, `pageSize`, `sort` (`currentStock` \| `name`), `order`.

**Respuesta 200** — `data: [{ itemId, name, sku, unit, currentStock, minStock, lowStockThreshold, deficitQuantity, supplier, locationStorage, severity, isTracked, updatedAt }]`, `meta: { page, pageSize, total, requestId, countsBySeverity }`. `severity`: `OUT` si `currentStock <= 0`, `NEGATIVE` si `< 0`, `LOW` si `<= minStock`.

**Errores** — `400`, `401`, `403`, `429`.

#### GET /api/v1/inventory/suppliers

**Query** — `q` (string, 2-100), `page`, `pageSize`, `sort` (`name`), `order`.

**Respuesta 200** — `data: [{ name, itemCount, totalStock, totalValueMinor, lowStockCount, lastMovementAt }]` derivado de `inventory_items.supplier`. Solo los proveedores con al menos un ítem activo.

**Errores** — `400`, `401`, `403`, `429`.

---

### 7.16 Reports — `/api/v1/reports`

Todos los reportes aceptan `preset`, `from`, `to` y `timezone` (sección 5.2) y `locationId` (opc.) para acotar por sede. Salvo indicación contraria, excluyen pedidos `CANCELLED` y `REFUNDED` del cálculo de ingresos, y **no** excluyen `DRAFT`.

| Método | Path | Permiso | Descripción |
|---|---|---|---|
| GET | `/dashboard` | `reports:read` | KPIs del día y series |
| GET | `/sales` | `reports:read` | Ventas del periodo |
| GET | `/sales-by-hour` | `reports:read` | Ventas por hora |
| GET | `/sales-by-day` | `reports:read` | Ventas por día |
| GET | `/top-products` | `reports:read` | Productos más vendidos |
| GET | `/product-revenue` | `reports:read` | Ingresos por producto |
| GET | `/chair-occupancy` | `reports:read` | Ocupación de sillas |
| GET | `/rental-revenue` | `reports:read` | Ingresos por alquiler |
| GET | `/customers` | `reports:read` | Reporte de clientes |
| GET | `/inventory` | `reports:read` | Valorización de inventario |
| GET | `/orders-summary` | `reports:read` | Resumen de pedidos |
| POST | `/export` | `reports:export` | Exportar CSV |

#### GET /api/v1/reports/dashboard

**Query** — `preset` (default `today`), `locationId`, `includeSeries` (bool, default `true`), `seriesDays` (7 \| 14 \| 30, default 7).

**Respuesta 200** — `data: { kpis: { totalOrders, totalItems, grossSalesMinor, netSalesMinor, averageTicketMinor, totalDiscountMinor, totalTaxMinor, totalServiceFeeMinor, totalTipsMinor, refundedMinor, ordersCancelled, newCustomers, activeRentals, rentalRevenueMinor, chairOccupancyRate, inventoryAlertsCount }, salesByChannel: [{ channel, orders, totalMinor }], salesByType: [{ type, orders, totalMinor }], topProducts: [{ productId, name, quantity, totalMinor }], currentSpaces: { total, available, occupied, reserved, blocked, maintenance, cleaning }, series: [{ date, orders, totalMinor }], comparison: { vsPreviousPeriod: { grossSalesMinor, totalOrders, percentChange } } }`, `meta: { requestId, generatedAt, range: { from, to, timezone, preset } }`. `percentChange` es `number` y puede ser negativo; `null` si el periodo anterior no tuvo datos.

**Errores** — `400`, `401`, `403`, `429`.

#### GET /api/v1/reports/sales

**Query** — los comunes, más `groupBy` (`day` \| `week` \| `month`, default `day`), `channel`, `type`, `locationId`, `includeRefunded` (bool, default `false`).

**Respuesta 200** — `data: [{ period: "2026-03-14", orders: 128, items: 340, subtotalMinor, discountMinor, taxMinor, serviceFeeMinor, totalMinor, refundedMinor, netMinor, averageTicketMinor, cashMinor, cardMinor, transferMinor, onlineMinor }]`, `meta: { requestId, generatedAt, range, totals: { orders, netMinor, averageTicketMinor, averageItemsPerOrder } }`.

**Errores** — `400` (`RANGE_TOO_LARGE`, `INVALID_PRESET`), `401`, `403`, `429`.

#### GET /api/v1/reports/sales-by-hour

**Query** — los comunes. Agrupa por hora local del negocio (0-23) según `businesses.timezone`.

**Respuesta 200** — `data: [{ hour: 0, orders, items, totalMinor, averageTicketMinor, rentalMinutes, rentalRevenueMinor }]` con las 24 horas siempre presentes (las que no tienen datos vienen en 0, para que el gráfico no tenga huecos), `meta: { requestId, generatedAt, range, peakHours: [8, 9, 10] }`.

**Errores** — `400`, `401`, `403`, `429`.

#### GET /api/v1/reports/sales-by-day

**Query** — los comunes, más `includeWeekdays` (bool, default `true`: agrega `byWeekday: [{ weekday, orders, totalMinor }]` con 0=domingo).

**Respuesta 200** — `data: [{ date: "2026-03-14", orders, items, totalMinor, netMinor, averageTicketMinor, rentals, rentalMinutes, rentalRevenueMinor, newCustomers }]`. Sin huecos: los días sin actividad aparecen con ceros.

**Errores** — `400`, `401`, `403`, `429`.

#### GET /api/v1/reports/top-products

**Query** — los comunes, más `limit` (1-100, default 10), `orderBy` (`quantity` \| `revenue`, default `quantity`), `categoryId`.

**Respuesta 200** — `data: [{ rank, productId, name, sku, categoryName, quantity, orders, totalMinor, netMinor, averagePriceMinor, marginMinor | null }]`, `meta: { requestId, generatedAt, range, totals: { quantity, netMinor, shareOfSalesPercent } }`. Solo pedidos en estado `COMPLETED`.

**Errores** — `400`, `401`, `403`, `429`.

#### GET /api/v1/reports/product-revenue

**Query** — los comunes, más `groupBy` (`product` \| `category`, default `product`), `includeTax` (bool, default `true`).

**Respuesta 200** — `data: [{ key, name, quantity, subtotalMinor, discountMinor, taxMinor, totalMinor, netMinor, sharePercent, sales: [{ date, quantity, totalMinor }] }]`, `meta: { requestId, generatedAt, range, totals: { netMinor, productsWithSales } }`.

**Errores** — `400`, `401`, `403`, `429`.

#### GET /api/v1/reports/chair-occupancy

**Query** — los comunes, más `zoneId`, `locationId`, `kind` (`ChairKind`), `groupBy` (`chair` \| `zone` \| `hour`, default `chair`).

**Respuesta 200** — `data: { summary: { totalChairs, totalCapacity, availableMinutes, occupiedMinutes, utilizationPercent, avgSessionMinutes, totalSessions, overageMinutes, overageRevenueMinor }, byChair: [{ chairId, code, name, kind, zoneName, status, sessions, occupiedMinutes, reservedMinutes, utilizationPercent, revenueMinor, overageMinutes }], byZone: [...], timeline: [{ date, hour, occupiedChairs, reservedChairs, utilizationPercent }] }`, `meta: { requestId, generatedAt, range }`. `utilizationPercent` = `occupiedMinutes / (totalChairs * minutesInRange) * 100`, redondeado a 2 decimales. `overageMinutes` y `overageRevenueMinor` usan el precio congelado (BR-RENTAL-003).

**Errores** — `400` (`RANGE_TOO_LARGE` si supera 90 días), `401`, `403`, `429`.

#### GET /api/v1/reports/rental-revenue

**Query** — los comunes, más `zoneId`, `chairId`, `groupBy` (`chair` \| `zone` \| `day` \| `month`).

**Respuesta 200** — `data: { summary: { sessions, totalMinutes, billedMinutes, overtimeMinutes, subtotalMinor, extensionsMinor, overtimeMinor, discountMinor, taxMinor, totalMinor, averageSessionMinutes, averageRevenuePerSessionMinor, minimumAppliedCount }, byChair: [{ chairId, code, zoneName, sessions, minutes, overtimeMinutes, totalMinor }], byZone: [...], byDay: [...] }`, `meta: { requestId, generatedAt, range, appliedRules: ["BR-RENTAL-001","BR-RENTAL-002","BR-RENTAL-003","BR-RENTAL-004"] }`. `minimumAppliedCount` = cuántas sesiones pagaron el mínimo de 30 minutos.

**Errores** — `400`, `401`, `403`, `429`.

#### GET /api/v1/reports/customers

**Query** — los comunes, más `limit` (1-500, default 50), `orderBy` (`totalSpent` \| `orders` \| `lastOrder` \| `newCustomers`, default `totalSpent`), `onlyWithOrders` (bool, default `true`), `segment` (`new` \| `returning` \| `loyal` \| `atRisk` \| `all`): `new` = 1 sola compra, `returning` = 2-4, `loyal` = 5+, `atRisk` = última compra hace más de 30 días.

**Respuesta 200** — `data: [{ customerId, fullName, email, phone, orders, items, totalSpentMinor, averageTicketMinor, firstOrderAt, lastOrderAt, daysSinceLastOrder, totalRentalMinutes, segment }]`, `meta: { requestId, generatedAt, range, totals: { customers, newCustomers, returningCustomers, repeatRatePercent } }`.

**Errores** — `400`, `401`, `403`, `429`.

#### GET /api/v1/reports/inventory

**Query** — los comunes, más `supplier`, `locationStorage`, `includeZeroStock` (bool, default `true`), `lowStockOnly` (bool, default `false`).

**Respuesta 200** — `data: { summary: { items, trackedItems, totalValueMinor, totalQuantityByUnit: { KG, G, L, ML, UND }, lowStockCount, outOfStockCount, negativeStockCount, averageCostMinor }, byItem: [{ itemId, name, sku, unit, currentStock, minStock, costMinor, valueMinor, isLowStock, supplier, locationStorage, lastMovementAt, movementsInRange: { in, out, net } }], bySupplier: [...], byStorage: [...] }`, `meta: { requestId, generatedAt, range }`. `totalValueMinor = roundHalfUp(currentStock * costMinor)`.

**Errores** — `400`, `401`, `403`, `429`.

#### GET /api/v1/reports/orders-summary

**Query** — los comunes, más `groupBy` (`day` \| `week` \| `month` \| `hour` \| `status` \| `type` \| `channel`, default `day`), `locationId`.

**Respuesta 200** — `data: [{ group, orders, cancelled, refunded, completed, pending, averagePreparationMinutes, averageWaitMinutes, firstOrderAt, lastOrderAt }]`, `meta: { requestId, generatedAt, range, totals: { orders, completed, cancelled, refunded, cancelRatePercent, averagePreparationMinutes, averageWaitMinutes, averageItemsPerOrder, itemsCancelled } }`. `averageWaitMinutes` = `ready_at - placed_at`; `averagePreparationMinutes` = `completed_at - preparing_at`. Se calcula solo con los pedidos que tienen ambos timestamps.

**Errores** — `400`, `401`, `403`, `429`.

#### POST /api/v1/reports/export

**Body** — `report` (`sales` \| `sales-by-day` \| `sales-by-hour` \| `top-products` \| `product-revenue` \| `chair-occupancy` \| `rental-revenue` \| `customers` \| `inventory` \| `orders-summary`, req.), los mismos parámetros de rango que el reporte correspondiente, más `format` (`csv`, único valor en v1), `columns` (`string[]` opc.; subconjunto de las columnas del reporte), `filename` (`string` opc., max 120, sin extensión), `includeTotalsRow` (`boolean`, default `true`).

**Respuesta 200** — `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="<...>.csv"`. El envoltorio JSON **no** se usa aquí: es la única respuesta binaria/texto de la API. UTF-8 con BOM (`\xEF\xBB\xBF`) para que Excel en Windows respete los acentos. Separador `;` (convención es_CO) y decimales con `,`. Máximo 10 MB o 100 000 filas: si se supera, `422` con `code: 'EXPORT_TOO_LARGE'` y se sugiere acotar el rango.

Registra `audit_logs` con `action = EXPORT`, `entity_type = export`, y los parámetros usados (sin datos de clientes más allá de los que el reporte ya expone legítimamente).

**Errores** — `400` (`INVALID_REPORT`, `INVALID_COLUMNS`), `401`, `403` (`reports:export` es ADMIN/OWNER), `422` (`EXPORT_TOO_LARGE`), `429` (10 por hora).

---

### 7.17 Notifications — `/api/v1/notifications`

| Método | Path | Permiso | Descripción |
|---|---|---|---|
| GET | `/` | `notifications:read` | Listar notificaciones |
| GET | `/unread-count` | `notifications:read` | Contador no leídas |
| GET | `/preferences` | `notifications:read` | Preferencias |
| PUT | `/preferences` | `notifications:update_preferences` | Actualizar preferencias |
| POST | `/:id/read` | `notifications:read` | Marcar leída |
| POST | `/read-all` | `notifications:read` | Marcar todas leídas |

#### GET /api/v1/notifications

**Query** — `status` (`PENDING` \| `SENT` \| `READ` \| `FAILED`), `type` (`NotificationType`), `channel` (`NotificationChannel`), `unreadOnly` (`boolean`), `from`, `to` (ISO), `page`, `pageSize` (default 20, máximo 100), `sort` (`createdAt` \| `readAt`), `order`.

**Respuesta 200** — `data: Notification[]` con `data` parseado como objeto, `meta: { page, pageSize, total, requestId, unreadCount }`. Solo notificaciones del usuario autenticado.

**Errores** — `400`, `401`, `429`.

#### GET /api/v1/notifications/unread-count

**Respuesta 200** — `data: { total: 7, byType: { ORDER_CONFIRMED: 2, RESERVATION_UPCOMING: 1, RESERVATION_TIME_ENDING: 3, SYSTEM: 1 }, byChannel: { IN_APP: 7 } }`. Pensado para polling ligero y badge; no requiere paginación.

**Errores** — `401`.

#### GET /api/v1/notifications/preferences

**Respuesta 200** — `data: { inApp, push, email, sms, whatsapp, quietHoursFrom, quietHoursTo }`. Crea la fila con los defaults si no existe (BR-NOTIF-005).

**Errores** — `401`.

#### PUT /api/v1/notifications/preferences

**Body** — `inApp` (bool), `push` (bool), `email` (bool), `sms` (bool), `whatsapp` (bool), `quietHoursFrom` (`"HH:MM"`, opc.), `quietHoursTo` (`"HH:MM"`, opc.). `quietHoursFrom` y `quietHoursTo` van juntos o ninguno (CHECK en BD). `inApp = false` no se permite: es el canal persistente de historial: `422` con `code: 'IN_APP_REQUIRED'`.

**Respuesta 200** — `data: { ...preferencias }`.

**Errores** — `400` (`INVALID_TIME_FORMAT`, `QUIET_HOURS_INCOMPLETE`), `401`, `422`.

#### POST /api/v1/notifications/:id/read

**Body** — ninguno. Idempotente (BR-NOTIF-004): si ya estaba leída, `200` sin escribir.

**Respuesta 200** — `data: Notification` con `status = READ` y `readAt`. Si no era del usuario: `404`.

**Errores** — `401`, `404`.

#### POST /api/v1/notifications/read-all

**Body** — `type` (`NotificationType`, opc.; si se envía, solo de ese tipo), `before` (ISO, opc.).

**Respuesta 200** — `data: { updated: 23, unreadCount: 0 }`.

**Errores** — `401`.

---

### 7.18 Audit — `/api/v1/audit-logs`

| Método | Path | Permiso | Descripción |
|---|---|---|---|
| GET | `/` | `audit:read` (ADMIN, OWNER) | Consultar auditoría |

#### GET /api/v1/audit-logs

Solo ADMIN y OWNER (BR-SEC-011).

**Query** — `userId` (integer), `action` (`AuditAction`), `entityType` (`user` \| `product` \| `order` \| `chair` \| `reservation` \| `rental` \| `payment` \| `discount` \| `inventory_item` \| `business` \| `export`), `entityId` (integer), `requestId` (string, 36), `ipAddress` (string, 45), `from`, `to` (ISO; default últimos 7 días), `page`, `pageSize` (default 50, máximo 200), `sort` (`createdAt`; el orden es siempre `desc` y no es configurable, por integridad del log), `order`.

**Respuesta 200** — `data: AuditLog[]` con `beforeData` y `afterData` ya sanitizados por el servidor (sin contraseñas, hashes ni tokens, BR-SEC-006), `meta: { page, pageSize, total, requestId, countsByAction }`.

**Errores** — `400` (`RANGE_TOO_LARGE` si supera 90 días), `401`, `403`, `429`.

No existe endpoint de escritura ni de borrado de auditoría. La tabla es append-only.

---

### 7.19 System

| Método | Path | Permiso | Descripción |
|---|---|---|---|
| GET | `/health` | `PÚBLICO` | Salud del servicio |
| GET | `/meta/roles` | `PÚBLICO` | Roles, permisos y matriz |
| GET | `/meta/enums` | `PÚBLICO` | Enums y transiciones |

#### GET /api/v1/health

Sondeo de vida para orquestador y balanceadores. No requiere autenticación y **no** revela detalles de la infraestructura.

**Respuesta 200** — `data: { status: "ok", version: "1.0.0", uptimeSeconds: 128374, database: { connected: true, migrationsPending: 0 }, checks: { database: "ok", scheduler: "ok" } }`, `meta: { requestId, timestamp }`.

**Respuesta 503** — `data: { status: "degraded", ... }` con `error: { code: 'SERVICE_UNAVAILABLE', message: "Servicio no disponible", details: { reason: "DATABASE_UNAVAILABLE" } }`. Sin detalles de conexión, sin DSN, sin stack.

**Errores** — `503`. Nunca `500` por un problema de base de datos: un fallo de dependencia es `503`, no un error del servidor.

#### GET /api/v1/meta/roles

**Respuesta 200** — `data: { roles: [{ id, name, description, isSystem, permissionCount }], permissions: [{ key, module, description }], matrix: { [roleName]: { [permissionKey]: 'C' | 'P' | '-' } }, hierarchy: ["OWNER","ADMIN","MANAGER","CASHIER","STAFF","CUSTOMER"], defaults: { [roleName]: [permissionKey] } }`. Es exactamente el contenido de `DESIGN.md` 9.2 y 9.3, leído de `role_permissions`. El frontend no duplica la matriz.

**Errores** — ninguno en condiciones normales; `503` si la base de datos no responde.

#### GET /api/v1/meta/enums

Fuente única de enumerados y transiciones. El frontend **no** debe duplicarlos.

**Respuesta 200** — `data: { enums: { Role, UserStatus, ChairKind, ChairStatus, ReservationStatus, RentalStatus, OrderType, OrderStatus, OrderItemStatus, PaymentMethod, PaymentProvider, PaymentStatus, DiscountType, DiscountAppliesTo, InventoryMovementType, OrderChannel, ReservationSource, NotificationType, NotificationChannel, NotificationStatus, AuditAction, InventorySourceKind, OrderGroupBy, ReportOrderBy, CustomerSegment }, transitions: { orders: [{ from, to, roles: ["CASHIER","MANAGER"], label, endpoint }], chairReservations: [...], chairRentals: [...], chairs: [...], payments: [...] }, forbidden: { orders: [{ from, to, reason }], ... }, businessRules: [{ id: "BR-RENTAL-001", summary, endpoints: ["/api/v1/rentals/:id/complete"] }], formats: { currencyCode, currencySymbol, locale, timezone, dateExample, dateTimeExample, timeExample, priceExample: "$5.000" } }`, `meta: { requestId, generatedAt, version: "1.0.0" }`.

`transitions[entity]` incluye el `endpoint` que ejecuta la transición, para que el frontend sepa qué botón habilitado pintar y a dónde llamar. `formats` permite que el cliente formatee igual que el servidor, sin hardcodear.

**Contrato de consistencia**: este endpoint lee `domain/enums/transitions.ts`, la misma fuente que valida los services. Si divergen, es un bug crítico.

**Errores** — ninguno en condiciones normales; `503` si la base de datos no responde.

---

## 8. Notas de implementación

### 8.1 Checklist de contrato

1. `GET /api/v1/meta/enums` y `domain/enums/transitions.ts` devuelven **exactamente** las mismas transiciones.
2. `GET /api/v1/meta/roles` y `role_permissions` coinciden.
3. Todo endpoint de `API.md` está montado en `routes/v1/` y viceversa: ni uno de más, ni uno de menos.
4. Todo endpoint mutante tiene su entrada en `audit_logs` con `action` y `entity_type` correctos.
5. Todo endpoint con respuesta de lista devuelve el envoltorio con `meta.page`, `meta.pageSize`, `meta.total`, `meta.requestId`.
6. Todo endpoint de error devuelve `{ success: false, error: { code, message, details? }, requestId }` y nunca HTML.
7. Ningún endpoint acepta totales calculados por el cliente.
8. `POST /payments` es el único que exige `Idempotency-Key`.
9. Todo listado tiene paginación y orden estable.
10. Los permisos de `API.md` coinciden con `DESIGN.md` 9.2 y 9.3.

### 8.2 Códigos de error de dominio usados en `error.details.code`

Estos valores son estables y el frontend puede ramificar por ellos sin parsear mensajes:

| Grupo | Valores |
|---|---|
| Pedidos | `INVALID_ORDER_TRANSITION`, `ORDER_IMMUTABLE`, `ORDER_NOT_EDITABLE`, `ORDER_NOT_DELETABLE`, `EMPTY_ORDER`, `ORDER_NOT_PAYABLE`, `ORDER_NOT_CONFIRMED`, `RENTAL_REQUIRES_CHAIR_AND_RESERVATION`, `MIXED_ORDER_TYPE_NOT_ALLOWED`, `LAST_ITEM_REMOVAL` |
| Reservas y alquileres | `CHAIR_ALREADY_RESERVED`, `CHAIR_OCCUPIED`, `CHAIR_NOT_BOOKABLE`, `CHAIR_IN_USE`, `CHAIR_BLOCKED`, `INVALID_RESERVATION_TRANSITION`, `INVALID_CHAIR_STATUS_TRANSITION`, `RESERVATION_TOO_LONG`, `RESERVATION_NOT_ACTIVE`, `RESERVATION_ALREADY_ACTIVE`, `RENTAL_NOT_ACTIVE`, `RENTAL_END_BEFORE_START`, `EXTENSION_TOO_LONG` |
| Catálogo | `PRODUCT_UNAVAILABLE`, `PRODUCT_SKU_TAKEN`, `PRODUCT_SLUG_TAKEN`, `PRODUCT_NOT_FOUND`, `CATEGORY_SLUG_TAKEN`, `CATEGORY_HAS_PRODUCTS`, `VARIANT_NAME_TAKEN`, `ADDON_NAME_TAKEN`, `ADDON_SELECTION_LIMIT`, `ADDON_NOT_IN_PRODUCT`, `INVALID_VARIANT_PRICE`, `MAX_SELECT_REQUIRES_MULTIPLE`, `LAST_DEFAULT_VARIANT`, `INGREDIENT_ALREADY_IN_RECIPE` |
| Descuentos | `DISCOUNT_INVALID`, `DISCOUNT_CODE_TAKEN`, `DISCOUNT_CODE_IN_USE`, `DISCOUNT_LIMIT_REACHED`, `DISCOUNT_EXCEEDED_PER_CUSTOMER`, `DISCOUNT_MIN_ORDER_NOT_MET`, `PERCENT_VALUE_OUT_OF_RANGE`, `MAX_DISCOUNT_REQUIRED`, `APPLIES_TO_REQUIRES_TARGET` |
| Inventario | `NEGATIVE_STOCK_BLOCKED`, `INVENTORY_SOURCE_REQUIRED`, `INVENTORY_ITEM_EXISTS`, `INVENTORY_SKU_TAKEN`, `ITEM_NOT_TRACKED`, `MOVEMENT_TYPE_NOT_MANUAL`, `REASON_REQUIRED`, `INVALID_ADJUSTMENT`, `ITEM_HAS_MOVEMENTS` |
| Pagos | `PAYMENT_REQUIRES_ORDER`, `PAYMENT_EXCEEDS_TOTAL`, `PAYMENT_ALREADY_PROCESSED`, `PROVIDER_REQUIRED`, `IDEMPOTENCY_KEY_REQUIRED`, `REFUND_EXCEEDS_PAID`, `REFUND_NOT_ALLOWED`, `INVALID_AMOUNT`, `INVALID_AMOUNT_FOR_METHOD` |
| Usuarios y auth | `EMAIL_TAKEN`, `ROLE_NOT_FOUND`, `ROLE_ALREADY_ASSIGNED`, `LAST_OWNER_PROTECTED`, `SELF_ROLE_REMOVAL_FORBIDDEN`, `SELF_DELETE_FORBIDDEN`, `SELF_DEACTIVATION_FORBIDDEN`, `INVALID_RESET_TOKEN`, `PASSWORD_MISMATCH`, `PASSWORD_TOO_WEAK`, `PASSWORD_SAME_AS_CURRENT` |
| Genéricos | `MISSING_TOKEN`, `INVALID_TOKEN`, `TOKEN_EXPIRED`, `TOKEN_REVOKED`, `TOKEN_REUSE`, `INVALID_CREDENTIALS`, `INSUFFICIENT_PERMISSIONS`, `RESOURCE_BUSY`, `DUPLICATE`, `INVALID_DATE_RANGE`, `RANGE_TOO_LARGE`, `INVALID_SORT_FIELD`, `INVALID_PRESET`, `FIELD_NOT_EDITABLE`, `RANGE_TOO_LARGE`, `EXPORT_TOO_LARGE`, `INVALID_REPORT`, `INVALID_COLUMNS`, `HOLIDAY_ALREADY_EXISTS`, `INCOMPLETE_WEEK`, `DUPLICATE_DAY_OF_WEEK`, `INVALID_TIME_FORMAT`, `INVALID_TIMEZONE`, `INVALID_CURRENCY`, `INVALID_SLUG`, `PROMO_PRICE_NOT_LOWER`, `PROMO_WINDOW_INVALID`, `LOCATION_NAME_TAKEN`, `ZONE_NAME_TAKEN`, `ZONE_CODE_TAKEN`, `ZONE_NOT_EMPTY`, `ZONE_LOCATION_MISMATCH`, `DUPLICATE_ID`, `CHAIR_CODE_TAKEN`, `CHAIR_CODE_IMMUTABLE`, `CHAIR_NOT_BLOCKED`, `CHAIR_NOT_IN_MAINTENANCE`, `CHAIR_HAS_ACTIVE_BOOKING`, `QUIET_HOURS_INCOMPLETE`, `IN_APP_REQUIRED`, `ALREADY_APPLIED` |

### 8.3 Convenciones no repetidas aquí

- Restricciones de `sort` por endpoint: la allowlist está en el service; un campo no listado da `400` con `INVALID_SORT_FIELD`.
- Formato de `features` de sillas: `string[]` de un vocabulario cerrado (`wifi`, `outlet`, `view`, `accessible`, `tv`, `quiet`).
- `POST /reports/export` es la única respuesta que no usa el envoltorio JSON.
- Los reportes con `preset=custom` exigen `from` y `to`; los de rango corto no aceptan `preset`.

---

Fin de API.md. **157 endpoints documentados.**



