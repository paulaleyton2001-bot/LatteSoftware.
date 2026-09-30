// Qué puede hacer QUIEN en el módulo de alquiler de sillas.
// Módulo `features/chair/domain/entities`.
//
// POR QUÉ ESTO ES UNA ENTIDAD Y NO UN `if (user.isStaff)` EN CADA WIDGET
// ------------------------------------------------------------------------
// El módulo de silla tiene TRES acciones que el backend no reparte por igual:
//   · reservar (`POST /reservations`      → `reservations:create`)
//   · alquilar sin cita (`POST /rentals`  → `rentals:create`)
//   · cambiar el estado de la silla
//     (`PATCH /chairs/:id/status`         → `chairs:status:update`)
// y además dos sobre un alquiler ya abierto (`rentals:extend`,
// `rentals:complete`).
//
// Comprobar el permiso dentro de cada botón repetiría la matriz de RBAC en la
// interfaz, que es justo lo que prohíbe `docs/DESIGN.md` §9: la fuente de verdad
// son las CLAVES que devuelve `GET /auth/me`. Aquí se resuelve UNA vez a un valor
// booleano por capacidad y la interfaz solo pregunta.
//
// VERIFICADO CONTRA EL BACKEND CON PETICIONES REALES (2026-09-29)
// ------------------------------------------------------------------
// Ver `test/chair_rental_test.dart` (matriz fijada como contrato) y el informe de
// la tarea. Resumen, con la cabecera `Authorization: Bearer` de cada rol:
//
//   CUSTOMER (id 12, rol CUSTOMER)
//     GET  /chairs/map            → 200
//     GET  /reservations/quote    → 200
//     POST /reservations          → 201
//     POST /rentals               → 403 INSUFFICIENT_PERMISSIONS "rentals:create"
//     POST /rentals/:id/extend    → 403 INSUFFICIENT_PERMISSIONS "rentals:extend"
//     POST /rentals/:id/complete  → 403 INSUFFICIENT_PERMISSIONS "rentals:complete"
//     PATCH /chairs/:id/status    → 403 INSUFFICIENT_PERMISSIONS
//                                     "chairs:status:update"
//
//   ADMIN (id 11, rol ADMIN): las cinco anteriores → 201/200.
//
// CONCLUSIÓN QUE CONDICIONA EL DISEÑO
// El camino del cliente es la RESERVA. El alquiler sin cita (walk-in) es una
// operación de SALA: la hace el personal en el mostrador, no desde el móvil del
// cliente. Por eso `canOpenWalkIn` es `false` para un `CUSTOMER` y el botón NO se
// esconde: se muestra DESHABILITADO con el motivo (ver
// `ChairActionPanel`), porque un botón que desaparece deja a la persona creyendo
// que la app está rota.
//
// LA MATRIZ ESTÁ EN `permissions.ts` DEL BACKEND, NO AQUÍ
// Este archivo NO decide quién puede qué: TRADUCE lo que el servidor ya decidió
// (`User.permissions`) a algo que un widget pueda preguntar. Si mañana el backend
// abre `rentals:create` a los clientes, esta clase no cambia: cambia la lista que
// llega en el token, que es el sitio correcto.

/// Capacidades del actor actual sobre el módulo de sillas.
///
/// Inmutable y comparable por valor: la interfaz la lee en `build` y solo tiene que
/// redibujar cuando cambia el conjunto de permisos, no cuando cambia el `User`.
class ChairCapabilities {
  const ChairCapabilities({
    this.canReserve = false,
    this.canConfirmReservation = false,
    this.canCancelReservation = false,
    this.canOpenWalkIn = false,
    this.canExtendRental = false,
    this.canCompleteRental = false,
    this.canChangeChairStatus = false,
    this.canSeeOccupantIdentity = false,
  });

  /// Capacidades de un `CUSTOMER` sin ningún permiso de sala.
  ///
  /// No se usan como atajo en la interfaz (eso sería volver a adivinar el rol):
  /// están para los tests y para documentar el caso base.
  static const ChairCapabilities none = ChairCapabilities();

  /// `POST /reservations` — `reservations:create`.
  ///
  /// Es el permiso con marca `P` en la matriz: un `CUSTOMER` lo tiene y el
  /// service le fuerza `customerId = auth.userId` (el alcance lo decide el
  /// servidor, nunca el cliente).
  final bool canReserve;

  /// `POST /reservations/:id/confirm` — `reservations:update`.
  ///
  /// El `CUSTOMER` LO TIENE. Verificado con `curl` el 2026-09-29 con el token de
  /// `cliente1@lattecoffe.co` (rol CUSTOMER):
  ///   POST /api/v1/reservations/6/confirm → 200, `status: "CONFIRMED"`
  ///
  /// Hace falta porque `POST /reservations` devuelve la reserva en `PENDING` y una
  /// `PENDING` NO aparta la silla: tras crearla, `GET /chairs/:id` sigue
  /// devolviendo `status: "AVAILABLE"`. Sin este paso, la reserva del cliente no
  /// sujetaba nada.
  final bool canConfirmReservation;

  /// `POST /reservations/:id/cancel` — `reservations:cancel`. El `CUSTOMER` lo
  /// tiene; verificado con `curl` (cancelar la `RES-900009` → `200 CANCELLED`).
  final bool canCancelReservation;

  /// `POST /rentals` — `rentals:create`. Denegado a `CUSTOMER` (marca `-`).
  final bool canOpenWalkIn;

  /// `POST /rentals/:id/extend` — `rentals:extend`. Denegado a `CUSTOMER`.
  final bool canExtendRental;

  /// `POST /rentals/:id/complete` — `rentals:complete`. Denegado a `CUSTOMER`.
  final bool canCompleteRental;

  /// `PATCH /chairs/:id/status` — `chairs:status:update`. Denegado a `CUSTOMER`.
  final bool canChangeChairStatus;

  /// `rentals:read:any` — puede saber QUIÉN ocupa una silla ajena.
  ///
  /// Importa por privacidad: `GET /rentals/chair/:id/active` NO está acotado al
  /// actor (ver `ChairBookingDataSource.activeRentalByChair`), así que sin este
  /// permiso la interfaz NO muestra el nombre de otra persona aunque el servidor se
  /// lo mande. Ver `ChairActionPanel`.
  final bool canSeeOccupantIdentity;

  /// Lee las capacidades de las CLAVES de permiso del token.
  ///
  /// Una sola fuente: la lista de `GET /auth/me` (BR-RBAC-005). No se mira el rol.
  factory ChairCapabilities.fromPermissions(List<String> permissions) {
    bool has(String key) => permissions.contains(key);
    return ChairCapabilities(
      canReserve: has('reservations:create'),
      canConfirmReservation: has('reservations:update'),
      canCancelReservation: has('reservations:cancel'),
      canOpenWalkIn: has('rentals:create'),
      canExtendRental: has('rentals:extend'),
      canCompleteRental: has('rentals:complete'),
      canChangeChairStatus: has('chairs:status:update'),
      canSeeOccupantIdentity: has('rentals:read:any'),
    );
  }

  /// `true` si el actor no puede hacer NADA de lo que ofrece el panel: entonces la
  /// pantalla se limita a explicar el estado, sin una sola acción muerta.
  bool get isReadOnly =>
      !canReserve && !canOpenWalkIn && !canChangeChairStatus;
  // ------------------------------------------------- Motivos de denegación
  //
  // Se escriben UNA vez aquí y la interfaz solo los pinta. Motivo: el mismo
  // texto en tres sitios acaba divergiendo, y la duda real del usuario ("¿por qué
  // no puedo?") tiene la misma respuesta en todos.
  //
  // Se nombran con la CLAVE del permiso: quien soporte la atienda por teléfono
  // puede leerla y saber exactamente qué falta.

  /// Por qué no se puede alquilar sin cita. `null` si sí se puede.
  String? get walkInBlockedReason => canOpenWalkIn
      ? null
      : 'Alquilar sin cita lo abre el personal del mostrador. Tu cuenta no tiene '
          'el permiso «rentals:create», así que desde aquí solo puedes reservar '
          'una hora concreta. Pídele que te abran la silla en caja.';

  /// Por qué no se puede extender. `null` si sí se puede.
  String? get extendBlockedReason => canExtendRental
      ? null
      : 'Extender un alquiler lo hace el personal («rentals:extend»). Diles que '
          'quieres alargar tu silla y os lo amplían al precio de tu silla.';

  /// Por qué no se puede terminar el alquiler. `null` si sí se puede.
  String? get completeBlockedReason => canCompleteRental
      ? null
      : 'Cerrar el alquiler lo hace el personal en el mostrador '
          '(«rentals:complete»). Paga allí y te devuelven la silla.';

  /// Por qué no se puede cambiar el estado de la silla. `null` si sí se puede.
  String? get chairStatusBlockedReason => canChangeChairStatus
      ? null
      : 'El estado de una silla («chairs:status:update») solo lo cambia el '
          'personal del local.';

  /// Por qué no se puede confirmar la reserva. `null` si sí se puede.
  String? get confirmReservationBlockedReason => canConfirmReservation
      ? null
      : 'Confirmar la reserva («reservations:update») no está en tu cuenta. '
          'Pídeselo al personal del mostrador.';

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ChairCapabilities &&
          other.canReserve == canReserve &&
          other.canConfirmReservation == canConfirmReservation &&
          other.canCancelReservation == canCancelReservation &&
          other.canOpenWalkIn == canOpenWalkIn &&
          other.canExtendRental == canExtendRental &&
          other.canCompleteRental == canCompleteRental &&
          other.canChangeChairStatus == canChangeChairStatus &&
          other.canSeeOccupantIdentity == canSeeOccupantIdentity;

  @override
  int get hashCode => Object.hash(
        canReserve,
        canConfirmReservation,
        canCancelReservation,
        canOpenWalkIn,
        canExtendRental,
        canCompleteRental,
        canChangeChairStatus,
        canSeeOccupantIdentity,
      );

  @override
  String toString() => 'ChairCapabilities(reserva: $canReserve, confirma: '
      '$canConfirmReservation, walk-in: $canOpenWalkIn, extiende: '
      '$canExtendRental, cierra: $canCompleteRental, estado: '
      '$canChangeChairStatus)';
}
