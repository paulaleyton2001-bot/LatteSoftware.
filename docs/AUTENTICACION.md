# Autenticación y autorización

Modelo de sesiones, RBAC, alcance por propietario y flujos de `/api/v1/auth/*`.
El contrato de cada endpoint está en [`API.md`](./API.md) §2 y §7.1; el diseño
y las reglas `BR-SEC-*` en [`DESIGN.md`](./DESIGN.md) §4.1, §9 y §11. Esta
página resume y explica el porqué.

---

## 1. Modelo de sesión

| Token | Formato | TTL | Almacenamiento |
|---|---|---|---|
| **Access** | JWT **HS256** | **15 min** (`JWT_ACCESS_TTL`) | No se almacena: es stateless |
| **Refresh** | Valor **opaco**, 48 bytes de `crypto.randomBytes` en base64url | **30 días** | Sólo su **SHA-256** en `refresh_tokens.token_hash` (`UNIQUE`) |
| Reset de contraseña | Opaco, 32 bytes | 30 min | Sólo su SHA-256, en columnas de `users` |

Claims del access token: `sub` (id), `email`, `roles`, `businessId`, `sid` (id
de la sesión) y `typ: 'access'`, más `iat`/`exp`.

`sid` es el `id` de la fila vigente en `refresh_tokens`. Permite revocar "esta
sesión" de forma selectiva (`DELETE /auth/sessions/:id`) y marcar cuál es la
actual en `GET /auth/sessions`, sin ambigüedad.

**El `businessId` sale siempre del token, nunca del cuerpo ni de la query**
(BR-SEC-008). Cuando aún no hay actor (registro, login), sale del negocio
singleton (`businesses.id = 1`).

### Por qué un refresh opaco hasheado y no un JWT de larga duración

Un JWT de 30 días firmado no se puede revocar: el servidor no tiene nada que
consultar. Eso deja tres puertas que un POS no puede permitirse.

| Problema | Con JWT de larga duración | Con refresh opaco en la base |
|---|---|---|
| **Cierre de sesión** | No se revoca hasta que caduca | `revoked_at` y listo |
| **Robo de token** | Se usa hasta 30 días sin que nadie se entere | Uso anómalo detectable (§3) |
| **Cambio de contraseña** | Los tokens emitidos antes siguen vivos | Se revocan **todas** las sesiones en la misma transacción (BR-SEC-003) |
| **"Cerrar todas las sesiones"** | Imposible | Un `UPDATE ... WHERE user_id = ? AND revoked_at IS NULL` |

El coste es una consulta por refresh: un refresh cada 15 minutos por usuario, y
es un índice único sobre `token_hash`. Irrelevante.

**El valor en claro se devuelve una sola vez**, en la respuesta de login o de
refresh. No se registra, no se audita y no sale en ninguna otra respuesta.

Código: [`token.service.ts`](../backend/src/modules/auth/token.service.ts).

---

## 2. Almacenamiento del refresh

`refresh_tokens` (creada en
[`0001_init.sql`](../backend/src/database/migrations/0001_init.sql)):

```sql
CREATE TABLE refresh_tokens (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL,
  token_hash     TEXT NOT NULL,      -- sha256(token) hex. UNIQUE
  device_info    TEXT,
  ip_address     TEXT,
  expires_at     TEXT NOT NULL,
  revoked_at     TEXT,               -- NULL = viva
  replaced_by_id INTEGER,            -- el token que la sustituyó al rotar
  created_at     TEXT NOT NULL DEFAULT (...),
  CONSTRAINT ux_refresh_tokens_token_hash UNIQUE (token_hash),
  FOREIGN KEY (user_id)        REFERENCES users(id)          ON DELETE CASCADE,
  FOREIGN KEY (replaced_by_id) REFERENCES refresh_tokens(id) ON DELETE SET NULL
);
```

`revoked_at` responde "¿esta sesión sigue viva?" y `replaced_by_id` reconstruye
la cadena de rotaciones de una familia. Son las dos columnas que hacen posible
todo lo demás.

El hash es SHA-256, no bcrypt, y es deliberado: el refresh token son 48 bytes de
entropia criptográfica, no una contraseña elegida por una persona. Buscar un
token de 384 bits por su SHA-256 no es atacable, y un hash determinista es el
único que permite `WHERE token_hash = ?` sobre un índice. bcrypt sirve para lo
que el usuario elige, no para lo que genera el servidor.

`device_info` e `ip_address` se guardan con cada sesión para que
`GET /auth/sessions` pueda mostrar "este dispositivo, desde esta IP, creado
el...".

---

## 3. Rotación y detección de reuso

Cada `POST /auth/refresh` emite un token **nuevo** y revoca el anterior
apuntando al nuevo (`replaced_by_id`). Un refresh token es de un solo uso.

Si alguien reutiliza un token ya usado, el backend detecta el robo:

```
Cliente legítimo                    Atacante con copia del token viejo
────────────────                    ────────────────────────────────────
login -> R1                          (observa R1 en algún sitio)
refresh(R1) -> R2   [R1 revocado,
                      replaced_by_id = R2]
                                    refresh(R1)  <-- R1 ya está revocado
                                       |
                                       v
                          DETECTADO REUSE
                          - se revocan TODAS las sesiones del usuario
                          - audit REFRESH_TOKEN_REUSE
                          - 401 TOKEN_REUSE
```

`auth.service.ts:367-388`. La revocación de la familia y la auditoría van en su
**propia transacción**, fuera de la del caso de uso: si estuvieran dentro, el
`ROLLBACK` del error borraría precisamente la evidencia y la revocación, y el
robo quedaría sin consecuencia.

### Por qué es una defensa real

Es la asimetría entre el atacante y el usuario legítimo:

- El atacante tiene el token **viejo**. Puede seguir intentando, pero cada
  intento es un 401.
- El token **nuevo** (R2) sigue vivo, en manos del legítimo. Quien robó R1 no lo
  tiene y no puede emitir R3.
- Al revocar la familia, R2 también cae. El legítimo tiene que autenticarse de
  nuevo, pero **el atacante no puede**: no tiene la contraseña y sus tokens
  están revocados.

Ante la duda, el sistema corta **las dos sesiones**. El coste para el usuario es
un login; el beneficio es que el atacante queda fuera. Sin esto, el ladrón
mantiene acceso 30 días sin que nadie lo note.

El mismo razonamiento aplica a cambio de contraseña, reseteo y bloqueo de
cuenta: **todos revocan todas las sesiones** (BR-SEC-003, BR-SEC-004).

---

## 4. Contraseñas

[`password.service.ts`](../backend/src/modules/auth/password.service.ts) con las
constantes en [`constants.ts`](../backend/src/config/constants.ts).

| Aspecto | Decisión |
|---|---|
| Algoritmo | **bcrypt** vía `bcryptjs` (JS puro, sin compilación nativa) |
| Coste | **12** (`BCRYPT_COST_ROUNDS`, rango 10-15) |
| Longitud | 8 a **72** caracteres. 72 es el límite de bcrypt: lo que pase se trunca, así que se rechaza en vez de truncar |
| Clases | Al menos **3 de 4**: mayúsculas, minúsculas, dígitos, símbolos |
| Triviales | Lista negra corta (`password`, `qwerty`, `lattecoffe1`...) más repetitivas (`aaaaaaaa`, `abababab`) |

Dos detalles que no son evidentes:

1. **La lista negra se compara contra la "forma núcleo"** (minúsculas, sólo
   letras y dígitos). Sin eso, `Password#1` pasaría como nueva cuando es
   `password1` con dos caracteres añadidos, que es el truco de los diccionarios.
2. **Una sola palabra alfabética sin cifras ni símbolos se rechaza**: es una
   contraseña de diccionario por definición.

`assertPasswordPolicy` está en **un solo sitio** y lo reutilizan todos los
endpoints que aceptan una contraseña: registro, login, reseteo, cambio y alta
por un administrador. Devuelve `400` con `details` por campo (el frontend lo
muestra junto al input sin parsear códigos), conservando el código estable
`PASSWORD_TOO_WEAK` en `details.code`.

**El hash nunca sale en ninguna respuesta.** `GET /auth/me` no lo incluye, el
alta de usuario no lo devuelve, y el reseteo administrativo **nunca** devuelve
una contraseña: emite un token de un solo uso. Hay tests que lo comprueban en
`tests/auth.spec.ts` y `tests/seed.spec.ts`.

---

## 5. Anti-enumeración de cuentas

Un login que dice "ese correo no existe" es un oráculo de enumeración: un
atacante puede recorrer la base de clientes de un negocio. Se tapa de tres
formas.

**1. Mismo mensaje y mismo código.** Email inexistente y contraseña incorrecta
producen el mismo `AuthenticationError`, con el mismo mensaje y el mismo
`details.code = 'INVALID_CREDENTIALS'` (`auth.service.ts`, una única función
`invalidCredentials()`).

**2. Mismo tiempo de respuesta.** Si el email no existe y el código hace
`return` inmediato, el tiempo lo delata. `password.service.ts` genera **una vez
por proceso** un hash bcrypt señuelo y ejecuta un `compare` real contra él:

```ts
export function burnTimingForUnknownUser(plain: string): void {
  verifyPassword(plain, decoyPasswordHash());
}
```

El coste es idéntico al de un login que sí verifica. Nadie conoce el valor
hasheado, así que ningún `compare` puede devolver `true` por accidente.

**3. `forgot-password` responde igual.** 200 con el mismo mensaje exista o no la
cuenta, y genera un token aunque el usuario no exista, para que el trabajo
aproximado sea el mismo. La existencia de un correo no es información pública:
al revés de un login, aquí la diferencia se nota en la bandeja de entrada.

**La excepción deliberada:** `BLOCKED` e `INACTIVE` sí tienen código y mensaje
propios (403). Son estados que el usuario necesita conocer para contactar con el
negocio.

---

## 6. RBAC

### Los 6 roles

| Rol | Naturaleza | Qué puede hacer |
|---|---|---|
| `CUSTOMER` | Externo | Sus propios pedidos, reservas, alquileres, pagos, perfil y notificaciones. Registra y autentica. **Nada más** |
| `STAFF` | Interno | Sala: mapa de sillas, crear reservas, check-in, marcar pedidos listos. **No cobra** |
| `CASHIER` | Interno | Todo lo de `STAFF` más cobro, recibos, pagos y consulta de pedidos del día. **No cambia catálogo ni precios** |
| `MANAGER` | Interno | Catálogo, inventario, descuentos, zonas, sillas, reportes operativos y reembolsos |
| `ADMIN` | Interno | Todo lo de `MANAGER` más usuarios, roles, configuración del negocio y auditoría |
| `OWNER` | Interno | Control total del despliegue, incluida la matriz de permisos. No puede degradarse a sí mismo ni borrar el último OWNER |

Jerarquía: `OWNER > ADMIN > MANAGER > CASHIER > STAFF > CUSTOMER`.

### Los 83 permisos

Las claves `modulo:accion` viven en
[`permissions.ts`](../backend/src/shared/domain/permissions.ts) y son la
**misma** fuente para tres cosas: los middlewares
(`requirePermission(PERMISSION.USERS_READ)`), la semilla que inserta las filas
en `permissions`, y `GET /api/v1/meta/roles` + `GET /auth/me`, que las leen de
la base.

Si una clave se escribiera a mano en una ruta y no estuviera en ese fichero, el
`requirePermission` no encontraría nada en `role_permissions` y el endpoint
quedaría **cerrado para siempre**. El compilador es la primera barrera y
`PermissionKey` es la segunda.

| Módulo | Nº | Módulo | Nº | Módulo | Nº |
|---|---|---|---|---|---|
| `auth` | 7 | `chairs` | 7 | `orders` | 8 |
| `users` | 7 | `reservations` | 7 | `payments` | 4 |
| `customers` | 2 | `rentals` | 6 | `reports` | 2 |
| `business` | 4 | `categories` | 4 | `notifications` | 2 |
| `locations` | 3 | `products` | 6 | `audit` | 1 |
| `zones` | 4 | `inventory` | 4 | `discounts` | 5 |

**Total: 83.** La prosa de `DESIGN.md` §9.3 dice "84" pero sus dos apartados
normativos contienen 83. La discrepancia está razonada en la cabecera de
[`roles-permissions.seed.ts`](../backend/src/database/seeds/roles-permissions.seed.ts):
se siembran 83 porque son las únicas claves que el documento define en algún
sitio, e inventar una "para llegar a 84" sería fabricar un permiso que ninguna
ruta usa. Una comprobación cruzada en tiempo de semilla aborta si la matriz y
la lista divergen.

### Las cuatro tablas

| Tabla | Contenido |
|---|---|
| `roles` | Los 6 roles del sistema |
| `permissions` | Catálogo de claves `modulo:accion` |
| `role_permissions` | Matriz rol × permiso |
| `user_roles` | Asignación de roles a usuarios (N:M) |

La comprobación se hace **siempre contra la base de datos**, nunca contra una
matriz hardcodeada: la matriz de `DESIGN.md` §9.3 *es* la semilla, y
`GET /meta/roles` la lee de la base, así que ambas quedan sincronizadas por
construcción.

La caché es **por petición** (el `authenticate` ya cargó los permisos
efectivos al construir el `UserContext`). No hay caché global: revocar un
permiso surte efecto en la siguiente petición sin reiniciar el proceso.

Semántica de roles: **OR**. Si el actor tiene varios, basta con que uno conceda
el permiso. `OWNER` y `ADMIN` tienen implícitos todos los permisos
(BR-RBAC-002) y el middleware los deja pasar sin consultar la tabla, aunque
`GET /auth/me` sigue devolviendo la lista completa.

Matriz completa: [`DESIGN.md`](./DESIGN.md) §9.3.

### La regla de oro: el backend verifica, el frontend nunca decide

El frontend oculta botones, deshabilita menús y **nada más**. Es cortesía de
interfaz, no control de seguridad: una petición hecha con `curl` o con el
`Authorization` de otro usuario llega igual, y lo único que responde es el
`requirePermission` del servidor.

**Ocultar un botón no es un permiso.** Un permiso nuevo exige el
`requirePermission` en la ruta, la fila en `role_permissions` y el test 403 que
lo demuestra.

Un permiso ausente produce **403** con `details.required`, nunca 404. Un recurso
que existe pero es de otro cliente produce **404**, nunca 403: no se revela su
existencia.

---

## 7. Alcance por propietario

La marca `P` de la matriz (`DESIGN.md` §9.3) significa "parcial": **el
middleware resuelve el permiso y el service resuelve el alcance**. Para un
`CUSTOMER`, `customerId` sale **siempre del token**, nunca del cuerpo.

### Los dos IDOR que se corrigieron durante el desarrollo

Documentados en
[`tests/security-regression.spec.ts`](../backend/tests/security-regression.spec.ts),
que existe para fijarlos. La suite anterior **no los cubría**: todos los tests
de alcance usaban un `customerId` que era el del propio actor, o lo omitían.

**1. Crear una reserva a nombre de otro.** `resolveCustomerId` devolvía
`input.customerId` tal cual en cuanto no era `null`, sin comprobar el rol. Un
`CUSTOMER` podía crear una reserva a nombre de un tercero, o una "de mostrador"
con `customerId: null` que se quedaba sin dueño y **le robaba la silla al resto
del día**: bloqueaba el inventario y el atacante no podía ni verla para
cancelarla. Impacto: atribución fraudulenta y denegación de servicio.

**2. Manipular reservas de mostrador ajenas.** `assertCanAccess` devolvía `ok`
en cuanto `row.customer_id === null`, así que cualquier cliente autenticado
podía leer, confirmar y cancelar reservas de mostrador ajenas. Con
`reservations:cancel` en marca `P`, eso era un IDOR completo.

La corrección fuerza el `customerId` del token para un `CUSTOMER`, y el test
comprueba **las dos caras**: el cajero sigue pudiendo crear una reserva sin
cliente. También comprueba que el 404 al recurso ajeno llega **antes** de mutar
nada: la reserva sigue viva después del intento.

---

## 8. Flujos

**Login.** Normalizar el email a minúsculas (BR-SEC-010) y buscar credenciales →
si no existe, `compare` señuelo + auditoría + 401; si la contraseña no cuadra,
auditoría + 401 (el mismo error); si el estado no es `ACTIVE`, revocar todas las
sesiones + 403 con el código del estado. Después, en transacción: releer el
usuario (otro proceso pudo bloquearlo), insertar el refresh con su SHA-256,
actualizar `last_login`, auditar `LOGIN`, y firmar el JWT con `sid` = id del
nuevo refresh.

**Refresh.** Los 8 pasos de `DESIGN.md` §11.2
([`auth.service.ts:347-433`](../backend/src/modules/auth/auth.service.ts)). Lo no
obvio: el camino de reuso y el de expirado abren su propia transacción, porque
la respuesta es un error y el `ROLLBACK` borraría la evidencia.

**Logout.** Revoca la sesión del `sid` del token. Es **idempotente**: si ya
estaba revocada, responde 200 con `revokedSessions: 0`. Un token sin `sid`
(emitido por una versión anterior) revoca todas las sesiones: es lo único
seguro.

**Logout-all.** Revoca todas las sesiones del actor. `currentPassword` es
**opcional**: si viene, se verifica y un fallo es 403, para que un token robado
no pueda cerrar todas las sesiones sin saber la contraseña.

**Recuperación de contraseña.** `forgot-password` responde 200 siempre, genera
el token (de 32 bytes) si el usuario existe, lo descarta si no, y **sólo en
desarrollo** registra el enlace en el log. `reset-password` busca por
`users.password_reset_token_hash`; no existe, expiró o ya se usó producen el
**mismo** mensaje. En transacción: cambia la contraseña, anula el token y revoca
todas las sesiones. El token es de un solo uso.

**Cambio de contraseña.** Fase 1, fuera de transacción: verifica
`currentPassword` (si falla, 401 con auditoría en transacción propia) y rechaza
que la nueva sea igual. Fase 2, en transacción: **vuelve a verificar** la actual,
porque otro dispositivo pudo cambiarla entre medias
(`PASSWORD_CHANGED_CONCURRENTLY`). Luego cambia, revoca todas las sesiones y, con
`keepCurrentSession` (por defecto `true`), rota la del dispositivo actual para no
dejar al usuario sin sesión.

**Sesiones activas.** `GET /auth/sessions` devuelve las del actor con
`isCurrent`. `DELETE /auth/sessions/:id` revoca una propia: sólo del actor (si el
id es de otro, **404**), la sesión actual **no** se puede revocar aquí (`422
CURRENT_SESSION` con pista a `POST /auth/logout`), y es idempotente (200 con
`meta.warnings: ['ALREADY_REVOKED']`).

---

## 9. Rate limiting

Tres limitadores, todos en
[`rate-limit.ts`](../backend/src/shared/middleware/rate-limit.ts):

| Alcance | Ventana | Máximo | Variable |
|---|---|---|---|
| Global (toda la API) | 1 min | 300 | `RATE_LIMIT_MAX` |
| `/api/v1/auth/*` | 1 min | 20 | `AUTH_RATE_LIMIT_MAX` |
| `forgot-password` + `reset-password` | 1 h | **3** | `AUTH_PASSWORD_RATE_LIMIT_MAX` |

Los dos últimos se montan por ruta en `auth.routes.ts`. El de recuperación
**comparte contador** entre las dos rutas: un atacante que rebota entre ellas no
multiplica su presupuesto. Respuesta: `429` con
`error.code = 'RATE_LIMIT_ERROR'`, `Retry-After` y cabeceras `RateLimit-*`.

### Limitación conocida

**Todos los limitadores son por IP, y no hay límite por cuenta.** Deuda
conocida:

- **Una red con varios dispositivos tras la misma NAT** (un café con tres
  tablets y un portátil en la misma wifi) comparte una sola cuota. Con 20/min,
  una hora de operación con reintentos legítimos puede agotar la cuota de
  `/auth/*` para **todos** a la vez. En el caso extremo del límite de
  recuperación (3 por hora), dos empleados que olvidaron su contraseña dejan el
  servicio inaccesible para todo el local.
- **Un atacante puede rotar IP** y multiplicar su presupuesto sin tope.
- **Un ataque distribuido contra una cuenta concreta** no lo frena el límite
  por IP: 20/min por IP son 28.800 intentos diarios, y con IPs rotando son
  ilimitados.

`DESIGN.md` §11.3 **sí** prevé límites por usuario en endpoints autenticados
(`change-password` a 10/15 min por usuario, escrituras a 120/min/usuario). La
implementación **no los aplica**: los tres usan `keyGenerator: keyByIp`. La
infraestructura está (`express-rate-limit` acepta una clave compuesta), pero el
cambio no está hecho.

Mitigación actual: bcrypt con coste 12 hace que un intento por login cueste
~250 ms, lo que hace el ataque carísimo por sí solo aunque el límite no sea
perfecto.

---

## 10. Desde el frontend

### Dónde se guardan los tokens

`flutter_secure_storage`, **nunca** `shared_preferences`. Este último guarda en
texto plano (`localStorage` en web, XML en Android). Un refresh token robado
permite emitir access tokens válidos durante media hora. El almacén seguro usa
el Keychain en iOS/macOS, el Keystore en Android y `localStorage` cifrado con
WebCrypto en web (que **exige** servir la página por HTTPS o desde `localhost`;
sin WebCrypto el plugin degrada a "sin sesión persistente" en vez de romper el
arranque).

Implementación:
[`token_storage.dart`](../frontend/lib/core/storage/token_storage.dart). El
interceptor lee el token en **cada** petición, y leer del almacén del sistema
cada vez cuesta un platform channel, así que hay un **espejo en memoria**: una
lectura del disco al arrancar y de ahí en adelante una variable.

### Cómo se refresca de forma segura: un único refresh en vuelo

Éste es el punto donde un POS se tira solo si se implementa mal.

**El problema.** Cada `POST /auth/refresh` **rota** el token y **revoca** el
anterior. En el arranque del POS es normal disparar tres peticiones a la vez
(menú, negocio, sillas). Si las tres reciben un 401 y cada una refresca por su
cuenta, la segunda ya presenta un token **revocado**: el backend lo detecta
como **REUSE** y revoca **todas** las sesiones. El usuario pierde el turno
entero por un bug de concurrencia del cliente.

**La solución: single-flight**
([`session_refresher.dart`](../frontend/lib/core/network/session_refresher.dart)):

```dart
Future<StoredSession?> refresh() {
  final pending = _inFlight;
  if (pending != null) return pending;      // hay una en curso: se comparte

  final started = _run();
  _inFlight = started;                      // asignado SÍNCRONAMENTE,
  return started.whenComplete(() {          // antes de cualquier await
    if (identical(_inFlight, started)) _inFlight = null;
  });
}
```

Cuatro detalles lo hacen correcto:

1. La ranura se asigna **de forma síncrona, antes de cualquier `await`**: si se
   asignara después, otra llamada se colaría en el hueco.
2. `whenComplete` la libera **tanto en éxito como en error**: un fallo no deja la
   sesión bloqueada para siempre.
3. Nunca lanza: un fallo se traduce en `null` y el llamador decide.
4. La petición de refresh va con `extra: { authSkip: true }`, para que un 401 ahí
   no dispare otro refresh ni se adjunte un Bearer caducado.

El `auth_interceptor.dart` sólo delega: renueva proactivamente si el access
token caduca dentro de `tokenRefreshLeeway`, y ante un 401 renueva y reintenta
la petición original **una única vez** (`extra['authRetry']` impide el bucle).

**No hay tests de esto**, porque no hay SDK de Flutter en el entorno. Es la pieza
del frontend que más falta le hacen: ver [`TESTING.md`](./TESTING.md) §8.

---

## 11. Qué NO hay

| No existe | Estado real |
|---|---|
| **Pasarela de pagos** | No hay integración con ninguna. `PAYMENT_PROVIDER=MOCK` es un valor de configuración que no conecta a nada. Se cobra en el mostrador, en efectivo o con datáfono, y `provider` puede ser `CARD_TERMINAL` (migración `0003`). `GET /payments/methods` devuelve exactamente `CASH` y `CARD`; `TRANSFER` y `ONLINE` se rechazan |
| **Verificación de email** | **No hay `email_verified_at` ni endpoint público de verificación.** Las cuentas se crean activas; un alta se autentica de inmediato |
| **Recuperación por correo real** | **No hay proveedor de correo.** El token se genera, se hashea, se guarda y se audita correctamente; lo que falta es el envío. El enlace **sólo se registra en el log y únicamente fuera de producción** (`env.isProduction`). En producción el endpoint responde 200 y no envía nada |
| **Doble factor (MFA)** | No está contemplado |
| **Límite de tasa por cuenta** | Sólo por IP (§9) |
| **Revocación de un access token ya emitido** | No es posible, por diseño: son 15 minutos. El `sid` permite revocar la sesión, pero un access token vivo sigue siendo válido hasta que caduca. Lo que corta de verdad es el bloqueo de la cuenta, porque `authenticate` relee el usuario de la base en cada petición |
