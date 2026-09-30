# CAMBIOS — Módulo de sillas (pestaña «Silla»)

> Informe para el resto del equipo. **No editar este fichero desde fuera de
> `lib/features/chair/`.**
>
> Todo lo que se afirma aquí está verificado contra el backend en ejecución
> (`localhost:3000`, 2026-09-29) y en un dispositivo real (Motorola, Android 16,
> 1220x2712). Los comandos `curl` exactos están al final.

---

## 1. Qué estaba roto y qué se ha tocado

### 1.1 El bug original (el queanyone podría reproducir en 30 segundos)

**Causa exacta:** `chair_tab_page.dart`, el panel que consume la selección se
construía **solo si `context.breakpoint.usesSidebar` era `true`**:

```dart
// ANTES (el bug)
final Widget? right = wide && map.hasValue
    ? SelectedChairPanel(map: map.requireValue, selectedId: _selectedId)
    : null;
return right == null ? left : Row(...);
```

En un móvil `usesSidebar` es `false`, así que `right` era `null` y `build`
devolvía únicamente la lista. El `onSelect` solo hacía
`setState(() => _selectedId = chair.id)`: la selección se guardaba y **no se
pintaba nada**. Por eso el `logcat` no mostraba ninguna llamada a la API — la app
ni lo intentaba. Además `RentalRepository` declaraba únicamente `myRentals()`:
no había un solo método de escritura en toda la feature.

**Arreglado:** `_selectChair` abre un `showModalBottomSheet` en estrecho y marca
la selección en ancho, con el MISMO `ChairActionPanel` en los dos casos para que
no puedan divergir.

### 1.2 Un CRASH que hacía la pantalla roja (no lo había visto nadie)

`Semantics(scopesRoute: true, namesRoute: true, …)` **sin**
`explicitChildNodes: true` hace que Flutter 3.24 afirme en
`rendering/proxy_box.dart` L4291:

```
'(_properties.scopesRoute ?? false) && explicitChildNodes) || !(_properties.scopesRoute ?? false)':
explicitChildNodes must be set to true if scopes route is true
```

Al tocar una silla se pintaba la pantalla ROJA con el volcado de la aserción.
Compilaba, `flutter analyze` salía limpio y los tests pasaban. Es una aserción de
DEBUG: en release el panel aparecería sin que el lector de pantalla supiera que
había cambiado de ruta. **Arreglado** en `_ChairSheetFrame` y fijado con un test
(`test/chair_action_panel_test.dart`).

### 1.3 `PENDING` no es `CONFIRMED` — y la app lo mentía

Verificado con `curl`: `POST /reservations` devuelve la reserva en `PENDING` y
**la silla sigue en `AVAILABLE`**. Solo `POST /reservations/:id/confirm` la pasa a
`CONFIRMED` y pone la silla en `RESERVED`.

El texto que se pintaba era «La silla ya aparece como reservada en el mapa»,
justo con una `PENDING`. Ahora:

- El panel de éxito dice si está **Pendiente** o **Próxima** (confirmada), con el
  aviso correspondiente.
- Hay un botón **«Confirmar mi reserva»** (`reservations:update`, que el
  `CUSTOMER` sí tiene) y otro **«Cancelar esta reserva»**
  (`reservations:cancel`, también del `CUSTOMER`).
- `_FutureReservationCard` avisa cuando la reserva en curso sigue pendiente.

### 1.4 El fallo del envío no se pintaba NUNCA

`ChairBookingController` guardaba el `409` en un `_lastFailure` **privado** del
notifier. Ningún widget lo leía, y un `Failure` en un notifier no dispara ninguna
reconstrucción. Resultado: pulsar «Reservar» y recibir un `409` no pintaba nada;
el botón volvía a su estado y seemed un botón muerto.

Ahora el fallo vive en `ChairBookingState.failure` (estado inmutable → hay
reconstrucción) y se pinta con `explainBookingFailure`, que traduce el código a
español **conservando el subtipo** para que `FormErrorBanner` siga eligiendo el
icono y `isRetryable` no cambie.

### 1.5 El código de la reserva se perdía

El estado guardaba `bool created`; el `RES-900011` desaparecía. Ahora se guarda la
entidad `ChairBooking` completa y la pantalla de éxito enseña el código, que es
lo que se dice en el mostrador.

### 1.6 «Actualizar» solo refrescaba la mitad

El botón del mapa llamaba a `ref.invalidate(venueMapProvider)` y nada más. Con un
alquiler recién abierto desde el mostrador, el plano se actualizaba pero la
tarjeta «Tu silla» seguía diciendo «No tienes ninguna silla ahora». Verificado en
el dispositivo con `RENT-900009` (propio del cliente). Ahora usa
`refreshChairMap(ref)`, el mismo helper que se llama tras cada acción.

### 1.7 El panel de una silla ocupada no dejaba gestionarla

`ChairOccupancy` no traía `rentalId`, así que `POST /rentals/:id/extend` y
`/complete` eran imposibles desde el panel. Ahora:

- `ChairOccupancy` incluye `rentalId` y `reservationId`.
- Con una silla `OCCUPIED` y alquiler vivo, el panel ofrece **Ampliar** y
  **Terminar** si el actor tiene los permisos, y los muestra **deshabilitados con
  el motivo debajo** si no los tiene.
- Si el backend no trae `rentalId`, no se ofrecen: no hay botones que no puedan
  llamar a nadie.

### 1.8 Etiquetas de la celda

`numberLabel` venía con tres criterios (`1,2,3` en Terraza, `M1,M2` en Interior,
`B1,B2` en Ventana). `ChairInfo.cellLabel` ya devuelve el `code` (único `UNIQUE`
global e inmutable, y el mismo valor que aparece en el alquiler y la reserva).
**Verificado en dispositivo**: el plano pinta `TZ-01…TZ-06`, `IN-M01…IN-M04`,
`VN-01…VN-05`, `PR-A1…PR-A4`, `TW-01…TW-06`.

### 1.9 Other correcciones menores

- `_refreshEverything()` ahora invalida también `chairOccupancyProvider(chairId)`:
  tras reservar, el panel abierto seguía enseñando la silla como libre.
- El aviso del walk-in ya no dice «amplíala desde «Tu silla»» (para un `CUSTOMER`
  eso no era cierto: los permisos están denegados y la tarjeta no aparece).
- `explainBookingFailure` devuelve un `Failure` del mismo subtipo, no un `String`.

---

## 2. Matriz de permisos (VERIFICADA con peticiones reales)

Tokens usados: `cliente1@lattecoffe.co` / `LatteCofee#2026` (rol `CUSTOMER`) y
`prueba@lattecoffe.co` / `Prueba2026` (rol `ADMIN`).

| Endpoint | Permiso | `CUSTOMER` | `ADMIN` |
|---|---|:--:|:--:|
| `GET /chairs/map` | `chairs:map` | 200 | 200 |
| `GET /chairs/:id` | `chairs:read` | 200 | 200 |
| `GET /rentals` | `rentals:read` | 200 | 200 |
| `GET /rentals/chair/:id/active` | `rentals:read` | 200 | 200 |
| `GET /reservations/quote` | `reservations:read` | 200 | 200 |
| `POST /reservations` | `reservations:create` | **201** | 201 |
| `POST /reservations/:id/confirm` | `reservations:update` | **200** | 200 |
| `POST /reservations/:id/cancel` | `reservations:cancel` | **200** | 200 |
| `POST /rentals` (walk-in) | `rentals:create` | **403** | **201** |
| `POST /rentals/:id/extend` | `rentals:extend` | **403** | **200** |
| `POST /rentals/:id/complete` | `rentals:complete` | **403** | **200** |
| `PATCH /chairs/:id/status` | `chairs:status:update` | **403** | **200** |
| `POST /reservations/:id/check-in` | `reservations:checkin` | **403** | 200 |
| `POST /reservations/:id/extend` | `reservations:extend` | **403** | 200 |
| `POST /reservations/:id/complete` | `reservations:checkin` | **403** | 200 |

**Conclusión que condiciona el diseño:** el camino del cliente es la **RESERVA**
(crear → confirmar → cancelar). El alquiler sin cita es una operación de **sala**:
la hace el personal en el mostrador. Por eso `canOpenWalkIn` es `false` para un
`CUSTOMER` y el botón **no se esconde**: se muestra deshabilitado con el motivo
escrito debajo, porque un botón que desaparece deja a la persona creyendo que la
app está rota.

### 2.1 Evidencia `curl` (literal)

```console
$ curl -s -X POST localhost:3000/api/v1/rentals -H "Authorization: Bearer $CUSTOMER" \
       -H 'Content-Type: application/json' -H 'Idempotency-Key: probe-cust-rent-1' \
       -d '{"chairId":3,"plannedMinutes":60}'
{"success":false,"error":{"code":"AUTHORIZATION_ERROR","message":"No tiene permisos para realizar esta acción",
"details":{"code":"INSUFFICIENT_PERMISSIONS","required":"rentals:create","roles":["CUSTOMER"]}}}
# HTTP 403

$ curl -s -X POST localhost:3000/api/v1/rentals -H "Authorization: Bearer $ADMIN" \
       -H 'Content-Type: application/json' -H 'Idempotency-Key: probe-admin-rent-1' \
       -d '{"chairId":3,"plannedMinutes":60}'
{"success":true,"data":{"rental":{"id":6,"code":"RENT-900006","chairCode":"TZ-03","status":"ACTIVE",
"startAt":"2026-09-29T18:19:03.467Z","endAt":"2026-09-29T19:19:03.467Z","plannedMinutes":60,
"pricePerHourMinor":600000,"subtotalMinor":600000,"totalMinor":600000,...},
"chairStatus":"OCCUPIED","chairStatusChangedAt":"2026-09-29T18:19:03.468Z"},...}
# HTTP 201

$ curl -s -X POST localhost:3000/api/v1/rentals/6/extend -H "Authorization: Bearer $CUSTOMER" \
       -H 'Content-Type: application/json' -d '{"additionalMinutes":30}'
{"success":false,"error":{"code":"AUTHORIZATION_ERROR",...,"details":{"code":"INSUFFICIENT_PERMISSIONS",
"required":"rentals:extend","roles":["CUSTOMER"]}}}
# HTTP 403

$ curl -s -X POST localhost:3000/api/v1/rentals/6/extend -H "Authorization: Bearer $ADMIN" \
       -H 'Content-Type: application/json' -d '{"additionalMinutes":30}'
{"success":true,"data":{"rental":{"code":"RENT-900006","status":"EXTENDED",
"endAt":"2026-09-29T19:49:03.467Z","extensionsMinor":300000,"totalMinor":900000,...},
"extension":{"id":2,"requestedMinutes":30,"previousEndAt":"2026-09-29T19:19:03.467Z",
"newEndAt":"2026-09-29T19:49:03.467Z","additionalMinor":300000,"pricePerHourMinor":600000,...},
"chairStatus":"OCCUPIED"}}
# HTTP 200

$ curl -s -X POST localhost:3000/api/v1/rentals/6/complete -H "Authorization: Bearer $CUSTOMER" \
       -H 'Content-Type: application/json' -d '{}'
{"success":false,"error":{...,"details":{"code":"INSUFFICIENT_PERMISSIONS","required":"rentals:complete"}}}
# HTTP 403

$ curl -s -X POST localhost:3000/api/v1/rentals/6/complete -H "Authorization: Bearer $ADMIN" \
       -H 'Content-Type: application/json' -d '{}'
{"success":true,"data":{"rental":{"code":"RENT-900006","status":"COMPLETED","billedMinutes":30,...},
"charge":{"billedMinutes":30,"minimumApplied":true,"subtotalMinor":600000,"extensionsMinor":300000,
"taxMinor":171000,"grandTotalMinor":1071000,"currencyCode":"COP"},"chairStatus":"CLEANING"}}
# HTTP 200

$ curl -s -X POST localhost:3000/api/v1/reservations -H "Authorization: Bearer $CUSTOMER" \
       -H 'Content-Type: application/json' \
       -d '{"chairId":4,"startAt":"2026-09-29T20:19:00.000Z","endAt":"2026-09-29T22:19:00.000Z"}'
{"success":true,"data":{"id":6,"code":"RES-900006","chairCode":"TZ-04","customerId":7,
"customerName":"Camila Restrepo","status":"PENDING",...}}
# HTTP 201     <-- PENDING: la silla SIGUE en AVAILABLE

$ curl -s localhost:3000/api/v1/chairs/4 -H "Authorization: Bearer $CUSTOMER"
{"data":{"chair":{"code":"TZ-04","status":"AVAILABLE",...},"currentReservation":null,...}}
# <-- la PENDING no aparta la silla

$ curl -s -X POST localhost:3000/api/v1/reservations/6/confirm -H "Authorization: Bearer $CUSTOMER"
{"success":true,"data":{"id":6,"code":"RES-900006","status":"CONFIRMED",...}}
# HTTP 200     <-- el CUSTOMER SÍ puede confirmar

$ curl -s localhost:3000/api/v1/chairs/4 -H "Authorization: Bearer $CUSTOMER"
{"data":{"chair":{"code":"TZ-04","status":"RESERVED",...}}}
# <-- ahora sí

$ curl -s -X POST localhost:3000/api/v1/reservations/9/cancel -H "Authorization: Bearer $CUSTOMER" \
       -H 'Content-Type: application/json' -d '{"reason":"prueba"}'
{"success":true,"data":{"id":9,"code":"RES-900009","status":"CANCELLED",...}}
# HTTP 200

$ curl -s -X POST localhost:3000/api/v1/rentals -H "Authorization: Bearer $ADMIN" \
       -H 'Content-Type: application/json' -H 'Idempotency-Key: probe2' \
       -d '{"chairId":7,"plannedMinutes":30}'
{"success":false,"error":{"code":"CONFLICT_ERROR","message":"La silla ya tiene un alquiler abierto",
"details":{"code":"CHAIR_OCCUPIED","chairId":7,"activeRentalCode":"RENT-900004","activeRentalId":4}}}
# HTTP 409

$ curl -s -X POST localhost:3000/api/v1/reservations -H "Authorization: Bearer $CUSTOMER" \
       -H 'Content-Type: application/json' \
       -d '{"chairId":4,"startAt":"2026-09-29T20:30:00.000Z","endAt":"2026-09-29T21:30:00.000Z"}'
{"success":false,"error":{"code":"CONFLICT_ERROR","message":"La silla ya está reservada en esa franja horaria",
"details":{"code":"CHAIR_ALREADY_RESERVED","ruleId":"BR-RES-002",
"conflictingReservationCode":"RES-900006",...}}}
# HTTP 409
```

---

## 3. Endpoints que consume la pantalla «Silla»

| Método | Ruta | Dónde | Permiso |
|---|---|---|---|
| GET | `/locations?isActive=true&pageSize=1` | `core/customer/venue_datasource.dart` (para hallar el `locationId`) | `locations:read` |
| GET | `/chairs/map?locationId=` | `core/customer/venue_providers.dart` → `venueMapProvider` | `chairs:map` |
| GET | `/chairs/:id` | `ChairBookingDataSource.chairOccupancy` | `chairs:read` |
| GET | `/rentals?from&to&pageSize&order` | `ChairRemoteDataSource.myRentals` | `rentals:read` |
| GET | `/rentals/chair/:chairId/active` | `ChairBookingDataSource.activeRentalByChair` — **solo** con `rentals:read:any` | `rentals:read` |
| GET | `/reservations/quote?chairId&startAt&endAt` | `ChairBookingDataSource.quote` | `reservations:read` |
| POST | `/reservations` | `ChairBookingDataSource.createReservation` | `reservations:create` |
| POST | `/reservations/:id/confirm` | `ChairBookingDataSource.confirmReservation` | `reservations:update` |
| POST | `/reservations/:id/cancel` | `ChairBookingDataSource.cancelReservation` | `reservations:cancel` |
| POST | `/rentals` | `ChairBookingDataSource.openWalkInRental` | `rentals:create` |
| POST | `/rentals/:id/extend` | `ChairBookingDataSource.extendRental` | `rentals:extend` |
| POST | `/rentals/:id/complete` | `ChairBookingDataSource.completeRental` | `rentals:complete` |
| PATCH | `/chairs/:id/status` | `ChairBookingDataSource.setChairStatus` | `chairs:status:update` |

Fuera de esta feature pero alcanzables desde ella: `GET /reservations?from&to`
(pantalla «Mis reservas», `AppRoutes.reservations`).

### 3.1 Desviaciones de `docs/API.md` que la capa de datos tiene que conocer

Documentadas en la cabecera de `chair_booking_datasource.dart` y
`chair_booking.dart`. Resumen:

1. **`POST /rentals`** — API.md §7.9 dice `{ rental, chair, order, reservation }`;
   el backend real devuelve `{ rental, chairStatus, chairStatusChangedAt }`. Se lee
   la forma real.
2. **`GET /chairs/:id`** — API.md §7.7 lo documenta aplana (`{ ...Chair, zone }`);
   el backend real anida: `data.chair`. Se leen las dos formas.
3. **`POST /rentals` NO exige `Idempotency-Key`.** API.md §1 es explícito: solo
   `POST /payments` la exige. Aun así **se envía** (cabecera inocua): si algún día
   el walk-in pasa a ser idempotente, el cliente ya lo estará usando.
4. **`GET /chairs/:id` → `currentReservation`** solo viene cuando la reserva
   está en curso. Una reserva futura se ve por el **estado** de la silla
   (`RESERVED`) pero no aparece en ese campo.
5. `POST /reservations` con un rol de personal **no** asigna `customerId`: la
   reserva queda huérfana y no sale en «Mis reservas» de ese usuario. Es
   comportamiento del backend; si hace falta, habría que mandar `customerId`
   explícito.

### 3.2 `Idempotency-Key`

Se genera en `RentalRepositoryImpl.newIdempotencyKey()` con
`math.Random.secure()` (instancia única, reutilizada) y tiene forma UUID v4
(version y variante fijadas a mano). **No** se usa el paquete `uuid`: el proyecto
no depende de él y añadir una dependencia por una cabecera está excluido.

---

## 4. Ficheros tocados

### Nuevos

| Fichero | Qué es |
|---|---|
| `data/datasources/remote/chair_booking_datasource.dart` | Todas las rutas HTTP de la feature. |
| `data/parsers/chair_parsers.dart` | `JSON → entidad`. No lanza: un campo que falta da `null`. |
| `domain/entities/chair_booking.dart` | `ChairBookingSlot`, `ChairBooking`, `ChairOccupancy`, `ChairRental`, `ChairBookingQuote`. |
| `domain/entities/chair_capabilities.dart` | Traduce `User.permissions` a un booleano por capacidad. **No decide quién puede qué**: solo traduce. |
| `presentation/chair_action_controller.dart` | `walkInProvider`, `rentalActionProvider`, `chairStatusProvider`. Un `AsyncValue` por acción. |
| `presentation/chair_booking_controller.dart` | Cotización con retardo (350 ms) + descarte de respuestas obsoletas. |
| `presentation/chair_booking_state.dart` | Estado inmutable del flujo de reserva. |
| `presentation/widgets/chair_action_panel.dart` | El panel. Hoja modal en estrecho, columna en ancho. |
| `presentation/widgets/chair_reserve_form.dart` | Día / hora / duración / cotización / envío / éxito. |
| `presentation/widgets/chair_state_actions.dart` | 4 botones de estado de silla para personal. |

### Modificados

| Fichero | Cambio |
|---|---|
| `presentation/chair_tab_page.dart` | Hoja modal; **arreglo del crash de `Semantics`**; botón «Ver mis reservas». |
| `presentation/chair_controller.dart` | Capacidades, repositorio, ocupación, `refreshChairMap`, alias `*Override` para tests. |
| `presentation/widgets/chair_map_block.dart` | «Actualizar» refresca mapa **y** alquileres. |
| `presentation/widgets/active_rental_card.dart` | Botones apagados con motivo (ya estaba). Sin cambios funcionales. |
| `domain/repositories/rental_repository.dart` | `confirmReservation`, `cancelReservation`. |
| `data/repositories/rental_repository_impl.dart` | Implementación de las dos. |
| `../orders/presentation/widgets/extend_rental_control.dart` | Botón apagado en vez de oculto. |
| `../orders/presentation/widgets/order_blocks.dart` | Quitado el `if (canExtend)` que lo escondía. |
| `../orders/domain/entities/rental.dart` | `customerId` + `belongsTo(userId)`. |
| `../../core/customer/chair_map.dart` | `cellLabel` = `code`. |
| `../../shared/widgets/chair_map_grid.dart` | `allowUnavailableSelection` (ficha de una silla ocupada). |
| `../../core/customer/cart_providers.dart` | Puente `cartStateProvider` (arreglo del POS, no de sillas). |

### Tests

| Fichero | Tests |
|---|---|
| `test/chair_rental_test.dart` | 33 — matriz de permisos, etiqueta de celda, `PENDING ≠ CONFIRMED`, estado de la reserva, traducción de fallos, parseo, privacidad. |
| `test/chair_action_panel_test.dart` | 8 — widget: el crash de `Semantics`, el panel de una silla libre/ocupada, botones según permiso, aviso de `PENDING`. |

Suite completa: **164 tests** (antes 123). `flutter analyze`: **0 errores**.

---

## 5. Cómo repetir la verificación

```bash
# 1. Backend
cd ../backend && (nohup npm run dev > /tmp/opencode/fA.log 2>&1 &)
curl -s localhost:3000/api/v1/health

# 2. Login (dos tokens)
curl -s -X POST localhost:3000/api/v1/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"cliente1@lattecoffe.co","password":"LatteCofee#2026"}'   # CUSTOMER
curl -s -X POST localhost:3000/api/v1/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"prueba@lattecoffe.co","password":"Prueba2026"}'          # ADMIN

# 3. App
cd ../frontend
flutter build apk --debug
adb install -r build/app/outputs/flutter-apk/app-debug.apk
adb reverse tcp:3000 tcp:3000
adb shell am start -n co.lattecoffe.frontend/.MainActivity
```

**El `adb reverse` es imprescindible**: el móvil habla con `localhost:3000` en el
propio dispositivo, no en la máquina.

Ojo con `adb install -r`: si hay un APK de otra clave instalado da
`INSTALL_FAILED_UPDATE_INCOMPATIBLE` y hay que `adb uninstall` primero.

### 5.1 Recorrido verificado, paso a paso

Como `CUSTOMER` (`cliente1@lattecoffe.co`):

1. Pestaña «Silla» → «Toca una silla del mapa» + botón «Ver mis reservas».
2. Tocar **TZ-01** → se abre la hoja con código, zona, **$6.000/hora**, estado y
   las dos acciones. «Alquilar ahora» sale **apagado** con el motivo debajo.
3. «Reservar para una hora» → día / hora / duración (30 min · 1 · 2 · 3 · 4 h ·
   «Otro») + cotización en vivo de `GET /reservations/quote`.
4. Elegir 2 h → el total pasa a **$14.280** solo (retardo de 350 ms).
5. «Reservar por $14.280» → `RES-900011`, estado **Pendiente**, aviso de que la
   silla todavía puede ocuparla alguien, y botones **Confirmar** / **Cancelar**.
6. «Confirmar mi reserva» → `POST /reservations/11/confirm` → **CONFIRMED**, la
   silla pasa a `RESERVED` en el panel y en el mapa, sin recargar.
7. «Listo» → el mapa muestra TZ-01 **Reservada** y 21 de 25 libres.
8. «Ver mis reservas» → aparece **Silla TZ-01 · Próxima · RES-900011**.
9. Abrir **TZ-04** con la franja ya ocupada → el cotizador dice
   «Esa franja ya está ocupada (reserva RES-900005)» y el botón se apaga.
10. Con la cotización cacheada como «disponible» y la franja ocupada por otro
    (creada por `curl` entre medias) → pulsar «Reservar» devuelve **409** y se
    pinta el banner «No pudimos crear la reserva / Otra persona se ha adelantado…».
11. Reservar en **TZ-06** 3 h → `RES-900014` → «Cancelar esta reserva» → diálogo
    de confirmación → `CANCELLED` y la silla vuelve a `AVAILABLE`.
12. `adb reverse --remove-all` + «Actualizar» → **«Estás sin conexión»** con
    «Reintentar ahora»; al restaurar el reverse, «Reintentar ahora» recupera.

Como `ADMIN` (`prueba@lattecoffe.co`):

13. Abrir **VN-02** (ocupada por Camila) → muestra **«Camila Restrepo»** (tiene
    `rentals:read:any`) y **Ampliar / Terminar HABILITADOS**.
14. «Ampliar 30 min» → diálogo → `POST /rentals/9/extend` → `EXTENDED`, «Hasta»
    pasa de 15:25 a **15:55**, `extensionsMinor` 275000.
15. «Terminar y cobrar» → `POST /rentals/9/complete` → `COMPLETED`, `billedMinutes`
    30 (mínimo), silla a **CLEANING**.
16. «Marcar limpia» → `PATCH /chairs/12/status` → `AVAILABLE`.
17. «Alquilar ahora por 3 h» → `POST /rentals` → **201**, `RENT-900010`, el panel
    se invalida y muestra ya el alquiler con sus acciones.
18. Con el panel cacheado como libre y la silla ocupada por `curl` → **409
    `CHAIR_OCCUPIED`**, snackbar «Alguien se ha sentado en esa silla mientras
    mirabas» y el mapa refrescado.

### 5.2 Verificación en el backend de cada acción

| Acción en la app | Verificación |
|---|---|
| Reservar TZ-01 2 h | `RES-900011` CONFIRMED, `startAt 19:00Z`, `chairCode TZ-01`, `customerName "Camila Restrepo"` |
| Confirmar | `GET /chairs/1` → `status: "RESERVED"` |
| Cancelar TZ-06 | `RES-900014` CANCELLED, `GET /chairs/6` → `AVAILABLE` |
| Walk-in VN-02 3 h | `RENT-900010` ACTIVE, `chairStatus: "OCCUPIED"` |
| Ampliar 30 min | `RENT-900009` EXTENDED, `endAt 20:55:47Z`, `extensionsMinor 275000`, `totalMinor 1100000` |
| Terminar | `RENT-900009` COMPLETED, `billedMinutes 30`, `grandTotalMinor 1071000`, `chairStatus: "CLEANING"` |

---

## 6. Notas para quien siga

### 6.1 Lo que queda FUERA (y por qué)

- **Check-in y check-out** (`POST /reservations/:id/check-in` y `/complete`) exigen
  `reservations:checkin`, denegado al `CUSTOMER`. No se ofrecen: son de sala.
- **Asignar un cliente a la reserva del personal.** `POST /reservations` con rol de
  personal deja `customerId: null`, así que esa reserva no sale en «Mis reservas»
  de nadie. Es comportamiento del backend. Si molesta, la solución es mandar
  `customerId` explícito, lo que implica un selector de cliente en el panel.
- **Asignar un cliente al walk-in.** `WalkInController.open` ya acepta
  `customerId`, pero la UI no lo pide: un walk-in de mostrador puede no tener
  cliente detrás, y meter un buscador de clientes en el panel de una silla es
  otra pantalla.

### 6.2 Una brecha de privacidad del backend (NO arreglada, es de otro agente)

`GET /rentals/chair/:chairId/active` **no está acotado al actor**. Con el token de
`cliente1@lattecoffe.co` devuelve el `customerId` y el `customerName` de quien
ocupa cualquier silla. Comprobado:

```console
$ curl -s localhost:3000/api/v1/rentals/chair/16/active -H "Authorization: Bearer $CUSTOMER"
{"data":{"customerId":8,"customerName":"Julián Cardona",...}}
```

La mitigación **de cliente** está en dos sitios, por si uno se queda corto:
1. `ChairBookingDataSource.activeRentalByChair` solo se llama si
   `rentals:read:any` está en el token, y borra `customerId`/`customerName` si no.
2. `ChairParsers.rental(includeOccupantIdentity: false)` borra ambos campos aunque
   el servidor los mande.

Para un `CUSTOMER` ese endpoint **no se llama en absoluto**. Lo correcto es
acotarlo en el backend.

### 6.3 Reglas que no conviene romper

- **El total SIEMPRE es el del servidor.** `GET /reservations/quote` →
  `totalMinor`. Nunca se calcula en el móvil (BR-PRICE-008).
- **`isAvailable: false` NO es un error.** Es un `200` con la reserva que estorba
  en `conflict`. Un `409` ahí sería un error de diseño del cliente.
- **Todo botón denegado se PINTA con el motivo debajo**, nunca se esconde. El
  motivo nombra la CLAVE del permiso (`rentals:create`, `rentals:extend`…) para
  que soporte pueda leerla por teléfono. El mismo texto se usa en
  `chair_action_panel.dart`, `active_rental_card.dart` y
  `extend_rental_control.dart`, a propósito: la respuesta a «¿por qué no puedo?»
  no puede depender de la pantalla.
- **El occupant se decide con los alquileres del propio actor** (`myActiveChairIds`),
  nunca preguntando al endpoint que no acota. Ver 6.2.
- **Ningún fallo se sustituye por «no tienes nada».** Si la consulta falló, se
  muestra el error con reintento. Decir «no tienes silla» cuando lo que falló fue
  la consulta sería una mentira que cuesta dinero.

### 6.4 Lo que hace el agente anterior y hay que mantener

- El retardo de 350 ms antes de cotizar (`kQuoteDebounce`) y el **descarte de
  respuestas obsoletas** comparando la franja pedida con la seleccionada
  (`kQuoteSlotTolerance`). Sin eso, cambiar de duración deja pegado el precio de
  la anterior.
- `autoDispose` en todas las familias de providers: al cerrar el panel el estado
  se libera. Una familia sin `autoDispose` guardaría un `AsyncValue` por cada
  silla abierta en la sesión.
- El patrón de `_disposed` + `ref.onDispose` para cancelar el `Timer` y no
  escribir estado tras la destrucción. Riverpod 2.5 no tiene `ref.mounted`.
- El mismo `ChairActionPanel` en hoja modal y en columna, para que no puedan
  divergir.
- Los alias `chairCapabilitiesOverride` y `rentalRepositoryOverride` en
  `chair_controller.dart`: son el MISMO objeto provider (alias, no copia), y
  existen para que los tests puedan sustituir la sesión sin montarla entera.
