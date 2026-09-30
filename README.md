# LatteCoffe POS

Sistema de punto de venta para una cafetería que además alquila sillas y espacios: un backend Node.js/TypeScript con API REST, una app Flutter para Android, iOS y Web, y una base de datos SQLite con 34 tablas de negocio.

No es dos sistemas pegados. Es un solo dominio con dos líneas de negocio que comparten el mismo catálogo, el mismo pedido, el mismo inventario y el mismo motor de cobros.

## Dos líneas de negocio, un solo backend

La primera línea es la venta de productos: café, bebidas y comida, con variantes, complementos, impuestos por tasa, descuentos, control de stock y precios que dependen del canal y del horario.

La segunda línea es el alquiler de espacio: sillas, mesas, barra y salones alquilables por tiempo, con reservas previas, alquileres walk-in, check-in, extensiones y cobro por sobretiempo. Una silla no es un mueble con una etiqueta: es una unidad de inventario con estado, historial y una tarifa por hora.

Ambas líneas se cruzan en el mismo carrito y en el mismo pedido. Un cliente puede sentarse en una silla, pedir tres cafés y pagar el consumo más el alquiler del tiempo en una sola operación. La silla deja de estar disponible mientras dura el alquiler y no vuelve a estarlo hasta que pasa por limpieza.

El motivo de un único backend es la consistencia. El precio final, la disponibilidad de la silla, el stock descontado y el total cobrado los calcula siempre el servidor; el frontend previsualiza y nunca decide. Un cajero en el mostrador y un cliente en el móvil actuando sobre la misma silla obtienen la misma respuesta porque leen el mismo estado y escriben en la misma transacción. El índice completo de documentación está al final de este documento.

## Estado del proyecto

| Área | Estado |
|---|---|
| Esquema SQLite (34 tablas) | Implementado. 3 migraciones versionadas con checksum y fichero `.down.sql` |
| Migración a PostgreSQL | Diseñada, no ejecutada. Ver [`docs/DESIGN.md`](docs/DESIGN.md) §10 |
| Autenticación y sesiones | Implementado: JWT HS256, refresh rotativo, bcrypt, reset de contraseña |
| RBAC | Implementado: 6 roles, 83 permisos sembrados y verificados contra la matriz |
| Catálogo y menú público | Implementado. El menú se lee sin credencial |
| Zonas y sillas | Implementado: mapa, estado, disponibilidad, historial |
| Reservas | Implementado: solapamiento verificado en transacción |
| Alquileres | Implementado: apertura, extensión, cierre, overage a precio congelado |
| Pedidos | Implementado: líneas, estados, historial, recibo |
| Pagos | Implementado: efectivo y datáfono, reembolsos, idempotencia |
| Descuentos, inventario, negocio, sedes | Implementado |
| Notificaciones | Implementado: bandeja y preferencias. Sin entrega push real |
| Reportes y exportación CSV | Implementado |
| Expiración de reservas | Endpoint `POST /api/v1/system/jobs/expire-reservations` implementado. Sin cron que lo llame |
| Historial agregado de cliente | **Pendiente.** `GET /customers/:id/orders`, `/:id/reservations`, `/:id/rentals` y `/:id/payments` están declarados en el contrato y **no** existen en el router |
| Pasarela de pagos online | **Fuera de alcance por decisión.** El cobro es en el mostrador |
| Despliegue con Docker | Implementado: `backend/Dockerfile` multi-stage + `docker-compose.yml`. Desplegado y verificado en un servidor Linux |
| Túnel público para la demo | Implementado: quick tunnel de Cloudflare como servicio opcional de `docker-compose.yml`. La URL es temporal |
| APK de Android firmado | Implementado: clave propia en `frontend/keystore/`, documentada como clave de demostración |
| Frontend Flutter | **Compilado, analizado y probado.** `flutter analyze`: 0 errores, 0 warnings. Ver sección Testing |
| Tests de frontend | **209 tests** en `frontend/test/`, todos verdes |
| `flutter_secure_storage` en web | Implementado con `localStorage` cifrado con WebCrypto, no con el Keychain |

### Bugs encontrados al probar, y cómo se arreglaron

Encontrados probando el sistema de punta a punta contra el backend desplegado. **Los dos
están arreglados**; se cuenta qué pasaba y por qué, sin maquillar:

1. **El botón "Cobrar alquiler" del POS dejaba el alquiler abierto.** *(arreglado en el
   backend, commit `381ee4c`)* El pedido `CHAIR_RENTAL` se creaba y se cobraba bien, pero
   el alquiler quedaba `ACTIVE` y la silla `OCCUPIED`: el cierre de alquiler al completar
   un pedido (BR-ORDER-015) se saltaba porque el auto-completado por pago escribía el
   estado con un `UPDATE` directo. El arreglo mete **un único punto de liquidación**
   (`OrderSessionSettlement` / `closeLiveRental`) del que cuelgan las tres puertas de
   cierre —manual, check-out de reserva y autocompletado por cobro—; si el punto no está
   conectado, el cobro falla dentro de la transacción en vez de dejar medio cobro.
2. **Ese mismo botón no hacía nada con el carrito vacío.** *(arreglado en el frontend)*
   El flujo se cortaba en `pos_page.dart` y `pos_charge_flow.dart` cuando
   `posLinesProvider` estaba vacío, aunque un pedido de alquiler **no lleva** líneas de
   producto (BR-ORDER-012, `422 MIXED_ORDER_TYPE_NOT_ALLOWED`): el flujo correcto de
   alquiler **siempre** tiene el carrito vacío, así que el corte lo mataba justo en el
   único caso en que debía pasar. El panel sí habilitaba el botón, de ahí el botón
   visible que no responde. El arreglo es un **veredicto único compartido**
   (`posChargeGateProvider`) que leen el panel, la pantalla y el flujo, más un diálogo
   que explica el motivo cuando no se puede cobrar, en vez de volver en silencio.

## Características

### Para el cliente

- Alta de cuenta, inicio y cierre de sesión, recuperación de contraseña.
- Menú público sin credencial, con categorías, variantes y complementos.
- Carrito y checkout, con el total definitivo calculado por el servidor.
- Pedidos para llevar (`TAKEAWAY`) y consumidos en el local (`DINE_IN`).
- Mapa de la sala y disponibilidad real de cada silla.
- Reserva por 30 minutos, 1, 2, 3, 4 horas o duración personalizada.
- Seguimiento de sus pedidos, de sus reservas y de sus pagos.

### Para el cajero y el personal de sala

- Apertura de pedidos, líneas, cambios de estado y cobro.
- Check-in de reservas, apertura de alquileres walk-in y extensiones.
- Cambio calculado en caja a partir del importe recibido.
- Mapa de sala operativo: qué silla está libre, ocupada, en limpieza o en mantenimiento.
- Terminal POS con pedido rápido y cobro en el mismo flujo.
- Notificaciones de confirmación, pedido listo y aviso de reservas próximas.

### Para el administrador y la gerencia

- Gestión de catálogo, precios, impuestos, zonas y tarifas por hora de las sillas.
- Inventario con movimientos, mermas y alertas de stock bajo.
- Cupones y descuentos por porcentaje o monto fijo, con ámbito de aplicación.
- Reportes de ventas, productos más vendidos, ocupación de sillas y exportación CSV.
- Gestión de usuarios, asignación de roles, bloqueo de cuentas y auditoría.

### Para el sistema

- Migraciones versionadas en ficheros con checksum SHA-256: el historial es inmutable.
- Semilla idempotente y no destructiva de roles, permisos, matriz RBAC y datos de demostración.
- Contenedor de dependencias por constructor; la app se construye sin `listen` para poder testearla.
- Límites de tasa globales y reforzados en autenticación y en recuperación de contraseña.
- `helmet`, CORS con lista blanca, `pino` con redacción de secretos, apagado ordenado.
- Respuesta uniforme con `requestId` siempre presente.

## Stack

| Tecnología | Versión | Para qué |
|---|---|---|
| Node.js | 22+ (verificado en 26.10.0) | Runtime del backend |
| TypeScript | 5.9.3, `strict` | Tipado estricto en las dos capas de negocio y API |
| Express | 5.2.1 | Routing HTTP |
| better-sqlite3 | 13.0.3 | Driver SQLite, binario precompilado, sin `node-gyp` |
| zod | 4.6.5 | Validación de `body`, `query` y `params` |
| pino / pino-http | 10.3.1 / 11.0.0 | Logging estructurado con redacción de secretos |
| bcryptjs | 3.0.2 | Hash de contraseñas |
| helmet, cors, express-rate-limit | 8.1.0 / 2.8.5 / 8.2.1 | Cabeceras de seguridad, CORS, límites de tasa |
| vitest + supertest | 5.0.2 / 7.1.4 | Tests unitarios y de integración HTTP |
| tsx | 4.20.7 | Ejecución directa de TypeScript en `dev`, `migrate` y `seed` |
| SQLite | embebido | 34 tablas, WAL, claves foráneas activas |
| Flutter / Dart | Flutter 3.22+ | App para Android, iOS y Web desde una sola base de código |
| Riverpod | 2.5.1 | Estado y inyección de dependencias |
| go_router | 14.2.0 | Rutas declarativas con guard de sesión y de permiso |
| dio | 5.4.3 | Interceptores, cancelación, reintentos con backoff |
| fl_chart | 0.68.0 | Dashboard y reportes |
| shared_preferences / flutter_secure_storage | 2.2.3 / 9.2.2 | Preferencias no sensibles y tokens de sesión |

Los módulos son ES (`"type": "module"` en `backend/package.json`). Los imports internos llevan extensión `.js`.

## Arquitectura

```
┌────────────────────────────────────────────────────────────┐
│ Flutter  (Android · iOS · Web)                             │
│   features/ → domain/ → data/ → core/network (dio)         │
└──────────────────────────┬─────────────────────────────────┘
                           │  HTTP · JSON
                           │  Authorization: Bearer <accessToken>
                           ▼
┌────────────────────────────────────────────────────────────┐
│ API REST v1 — 20 prefijos bajo /api/v1                     │
│   routes → authenticate → requirePermission → validate →   │
│   controller    (el handler no decide nada de negocio)     │
└──────────────────────────┬─────────────────────────────────┘
                           ▼
┌────────────────────────────────────────────────────────────┐
│ services  →  repositories (interfaz + SQLite)              │
│ casos de uso, transacciones, reglas BR-*  ·  único SQL     │
└──────────────────────────┬─────────────────────────────────┘
                           ▼
┌────────────────────────────────────────────────────────────┐
│ shared/database  conexión única · unit-of-work · migrador  │
└──────────────────────────┬─────────────────────────────────┘
                           ▼
              SQLite · WAL · 34 tablas · migraciones
```

### Capas

La dependencia apunta siempre hacia adentro: ninguna capa importa a la de arriba.

**Backend.** `routes` sólo declara método, ruta, middleware y handler. `controller` traduce HTTP a servicio y de vuelta, sin decisiones de negocio. `service` contiene los casos de uso, las transacciones y las reglas. `repository.ts` es la interfaz de persistencia y `repository.sqlite.ts` el único fichero del módulo con SQL. `shared/domain` son los enums, los permisos y las máquinas de estado en TypeScript puro. `config/container.ts` arma el grafo de dependencias por inyección de constructor.

Dos reglas que no se negocian: **sólo la capa de persistencia escribe SQL**, y **el mapeo de `snake_case` a `camelCase` ocurre en los repositorios**, nunca en el controller. Detalle en [`backend/README.md`](backend/README.md) §6 y §9.

**Frontend.** `lib/app` (tema, tokens, rutas y shells), `lib/core` (config, red con dio, almacenamiento, DI, `Result<T>`, formateadores), `lib/domain` (entidades y contratos sin conocimiento de la API), `lib/data` (DTOs, datasources, repositorios), `lib/features` (una carpeta por feature con `presentation/`, `domain/` y `data/`) y `lib/shared` (widgets del sistema de diseño).

Cero colores literales fuera de `app/theme/app_colors.dart`, cero lógica de negocio en widgets base y cero aritmética de dinero en la UI: el dinero entra como `int` de centavos y sale formateado.

## Entrega

Hay una carpeta `entrega/` con lo necesario para probar el sistema **sin montar nada**:
dos APK de Android firmados y un `LEEME.md` pensado para un instructor sin contexto
previo (qué es el sistema, credenciales, cómo instalar el APK, cómo probar el flujo de
reservar y alquilar una silla, y las limitaciones).

| Fichero | Qué lleva dentro |
|---|---|
| `entrega/LatteCoffee-release.apk` | Apunta a `https://his-eligibility-handbags-cohen.trycloudflare.com/api/v1`. Funciona con datos de red, sin cables, porque el backend ya está desplegado. |
| `entrega/LatteCoffee-local.apk` | Apunta a `http://localhost:3000/api/v1`. Sólo para un taller con `adb reverse`. |
| `entrega/SHA256SUMS.txt` | Sumas SHA-256 de los dos APK. |
| `entrega/capturas/` | Evidencia en un teléfono real: login, catálogo del servidor, mapa de sillas, alquiler abierto, ampliado, terminado. |

Los dos APK llevan el mismo `applicationId` y la misma clave de firma, así que son
intercambiables. La clave de firma es una **clave de demostración** y su contraseña
(`LatteCoffee2026`) está escrita en `entrega/LEEME.md` a propósito: no es una clave de
producción y no sirve para publicar en Play Store.

> **El APK de release queda atado a la URL del túnel.** La dirección del backend se
> incrusta en el APK en tiempo de compilación (`--dart-define=API_BASE_URL=...`). La URL
> de esta entrega es un *quick tunnel* de Cloudflare: es gratis y no pide cuenta, pero
> **la URL es aleatoria y cambia cada vez que se levanta el túnel**. Si caduca, hay que
> reconstruir el APK con la nueva (comando exacto en `entrega/LEEME.md` §8 y en
> [`docs/DESPLIEGUE.md`](docs/DESPLIEGUE.md) §3.4). Para un despliegue estable haría
> falta un dominio propio y un túnel con cuenta: la app no cambiaría, sólo la URL.

## Prerrequisitos

| Herramienta | Versión | Para qué |
|---|---|---|
| Node.js | 22 o superior | Runtime del backend |
| npm | 10 o superior | Dependencias del backend |
| Flutter SDK | 3.22 o superior (estable) | Build, análisis y tests del frontend |

**SQLite va embebido.** `better-sqlite3` trae el binario precompilado y la base de datos es un fichero en `backend/data/`. No hay que instalar ni configurar ningún servidor de base de datos. En Android, iOS y Web, tampoco: el frontend habla HTTP con el backend y nunca abre la base de datos.

## Instalación y arranque

Hay dos caminos: **con Docker** (lo que se usa para desplegar, y lo que hay en
`entrega/`) o **con Node directamente** (más rápido para desarrollo). Los dos levantan
exactamente el mismo backend.

### Con Docker (recomendado: es como se despliega)

Desde la **raíz** del repositorio, donde están `docker-compose.yml` y `.env.example`:

```bash
cp .env.example .env
# edita .env y cambia DATABASE_JWT_SECRET: es obligatoria y en APP_ENV=production
# el contenedor ABORTA (exit 78) si es débil. Genera una con la línea siguiente.
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
# pon también SEED_SYSTEM_ACCOUNTS_PASSWORD (entrecomillado: lleva '#')

docker compose config --quiet     # valida el compose sin arrancar nada
docker compose build              # imagen multi-stage: compila TS y better-sqlite3
docker compose run --rm api npm run migrate:prod   # crea el esquema
docker compose run --rm api npm run seed:prod      # datos de demostración
docker compose up -d api
curl -s http://localhost:3000/api/v1/health
```

La base SQLite vive en el volumen Docker `lattecoffe-api-data` montado en `/data`, fuera
del código: `docker compose down` no se la lleva, `docker compose down -v` sí.

Las **migraciones y la semilla son comandos explícitos**, nunca algo que pase al arrancar
el servidor. En la imagen se ejecutan con `npm run migrate:prod` y `npm run seed:prod`, no
con `npm run migrate` / `npm run seed`: el CLI de base de datos se compila a
`dist/database/cli.js` y se ejecuta con `node` pelado, porque `tsx` es una
`devDependency` y la imagen final no lleva dependencias de desarrollo. Hay dos
razones detrás, ambas documentadas en el `Dockerfile` y comprobadas dentro del
contenedor:

1. `npm run migrate` invoca `tsx`; con `npm ci --omit=dev` falla con `sh: 1: tsx: not found`.
2. `tsc` **no copia los `.sql`** a `dist/`, y el migrador localiza la carpeta de
   migraciones probando rutas relativas. Por eso la imagen copia los `.sql` a
   `/app/migrations` y fija `MIGRATIONS_DIR=/app/migrations`, que es el override que el
   propio migrador respeta.

El contenedor también corre como usuario no root (`node`, uid 1000), expone `3000`,
escucha en `0.0.0.0` y tiene `HEALTHCHECK` contra `/api/v1/health`.

Detalle completo, con el túnel público y cómo parar y arrancar cada cosa:
[`docs/DESPLIEGUE.md`](docs/DESPLIEGUE.md) §3.

### Con Node directamente

```bash
cd backend
npm install
cp .env.example .env
# edita .env y cambia DATABASE_JWT_SECRET: es obligatoria y en APP_ENV=production
# el proceso aborta si es débil. Genera una con la línea siguiente.
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

npm run migrate               # crea las 34 tablas; idempotente
npm run seed                  # 6 roles, 83 permisos, matriz RBAC, negocio y datos de demo
npm run dev                   # http://localhost:3000
```

`npm run seed` no es opcional. Sin ella, `GET /api/v1/meta/roles` responde **503** y ningún endpoint protegido deja pasar a nadie, porque `requirePermission` lee una tabla `role_permissions` vacía. Las variables que hay que tocar de verdad son `DATABASE_JWT_SECRET`, `PORT`, `DATABASE_PATH`, `DEFAULT_CURRENCY`, `DEFAULT_TIMEZONE`, `CORS_ORIGINS` y las de semilla; la tabla completa con valores por defecto está en [`backend/README.md`](backend/README.md) §3 y comentada en `backend/.env.example`. El resto de comandos:

```bash
npm run build             # tsc → dist/
npm start                 # node dist/server.js (requiere build)
npm run typecheck         # tsc --noEmit
npm run lint              # mismo chequeo, salida formateada
npm run migrate:status    # aplicadas, pendientes y alteradas, con su checksum
npm run migrate:rollback  # revierte la última aplicada usando su .down.sql
npm test                  # vitest run
```

### Frontend

Las carpetas `android/`, `ios/`, `linux/`, `windows/` y `macos/` están sin código nativo: lo genera el SDK, no se escribe a mano. Sólo hace falta para las plataformas móviles y de escritorio; la carpeta `web/` ya tiene contenido.

```bash
cd frontend
flutter create --platforms=android,ios,web,linux,windows,macos .   # sólo la primera vez
flutter pub get
flutter run --dart-define=API_BASE_URL=http://localhost:3000/api/v1
```

`--dart-define=API_BASE_URL=...` es lo único que configura la dirección del backend. **Incluye el prefijo `/api/v1`**. No hay archivos de configuración locales.

| Objetivo | URL |
|---|---|
| Emulador de Android | `http://10.0.2.2:3000/api/v1` |
| Simulador iOS, escritorio, web | `http://localhost:3000/api/v1` |
| Producción | `https://api.lattecoffee.co/api/v1` |

Desde el emulador de Android, `localhost` es el propio emulador: la máquina anfitriona se ve como `10.0.2.2`. Para web, `flutter build web --dart-define=API_BASE_URL=<URL>`.

#### Compilar el APK de Android

```bash
cd frontend

# Con la URL de un túnel HTTPS (el caso de la entrega)
flutter build apk --release \
  --dart-define=API_BASE_URL=https://<host>.trycloudflare.com/api/v1

# Contra el backend de esta máquina por adb reverse (taller con cable)
adb reverse tcp:3000 tcp:3000
flutter build apk --release \
  --dart-define=API_BASE_URL=http://localhost:3000/api/v1
```

El resultado es siempre `build/app/outputs/flutter-apk/app-release.apk` (~100 s de
build). Dos cosas que importan y no son evidentES:

- **La clave de firma.** `android/key.properties` **no** se versiona. Sin él el build de
  release **no falla**: cae a la clave de debug y avisa por consola, así que se puede
  generar un APK "de release" que no es publicable. Para esta entrega la clave sí está
  (`frontend/keystore/lattecoffe-release.jks`) y su contraseña está documentada en
  `entrega/LEEME.md` como **clave de demostración**.
- **`JAVA_HOME`.** Con Java 25 el build de Gradle falla. Hay que usar el 17:
  `export JAVA_HOME=/usr/lib/jvm/java-17-amazon-corretto`.

Sobre la decisión de no permitir tráfico en claro en el APK de release, y la excepción
mínima para `localhost` que hace que funcione el APK de `adb reverse`, ver
`frontend/android/app/src/main/res/xml/network_security_config.xml` y
`entrega/LEEME.md` §8.

#### Levantar el túnel público

Para que el APK funcione sin cables hace falta que el backend sea alcanzable desde
internet. Lo que se usa en esta entrega es un **quick tunnel** de Cloudflare, declarado
en `docker-compose.yml` dentro del perfil opcional `tunnel` (así que `cloudflared` **no**
se instala como dependencia del proyecto: corre como contenedor):

```bash
cd ~/lattecoffe                            # en el servidor
docker compose --profile tunnel up -d tunnel
docker compose logs tunnel | grep -o 'https://[a-z-]*\.trycloudflare\.com' | head -1
# -> https://<algo>.trycloudflare.com

curl -s https://<esa-url>/api/v1/health     # comprobar desde fuera

docker compose --profile tunnel stop tunnel  # parar
```

La URL es **temporal**: es aleatoria y cambia en cada arranque. Ver la advertencia de la
sección Entrega y [`docs/DESPLIEGUE.md`](docs/DESPLIEGUE.md) §3.4.

## Credenciales de desarrollo

`npm run seed` crea estas cuentas con la contraseña de `SEED_SYSTEM_ACCOUNTS_PASSWORD`, cuyo valor por defecto es `LatteCofee#2026`:

| Email | Rol | Acceso |
|---|---|---|
| `owner@lattecoffe.co` | `OWNER` | Todo, incluida la matriz de permisos |
| `admin@lattecoffe.co` | `ADMIN` | Usuarios, roles, configuración, auditoría |
| `manager@lattecoffe.co` | `MANAGER` | Catálogo, inventario, descuentos, zonas, sillas, reportes |
| `cajero@lattecoffe.co` | `CASHIER` | Sala, reservas y cobro |

Con `SEED_DEMO_DATA=true`, el valor por defecto fuera de producción, la siembra añade empleados y clientes de demostración con la contraseña de `SEED_DEMO_PASSWORD` (si se deja vacía, se reutiliza la de las cuentas de sistema):

| Email | Rol |
|---|---|
| `staff@lattecoffe.co` | `STAFF` |
| `cajero2@lattecoffe.co` | `CASHIER` |
| `cliente1@lattecoffe.co` … `cliente4@lattecoffe.co` | `CUSTOMER` |

> **ADVERTENCIA.** La contraseña por defecto es de desarrollo y está escrita en este README y en `backend/.env.example`. Cualquiera que lea el repositorio puede entrar como administrador. Antes de abrir el local:
>
> 1. Cambia la contraseña en las cuatro cuentas con `POST /api/v1/auth/change-password` o desde el panel de usuarios.
> 2. Pon una distinta en `SEED_SYSTEM_ACCOUNTS_PASSWORD`.
>
> La semilla es idempotente y no destructiva: si la cuenta ya existe no la toca, así que cambiar la variable y reejecutar `npm run seed` **no** restaura la contraseña de una cuenta existente. Hay que cambiarla en la cuenta. En `APP_ENV=production` la semilla se desactiva siempre, y poner `SEED_SYSTEM_ACCOUNTS=true` hace abortar el arranque a propósito.

Para sembrar sólo la estructura, sin datos de demostración: `SEED_DEMO_DATA=false npm run seed`.

La contraseña lleva `#`, así que en `.env` va entrecomillada. Sin comillas, `dotenv` la corta ahí y la contraseña se quedaría en `LatteCofee`.

## Estructura del proyecto

```
LatteCoffe/
├── backend/                       API REST, dominio y persistencia
│   ├── src/
│   │   ├── config/                env validado con zod, constantes, contenedor DI
│   │   ├── shared/                transversal: errores, http, logger, middleware,
│   │   │                          utils, database, services, domain (enums, máquinas)
│   │   ├── modules/               un módulo por dominio de negocio (20 prefijos)
│   │   ├── database/              cli de migraciones, migrations/, seeds/
│   │   ├── app.ts                 createApp(): Express sin listen, testeable
│   │   └── server.ts              listen y apagado ordenado
│   ├── tests/                     18 ficheros de integración HTTP
│   ├── data/                      SQLite generado (gitignored)
│   └── .env.example               todas las variables, con comentarios
│
├── frontend/                      app Flutter (Android, iOS, Web)
│   ├── lib/
│   │   ├── app/                   tema, tokens, rutas, shells, navegación
│   │   ├── core/                  config, network, storage, di, result, utils
│   │   ├── domain/  data/         entidades y contratos; DTOs y repositorios
│   │   ├── features/              auth, menu, cart, checkout, orders, pos,
│   │   │                          chair, reservation, profile, admin, home
│   │   ├── shared/                widgets del sistema de diseño
│   │   └── routing/               guardas de navegación (pendiente)
│   ├── test/                      suite de pruebas (pendiente: sólo hay README)
│   ├── web/                       index.html y manifest.json
│   └── pubspec.yaml
│
├── docs/          DESIGN.md · API.md · DESIGN-TOKENS.md · README.md
├── tests/         reservado para pruebas end-to-end (vacío)
└── README.md      este documento
```

La estructura interna de un módulo del backend (`routes`, `controller`, `service`, `repository`, `repository.sqlite`, `schemas`, `types`) está en [`backend/README.md`](backend/README.md) §6.

## Roles y permisos

| Rol | Qué puede hacer |
|---|---|
| `CUSTOMER` | Ver el menú, pedir para llevar o en el local, reservar y alquilar sillas, ver su historial |
| `STAFF` | Sala, pedidos, estado de las sillas, check-in y alquileres walk-in |
| `CASHIER` | Lo de `STAFF` más el cobro en efectivo y datáfono, con el cambio calculado |
| `MANAGER` | Catálogo, precios, impuestos, inventario, descuentos, zonas, tarifas, reportes |
| `ADMIN` | Lo de `MANAGER` más usuarios, roles, estado de cuentas, configuración y auditoría |
| `OWNER` | Todo, incluida la matriz de permisos |

La jerarquía es `OWNER` > `ADMIN` > `MANAGER` > `CASHIER` > `STAFF` > `CUSTOMER`, pero las capacidades no se derivan del rango: se resuelven contra 83 permisos concretos sembrados en `role_permissions`.

**El backend nunca confía en el frontend para autorizar.** Ocultar un botón es una decisión de interfaz; cada ruta vuelve a comprobar identidad y permiso. Que el cliente consuma `GET /api/v1/meta/roles` para no duplicar la matriz es una optimización, no el control de acceso. Dos protecciones: un `ADMIN` no puede borrar a otro `ADMIN` (`403 ADMIN_ROLE_PROTECTED`) y el último `OWNER` está protegido en todos los caminos. El detalle de los 83 permisos está en [`docs/DESIGN.md`](docs/DESIGN.md) §9.

## Modelo de negocio

### Tipos de pedido

Un pedido es siempre de uno de tres tipos, y la tabla `orders` los restringe con un `CHECK`:

| Tipo | Qué es | Silla | Líneas de producto |
|---|---|---|---|
| `TAKEAWAY` | Para llevar | Nunca lleva `chair_id` ni `reservation_id` | Sí |
| `DINE_IN` | Consumido en el local | Opcional. Puede ser `NULL` para barra sin asignar | Sí |
| `CHAIR_RENTAL` | El alquiler de un espacio | Obligatoria, con `reservation_id` o walk-in | No, en la v1 |

Mezclarlos devuelve `422 MIXED_ORDER_TYPE_NOT_ALLOWED`. Un `TAKEAWAY` con silla no falla: la ignora y lo avisa en `meta`, porque bloquear la venta por el error de cliente más habitual no compensa. `DINE_IN` sin silla es válido y `table_label` cubre el caso legible.

Los tres comparten una sola máquina de estados de nueve valores: `DRAFT`, `PENDING`, `CONFIRMED`, `PREPARING`, `READY`, `DELIVERING`, `COMPLETED`, `CANCELLED`, `REFUNDED`. `DELIVERING` sólo aplica a `TAKEAWAY`. Un pedido `COMPLETED` es inmutable: sólo se le puede tocar `notes`.

### Ciclo de vida de una silla y de una reserva

| Silla | Significado | Reserva | Significado |
|---|---|---|---|
| `AVAILABLE` | Libre, asignable o reservable | `PENDING` | Creada, sin confirmar |
| `RESERVED` | Hay una reserva vigente | `CONFIRMED` | Confirmada; la silla queda `RESERVED` |
| `OCCUPIED` | Hay un alquiler activo | `ACTIVE` | Hubo check-in y hay alquiler abierto |
| `CLEANING` | El alquiler se cerró, hay que limpiarla | `COMPLETED` | Terminada |
| `MAINTENANCE` | Retirada por daño o reparación | `CANCELLED` | Cancelada |
| `BLOCKED` | Fuera de servicio por decisión del negocio | `EXPIRED` | No se presentó y venció |

Dos transiciones explican el resto: de `OCCUPIED` nunca se pasa a `AVAILABLE`, sino a `CLEANING`, y de `CLEANING` sale a `AVAILABLE` o a `MAINTENANCE` si se detectó daño. No se vuelve a recibir clientes con una silla sin limpiar.

### Precio del alquiler

```
precio = roundHalfUp(minutos_facturados / 60 × precio_por_hora)
minutos_facturados = max(30, ceil((cierre_real - inicio) / 60000))
```

- **Mínimo de 30 minutos**, siempre, aunque el cliente estuvo cuatro.
- **Pro-rata por minuto, redondeado hacia arriba**: nadie paga de menos por segundos.
- **El overage se cobra al precio congelado al abrir el alquiler**, no al vigente al cerrar. Subir las tarifas no modifica facturas ya abiertas. Los minutos excedidos se cobran aparte de las extensiones contratadas, y lo no consumido de una extensión pagada por adelantado se devuelve prorrateado.

Al cerrar el alquiler, la silla pasa a `CLEANING` y el pedido de cobro se genera en la misma operación.

### Protección contra la doble reserva

El overbooking no se resuelve con un `SELECT` antes del `INSERT`. La verificación de solapamiento se ejecuta **dentro de `BEGIN IMMEDIATE`**, con la condición `NOT (end_at <= :start OR start_at >= :end)` sobre los estados `PENDING`, `CONFIRMED` y `ACTIVE`. `BEGIN IMMEDIATE` toma el lock de escritura al abrir, no en el primer `write`: esa es la diferencia real entre las dos peticiones que compiten.

Si dos clientes reservan la misma silla a la misma hora, sólo uno obtiene `201`; el otro recibe `409 CONFLICT_ERROR` con `code: 'CHAIR_ALREADY_RESERVED'` y el código de la reserva ganadora. Un índice único parcial sobre las reservas activas cubre la segunda capa. `SQLITE_BUSY` se traduce a `409` con `details.code = 'RESOURCE_BUSY'`, nunca a un 500, y el mismo patrón con `Idempotency-Key` obligatorio protege contra el cobro doble.

## Pagos

**No hay pasarela de pagos y no se prevé que la haya.** El cobro ocurre en el mostrador, en efectivo o con datáfono, y el sistema registra el resultado. `PAYMENT_PROVIDER=MOCK` es el valor por defecto y no conecta con nada.

| Concepto | Detalle |
|---|---|
| Efectivo | `method = 'CASH'`, `provider = 'CASH_REGISTRY'`, y `receivedMinor` con lo que entregó el cliente |
| Cambio | El servidor lo calcula (`changeDueMinor`) a partir del importe y de lo recibido, y lo devuelve en la respuesta. Si lo recibido no alcanza, es un error de negocio, no un cobro negativo |
| Datáfono | `method = 'CARD'`. El cajero anota la aprobación del aparato en `providerReference` |
| Datos de tarjeta | Nunca se almacenan. Ni PAN, ni CVV, ni token. `providerReference` es una aprobación opaca, no un número de tarjeta |
| Idempotencia | `Idempotency-Key` obligatorio: sin ella es `400`. La misma clave cobrada dos veces devuelve el mismo pago, no un segundo cobro |
| Reembolsos | Totales o parciales, con su propio estado y su traza en el historial |

`POST /api/v1/payments` acepta `CASH` y `CARD`, y nada más: `TRANSFER` y `ONLINE` son un `400` explícito, aunque figuren en el enum `PaymentMethod`. El campo `provider` sólo admite `CASH_REGISTRY`. Los valores `CARD_TERMINAL`, `STRIPE`, `MERCADOPAGO`, `WOMPI` y `PAYU` existen en el enum `payments.provider` y se publican en `GET /api/v1/meta/enums`, pero **la API no acepta ninguno como entrada y nada en el sistema los usa**. `CARD_TERMINAL` lo añadió la migración `0003_card_terminal_provider.sql`.

## Testing

### Backend

```bash
cd backend
npm test              # vitest run
```

La suite actual es de **636 tests en 22 ficheros, todos en verde**: 19 de integración HTTP en `backend/tests/` y 3 unitarios en `backend/src/shared/`. Los de integración levantan la aplicación contra una base SQLite en memoria con las migraciones aplicadas.

| Área | Qué se verifica |
|---|---|
| Autenticación y sesiones | Login, refresh rotativo, revocación de familia, reset, política de contraseñas |
| RBAC | Matriz de 83 permisos contra la base, `403` frente a `404` por alcance, aislamiento entre negocios |
| Reservas y alquileres | Solapamiento, doble reserva simultánea, mínimo de 30 min, overage a precio congelado, extensiones, devolución proporcional |
| Pedidos y pagos | Ciclo de estados completo, inmutabilidad tras `COMPLETED`, idempotencia, reembolsos, `providerReference` del datáfono |
| Dinero y redondeo | `roundHalfUp`, mínimos, prorrateo de descuentos, impuestos con tasas distintas |
| Migraciones y semilla | Checksum, rollback, migración `0003`, idempotencia y no destructividad de la semilla |

### Frontend

```bash
cd frontend
flutter pub get
flutter analyze      # 0 errores (sólo avisos de estilo, ninguno bloqueante)
flutter test         # 209 tests, todos verdes
```

| Área | Qué se verifica |
|---|---|
| Alquiler y cobro desde el POS | El plano de sillas es pulsable, muestra las reservadas, el selector de reservas tiene sus estados (con lista, vacío, sin conexión, fallo traducido) |
| Checkout | Totales leídos del servidor, `itemCount` derivado de `items[]`, líneas de producto con nombre e importe reales |
| Tema y accesibilidad | Contraste AA en claro y en oscuro, bordes identificables, el acento invertido en oscuro, invariantes del sistema de color |
| Formato | Fechas `dd/MM/yyyy`, hora de 24 h, meses en español, countdown de silla, duraciones en texto |

Detalle en [`docs/TESTING.md`](docs/TESTING.md).

> `flutter analyze`_clean en errores y warnings, pero deja 297 avisos de estilo
> (`prefer_const_constructors`, `discarded_futures`, `unnecessary_parenthesis`…). No
> bloquean el build y no se han limpiado. Además hay un aviso de configuración:
> `analysis_options.yaml:53` declara la regla `sized_box_shrink_expands`, que no existe en
> el analizador de este SDK y hay que borrar.

## Documentación

| Documento | Contenido |
|---|---|
| [`docs/README.md`](docs/README.md) | Índice y guías de lectura por rol: modelo de datos, lógica de negocio, API, frontend, tests, despliegue |
| [`docs/DESIGN.md`](docs/DESIGN.md) | Contrato normativo. ~2 700 líneas: 34 tablas columna por columna, diagrama `erDiagram`, máquinas de estado, más de 100 reglas `BR-*`, concurrencia, RBAC con los 83 permisos, migración a PostgreSQL, seguridad, logging y desviaciones |
| [`docs/API.md`](docs/API.md) | Contrato de endpoints REST v1: 157 endpoints, envoltorio de respuesta, códigos de error, paginación, filtros y formato de los objetos |
| [`docs/DESIGN-TOKENS.md`](docs/DESIGN-TOKENS.md) | Sistema de diseño: paleta, tipografía, espaciado, radios, sombras, breakpoints y accesibilidad |
| [`docs/BASE-DE-DATOS.md`](docs/BASE-DE-DATOS.md) | Guía operativa del esquema y del motor: por qué se eligió cada decisión, sin repetir el contrato columna por columna |
| [`docs/TESTING.md`](docs/TESTING.md) | Cómo ejecutar la suite, qué cubre y qué no, y cómo añadir tests. Los números son reales, obtenidos de `npm test` |
| [`docs/DESPLIEGUE.md`](docs/DESPLIEGUE.md) | Despliegue con Docker (imagen multi-stage, volumen,compose, túnel público), instalación, arranque, backup y operación en producción. Distingue lo que el código garantiza de lo que es recomendación de despliegue |
| [`entrega/LEEME.md`](entrega/LEEME.md) | Guía de la entrega: qué es el sistema, credenciales de prueba, cómo instalar el APK, cómo probar el flujo de silla, Docker, el túnel y las limitaciones |
| [`backend/README.md`](backend/README.md) | Variables, comandos, tabla de endpoints, los 20 prefijos montados, capa, unidad de trabajo, cómo añadir una migración o un módulo, autenticación y las 13 desviaciones del contrato |
| [`frontend/README.md`](frontend/README.md) | Sistema de diseño, inventario de widgets, configuración de la API y reglas del repositorio. **Parcialmente desactualizado**: su §6 y §11 ya no reflejan el estado de `lib/` |

### Orden de lectura para una persona nueva

1. Este README.
2. [`docs/DESIGN.md`](docs/DESIGN.md) §1: qué es el sistema y los principios que lo gobiernan.
3. [`backend/README.md`](backend/README.md) §2 y §4: arranque y comandos, y luego `npm run dev` con `GET /api/v1/health`.
4. [`docs/DESIGN.md`](docs/DESIGN.md) §7 (reglas de negocio) y §9 (RBAC) según el área que te toque.

## Licencia

`UNLICENSED`. Todos los derechos reservados. Sin licencia de uso, copia, modificación ni distribución.

## Estado

Proyecto en desarrollo activo, con las dos mitades verificadas: el backend con **636
tests** en verde y el frontend con **209 tests** y `flutter analyze` sin errores. El sistema está desplegado en Docker y comprobable de punta a punta con un APK
firmado (`entrega/`). Queda pendiente el historial agregado del cliente
(`GET /customers/:id/orders` y familia, declarados en el contrato y ausentes del router).
