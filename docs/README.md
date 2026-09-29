# Documentación técnica — LatteCoffe POS

Contrato normativo del sistema. Los agentes que implementen deben seguir estos documentos de forma literal. Si el código difiere de lo escrito, el código es incorrecto.

## Documentos

| Documento | Contenido | Tamaño |
|---|---|---|
| [`DESIGN.md`](./DESIGN.md) | Arquitectura, modelo de datos (34 tablas), máquinas de estado, reglas de negocio, concurrencia, RBAC, migración a PostgreSQL, seguridad, logging | 2 731 líneas |
| [`API.md`](./API.md) | Contrato de endpoints REST v1 (157 endpoints + 8 extensiones), envoltorio de respuesta, códigos de error, paginación, filtros | 2 024 líneas |
| [`DESIGN-TOKENS.md`](./DESIGN-TOKENS.md) | Sistema de diseño: paleta, tipografía, espaciado, componentes y sus estados. Contrato entre el diseño, el frontend y el backend | 754 líneas |
| [`BASE-DE-DATOS.md`](./BASE-DE-DATOS.md) | Guía operativa: motor, PRAGMA, migraciones, catálogo de las 34 tablas, decisiones de esquema, concurrencia, semillas, ruta a PostgreSQL | 382 líneas |
| [`TESTING.md`](./TESTING.md) | Cómo ejecutar la suite, el harness compartido, inventario de los 626 tests, casos críticos cubiertos, brechas reales, cómo añadir tests | 428 líneas |
| [`AUTENTICACION.md`](./AUTENTICACION.md) | Access JWT + refresh opaco rotativo, detección de reuso, contraseñas, anti-enumeración, RBAC, alcance por propietario, flujos, rate limits | 490 líneas |
| [`DESPLIEGUE.md`](./DESPLIEGUE.md) | Instalación, arranque, servicio systemd, nginx, backup y operación en producción | 740 líneas |

Los cuatro últimos son **guías de orientación**: resumen lo normativo y enlazan al detalle. `DESIGN.md` y `API.md` siguen siendo la fuente de verdad; si algo de las guías discrepa de ellos, mandan ellos.

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
| 9 | RBAC: 6 roles, 83 permisos, matriz completa | Quién puede hacer qué |
| 10 | Estrategia de migración a PostgreSQL | Qué se porta y qué se adapta |
| 11 | Seguridad: bcrypt, JWT, refresh rotativo, rate limits, CORS, helmet, sanitización, password reset | Cómo se protege el sistema |
| 12 | Logging estructurado: qué se loguea y qué nunca | Qué es observable |
| 13 | Decisiones, desviaciones, exclusiones y checklist de cumplimiento | Qué se decidió y por qué |

### API.md

| Sección | Contenido |
|---|---|
| 1-6 | Convenciones, autenticación, envoltorio de respuesta, códigos de error, paginación, tipos comunes |
| 7.1-7.19 | Los 157 endpoints, agrupados por recurso: auth, users, customers, business, locations, zones, chairs, reservations, rentals, categories, products, orders, payments, discounts, inventory, reports, notifications, audit, system |
| 8 | Checklist de contrato, catálogo de códigos de error, extensiones sobre el contrato original |

### Guías operativas

| Documento | Responde a |
|---|---|
| `BASE-DE-DATOS.md` | ¿Cómo se abre la base? ¿Qué PRAGMA hay y por qué? ¿Cómo se migra? ¿Qué hace cada semilla? ¿Qué cambia al pasar a PostgreSQL? |
| `TESTING.md` | ¿Cómo se ejecuta la suite? ¿Qué cubre y qué no? ¿Cómo añado un test de integración o unitario? |
| `AUTENTICACION.md` | ¿Cómo funciona una sesión? ¿Por qué el refresh es opaco? ¿Qué pasa si reutilizo un refresh token? ¿Quién puede hacer qué? |
| `DESPLIEGUE.md` | ¿Cómo se instala y arranca en producción? ¿Cómo se hace backup? ¿Qué se comprueba en el health? |

## Guía de lectura por perfil

### Soy el dueño del negocio y quiero entender qué se puede hacer

1. `BASE-DE-DATOS.md` §6 (decisiones de negocio que están en el esquema: dinero en enteros, el día del negocio es local)
2. `DESIGN.md` §1.1 (las dos líneas de negocio: venta de productos y alquiler de espacios)
3. `AUTENTICACION.md` §6 (la tabla rol → qué puede hacer, sin jerga)
4. `API.md` §7.7 a §7.9 (sillas, reservas y alquileres: lo que hace el personal de sala)

No necesitas leer el DDL. Si una pregunta es "¿puede el cajero hacer X?", la respuesta está en la matriz de `DESIGN.md` §9.3.

### Voy a programar el backend

1. `DESIGN.md` §3 (capas: qué puede hacer cada una) y §3.4 (unidad de trabajo; nunca repositorios globales)
2. `DESIGN.md` §6 (máquinas de estado; `domain/enums/transitions.ts` es la fuente única)
3. `DESIGN.md` §7 (las reglas `BR-*`; implementa una por una y nombra el test con el identificador)
4. `DESIGN.md` §7.4 y §7.5 (alquiler y reservas) y §8.5 (los 6 pasos de creación de pedido)
5. `DESIGN.md` §9 (matriz de permisos) y `AUTENTICACION.md` §6-§7 (RBAC y alcance por propietario)
6. `API.md` §1-6 (convenciones, envoltorio, errores, paginación) y §7.1-§7.19 (tu recurso)
7. `BASE-DE-DATOS.md` si tocas migraciones, seeds o SQL
8. `TESTING.md` §3 y §8 para saber qué está cubierto y cómo añadir

Preguntas frecuentes resueltas:

| Pregunta | Respuesta |
|---|---|
| ¿Cómo calculo el total? | `DESIGN.md` §7.2 (BR-MONEY-003): línea → descuento → impuesto → servicio → total, redondeando en cada paso |
| ¿Redondeo hacia arriba o half-up? | Half-up con `Math.floor(x + 0.5)`, documentado en BR-MONEY-002 y su test |
| ¿Se cobra el overtime al precio viejo? | Sí, al precio congelado en `chair_rentals.price_per_hour_minor` (BR-RENTAL-003) |
| ¿Cuánto es el mínimo de un alquiler? | 30 minutos, siempre (BR-RENTAL-001) |
| ¿Cómo se evita el overbooking? | Verificación de solapamiento dentro de `BEGIN IMMEDIATE` (BR-RES-002, §8.3). Resumen en `BASE-DE-DATOS.md` §7 |
| ¿Puedo tocar un pedido cerrado? | Sólo `orders.notes`. Nada más (BR-ORDER-017) |
| ¿Qué pasa si dos clientes cobran a la vez? | `Idempotency-Key` obligatorio y verificación en la misma transacción (BR-PAY-001) |
| ¿El frontend puede decidir permisos? | No. El backend verifica siempre; ocultar un botón no es un permiso (`AUTENTICACION.md` §6) |

No puedes inventar: nombres de tabla, columnas, tipos, valores de enum, nombres de índice, rutas, métodos, campos de request o response, códigos de error, códigos de permiso.

### Voy a desplegar u operar

1. `BASE-DE-DATOS.md` §2 (los cuatro PRAGMA y por qué `foreign_keys=ON` es crítico) y §3 (migraciones y por qué no se crean al arrancar)
2. `BASE-DE-DATOS.md` §8 (semillas: qué crea cada una y cómo hacer una base limpia con `SEED_DEMO_DATA=false`)
3. `DESIGN.md` §11 (variables, rate limits, CORS, helmet, `ENABLE_DEBUG_ERRORS`)
4. `AUTENTICACION.md` §9 (los tres limitadores y la limitación conocida del límite por IP)
5. `DESIGN.md` §12 (qué revisar en los logs y qué nunca aparecerá)
6. `API.md` §7.19 (`GET /health` y sus respuestas 503; `database.migrationsPending` avisa de migraciones sin aplicar)
7. `DESPLIEGUE.md` (el recorrido completo: `npm ci`, servicio systemd, nginx, backup del fichero SQLite y qué mirar en el log)
8. `DESIGN.md` §10 y `BASE-DE-DATOS.md` §9 (qué revisar si el negocio crece y se plantea PostgreSQL)

Antes de abrir el local: cambia `DATABASE_JWT_SECRET` y la contraseña de las cuentas de sistema. En `APP_ENV=production` la semilla de cuentas se desactiva y ponerla a `true` aborta el arranque.

### Voy a implementar el modelo de datos o las migraciones

1. `BASE-DE-DATOS.md` completo (motor, PRAGMA, migraciones, catálogo, decisiones)
2. `DESIGN.md` §4.0 (convenciones DDL obligatorias: `AUTOINCREMENT`, `created_at`/`updated_at`, CHECK de enum, `PRAGMA`)
3. `DESIGN.md` §4.1 a §4.6 (cada tabla, columna por columna) y §4.7 (resumen de las 34)
4. `DESIGN.md` §5 (diagrama de relaciones)
5. `DESIGN.md` §8.2 (`BEGIN IMMEDIATE` y PRAGMA obligatorios)

Lo que no puedes inventar: nombres de tabla, nombres de columna, tipos, valores de enum, nombres de índice. Son normativos. Y una migración aplicada **no se edita nunca**: se crea una nueva.

### Voy a implementar el frontend (Flutter)

1. `API.md` §1-2 (base URL, auth, rotación de refresh) y `AUTENTICACION.md` §10 (dónde guardar los tokens y el single-flight del refresco)
2. `API.md` §3 (envoltorio; tu modelo de respuesta lo refleja)
3. `API.md` §6.3 (objetos de recurso y sus campos exactos)
4. `API.md` §7.19 (`GET /meta/enums` y `GET /meta/roles`: **no dupliques enums, transiciones ni la matriz de permisos**)
5. `API.md` §4 (códigos de error; ramifica por `error.code`, nunca por el mensaje)
6. `DESIGN.md` §1.2 (el backend es la única fuente de verdad: el total siempre es el del servidor)
7. `DESIGN-TOKENS.md` (colores, tipografía y espaciado: ningún widget escribe un color literal)
8. `TESTING.md` §9 (qué tests de frontend habría que escribir y por qué no hay ninguno ejecutado)

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
7. `DESIGN.md` §8 (por qué no se puede sobrebookear), resumido en `BASE-DE-DATOS.md` §7
8. El resto, según el área que te toque.

## Estado del proyecto

| Componente | Estado |
|---|---|
| `docs/` | Contrato completo + guías operativas (este directorio) |
| `backend/` | Implementado. 34 tablas migradas, 3 migraciones, 6 semillas, 20 módulos HTTP, 626 tests en verde |
| `frontend/` | Implementado (Flutter). **Sin tests ejecutados**: no había SDK de Flutter en el entorno. Ver `TESTING.md` §9 |

Stack: Node.js 20.11+ con TypeScript estricto, Express 5.2.1, better-sqlite3 13.0.3, zod 4.6.5, pino/pino-http, helmet, cors, express-rate-limit, bcryptjs, vitest 5, supertest. Frontend: Flutter + Dart 3.4, Riverpod 2, go_router, dio, fl_chart, shared_preferences, flutter_secure_storage. Base de datos: SQLite, con migración a PostgreSQL sin reescribir el dominio. Moneda por defecto: COP. Zona horaria por defecto: `America/Bogota`.

## Discrepancias documentadas

Las tres que se encontraron al escribir estas guías, todas anotadas en el código con su razonamiento:

| Discrepancia | Resolución |
|---|---|
| `DESIGN.md` §9.3 dice "84 permisos" en la prosa; sus tablas 9.2 y 9.3 contienen **83** | Se siembran 83. Inventar una clave "para llegar a 84" sería fabricar un permiso que ninguna ruta usa. Explicado en la cabecera de `roles-permissions.seed.ts` |
| `DESIGN.md` §11.1 describe la política de contraseñas como "mínimo 8 caracteres, al menos una letra y un número, sin requisitos de símbolos ni mayúsculas" | El código exige **3 de 4 clases** (`src/config/constants.ts` y `password.service.ts`). El documento se quedó corto; la implementación es la que endurece |
| `DESIGN.md` §11.3 prevé límites de tasa por **usuario** en endpoints autenticados; la implementación los aplica todos **por IP** | Deuda conocida, documentada en `AUTENTICACION.md` §9. Un límite por IP afecta a usuarios legítimos detrás de una misma NAT y no frena un ataque distribuido |
