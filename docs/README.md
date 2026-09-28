# Documentación técnica — LatteCoffe POS

Contrato normativo del sistema. Los agentes que implementen deben seguir estos documentos de forma literal. Si el código difiere de lo escrito, el código es incorrecto.

| Documento | Contenido | Tamaño |
|---|---|---|
| [`DESIGN.md`](./DESIGN.md) | Arquitectura, modelo de datos (34 tablas), máquinas de estado, reglas de negocio, concurrencia, RBAC, migración a PostgreSQL, seguridad, logging | ~2 700 líneas |
| [`API.md`](./API.md) | Contrato de endpoints REST v1 (157 endpoints), envoltorio de respuesta, códigos de error, paginación, filtros | ~1 900 líneas |

## Índice por archivo

### DESIGN.md

| Sección | Contenido | Responde a |
|---|---|---|
| 1 | Visión, principios, criterios de prioridad, convenciones de unidades | Por qué el sistema es como es |
| 2 | Árbol de directorios completo (backend, frontend, tests) | Dónde va cada archivo |
| 3 | Arquitectura por capas, unidad de trabajo explícita, prohibiciones | Cómo se separa el dominio de SQLite |
| 4 | Modelo de datos: 34 tablas con columnas, tipos, constraints e índices | Qué tablas y columnas existen |
| 5 | Diagrama `erDiagram` con todas las relaciones | Cómo se conectan las tablas |
| 6 | Máquinas de estado de `orders`, `chair_reservations`, `chair_rentals`, `chairs`, `payments` | Qué transiciones existen y cuáles están prohibidas |
| 7 | 100+ reglas de negocio con identificador estable `BR-AREA-NNN` | Qué reglas aplica el sistema |
| 8 | Concurrencia, `BEGIN IMMEDIATE`, rollback, los 6 pasos de creación de pedido | Cómo se evita el overbooking y el cobro doble |
| 9 | RBAC: 6 roles, 84 permisos, matriz completa | Quién puede hacer qué |
| 10 | Estrategia de migración a PostgreSQL | Qué se porta y qué se adapta |
| 11 | Seguridad: bcrypt, JWT, refresh rotativo, rate limits, CORS, helmet, sanitización, password reset | Cómo se protege el sistema |
| 12 | Logging estructurado: qué se loguea y qué nunca | Qué es observable |
| 13 | Decisiones, desviaciones, exclusiones y checklist de cumplimiento | Qué se decidió y por qué |

### API.md

| Sección | Contenido |
|---|---|
| 1-6 | Convenciones, autenticación, envoltorio de respuesta, códigos de error, paginación, tipos comunes |
| 7.1-7.19 | Los 157 endpoints, agrupados por recurso: auth, users, customers, business, locations, zones, chairs, reservations, rentals, categories, products, orders, payments, discounts, inventory, reports, notifications, audit, system |
| 8 | Checklist de contrato y catálogo de códigos de error de dominio |

## Guía de lectura por rol

### Si vas a implementar el modelo de datos o las migraciones

1. `DESIGN.md` §1.4 (unidades: dinero entero, fechas UTC, `quantity` fraccionario)
2. `DESIGN.md` §4.0 (convenciones DDL obligatorias: `AUTOINCREMENT`, `created_at`/`updated_at`, CHECK de enum, `PRAGMA`)
3. `DESIGN.md` §4.1 a §4.6 (cada tabla, columna por columna)
4. `DESIGN.md` §5 (diagrama de relaciones)
5. `DESIGN.md` §8.2 (`BEGIN IMMEDIATE` y `PRAGMA` obligatorios)

Lo que no puedes inventar: nombres de tabla, nombres de columna, tipos, valores de enum, nombres de índice. Son normativos.

### Si vas a implementar la lógica de negocio

1. `DESIGN.md` §3 (capas: qué puede hacer cada una)
2. `DESIGN.md` §3.4 (unidad de trabajo; nunca repositorios globales)
3. `DESIGN.md` §6 (máquinas de estado; `domain/enums/transitions.ts` es la fuente única)
4. `DESIGN.md` §7 (las reglas `BR-*`; implementa una por una y nombra el test con el identificador)
5. `DESIGN.md` §8.5 (los 6 pasos de creación de pedido)
6. `DESIGN.md` §9 (matriz de permisos)

Preguntas frecuentes resueltas aquí:

| Pregunta | Respuesta |
|---|---|
| ¿Cómo calculo el total? | `DESIGN.md` §7.2 (BR-MONEY-003): línea -> descuento -> impuesto -> servicio -> total, redondeando en cada paso |
| ¿Redondeo hacia arriba o half-up? | Half-up con `Math.floor(x + 0.5)`, documentado en BR-MONEY-002 y su test |
| ¿Se cobra el overtime al precio viejo? | Sí, al precio congelado en `chair_rentals.price_per_hour_minor` (BR-RENTAL-003) |
| ¿Cuánto es el mínimo de un alquiler? | 30 minutos, siempre (BR-RENTAL-001) |
| ¿Cómo se evita el overbooking? | Verificación de solapamiento dentro de `BEGIN IMMEDIATE` (BR-RES-002, §8.3) |
| ¿Puedo tocar un pedido cerrado? | Solo `orders.notes`. Nada más (BR-ORDER-017) |
| ¿Qué pasa si dos clientes cobran a la vez? | `Idempotency-Key` obligatorio y verificación en la misma transacción (BR-PAY-001) |

### Si vas a implementar la API

1. `API.md` §1-6 (convenciones, envoltorio, errores, paginación)
2. `API.md` §7.1 a §7.19 (tu recurso)
3. `DESIGN.md` §9.2 (claves de permiso exactas)
4. `DESIGN.md` §6 (para no exponer transiciones inválidas)
5. `API.md` §8.1 (checklist de contrato antes de dar por terminado)

No puedes inventar: rutas, métodos, nombres de campo de request o response, códigos de error, códigos de permiso.

### Si vas a implementar el frontend (Flutter)

1. `API.md` §1-2 (base URL, auth, rotación de refresh)
2. `API.md` §3 (envoltorio; tu modelo de respuesta lo refleja)
3. `API.md` §6.3 (objetos de recurso y sus campos exactos)
4. `API.md` §7.19 (`GET /meta/enums` y `GET /meta/roles`: **no dupliques enums, transiciones ni la matriz de permisos**)
5. `API.md` §4 (códigos de error; ramifica por `error.code`, nunca por el mensaje)
6. `DESIGN.md` §1.2 (el backend es la única fuente de verdad: el total siempre es el del servidor)

### Si vas a escribir tests

1. `DESIGN.md` §7 (cada `BR-*` es un test con ese nombre)
2. `DESIGN.md` §13.4 (checklist de 12 preguntas de cumplimiento)
3. `API.md` §8.1 (checklist de contrato de API)

Casos que **deben** tener test dedicado, por ser donde se pierde dinero o se duplica reserva:

| Test | Referencia |
|---|---|
| Overbooking: dos reservas simultáneas en la misma silla | BR-RES-002, BR-RES-003, `DESIGN.md` §8.3 |
| Doble cobro: misma `Idempotency-Key` dos veces | BR-PAY-001 |
| Redondeo: `0.5`, `0.4`, `0.6`, negatives, prorrateo de descuento | BR-MONEY-002, BR-MONEY-005, BR-MONEY-011 |
| Overage: quedarse 20 min de más con precio congelado | BR-RENTAL-003, BR-RENTAL-004 |
| Mínimo de 30 minutos en un alquiler de 4 min | BR-RENTAL-001 |
| Impuestos con productos de tasas distintas | BR-TAX-004 |
| Pedido inmutable tras `COMPLETED` | BR-ORDER-017, `DESIGN.md` §6.1 |
| `COMPLETED -> PREPARING` rechazado | `DESIGN.md` §6.1 |
| Stock negativo bloqueado | BR-INV-002 |
| Aislamiento entre negocios | BR-SEC-008 |
| `403` vs `404` según el alcance del cliente | `DESIGN.md` §9.3 |

### Si vas a desplegar u operar

1. `DESIGN.md` §11 (variables, rate limits, CORS, helmet, `ENABLE_DEBUG_ERRORS`)
2. `DESIGN.md` §12 (qué revisar en los logs y qué nunca aparecerá)
3. `DESIGN.md` §8.1 (`journal_mode = WAL`, `foreign_keys = ON`, `busy_timeout = 5000`)
4. `API.md` §7.19 (`GET /health` y sus respuestas 503)
5. `DESIGN.md` §10 (qué revisar si el negocio crece y se plantea PostgreSQL)

## Convenciones de este repositorio

| Elemento | Regla |
|---|---|
| Idioma de los documentos | Español técnico. Sin emojis. Sin relleno. |
| Tablas comparativas | Markdown tables, siempre con cabecera. |
| Diagramas | Mermaid válido: `erDiagram` y `stateDiagram-v2`. |
| Identificadores de regla | `BR-<AREA>-<NNN>`, estables, nunca se renumeran ni se reutilizan. |
| Nombres de enum | `SCREAMING_SNAKE_CASE` en base de datos y en JSON. |
| Nombres de tabla y columna | `snake_case` en SQL, `camelCase` en la API. El mapeo está en los mappers. |
| Dinero | Enteros en centavos. Campo `*Minor` en la API, `*_minor` en SQL. |
| Fechas instants | `TEXT` ISO-8601 UTC con `Z`. |
| Fechas de solo día | `TEXT` `YYYY-MM-DD`, en hora local del negocio. |
| Añadir algo no especificado | Sección "Decisiones y desviaciones" de `DESIGN.md`, con justificación. |

## Orden de lectura recomendado para una persona nueva

1. `DESIGN.md` §1 (5 minutos: qué es esto y qué principios lo gobiernan)
2. `DESIGN.md` §1.1 y §1.2 (las dos líneas de negocio: venta de productos y alquiler de espacios)
3. `DESIGN.md` §4.3 (la tabla `chairs`: el heart de la parte de espacios)
4. `DESIGN.md` §4.5 (la tabla `orders`: une las dos líneas de negocio)
5. `DESIGN.md` §7.4 y §7.5 (reglas de alquiler y reservas)
6. `API.md` §7.7 y §7.8 (endpoints de sillas y reservas)
7. `DESIGN.md` §8 (por qué no se puede sobrebookear)
8. El resto, según el área que te toque.

## Estado del proyecto

| Componente | Estado |
|---|---|
| `docs/` | Contrato completo (este directorio) |
| `backend/` | Por implementar. Estructura de directorios definida en `DESIGN.md` §2.2 |
| `frontend/` | Por implementar. Estructura de directorios definida en `DESIGN.md` §2.3 |
| `tests/` | Por implementar. Estructura definida en `DESIGN.md` §2.4 |

Stack fijado y no negociable: Node.js 22+ con TypeScript, Express 5.2.1, better-sqlite3 13.0.3, zod 4.6.5, pino/pino-http, helmet, cors, express-rate-limit, bcryptjs, vitest, supertest. Frontend: Flutter + Dart, Riverpod 2, go_router, dio, fl_chart, shared_preferences. Base de datos: SQLite, con migración a PostgreSQL sin reescribir el dominio. Moneda por defecto: COP.
