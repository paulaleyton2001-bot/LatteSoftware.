// Estados visuales de pagos, reservas y alquileres. MÓDULO `StatusBadge`.
//
// Separado de `status_badge_visuals.dart` solo por tamaño de archivo: son las
// mismas reglas (texto + ícono + color, contraste AA), otro subdominio de la
// máquina de estados. `status_badge_resolver.dart` combina ambos catálogos.
import 'package:flutter/material.dart';
import './status_badge_visuals.dart';



/// Catálogo de estados de pago, reserva y alquiler.
abstract final class AppStatusVisualsOps {
  // ------------------------------------------------ Pagos — `PaymentStatus`
  static const AppStatusVisual paymentPending = AppStatusVisual(
    label: 'Pago pendiente', icon: Icons.hourglass_empty_rounded,
      palette: StatusPalette.pending);

  static const AppStatusVisual paymentApproved = AppStatusVisual(
    label: 'Pagado', icon: Icons.paid_rounded,
      palette: StatusPalette.ready);

  static const AppStatusVisual paymentFailed = AppStatusVisual(
    label: 'Pago fallido', icon: Icons.error_outline_rounded,
      palette: StatusPalette.cancelled);

  static const AppStatusVisual paymentRefunded = AppStatusVisual(
    label: 'Reembolsado', icon: Icons.currency_exchange_rounded,
      palette: StatusPalette.cancelled);

  // ------------------- Reservas / alquileres (`ReservationStatus`, `RentalStatus`)
  static const AppStatusVisual reservationUpcoming = AppStatusVisual(
    label: 'Próxima', icon: Icons.upcoming_rounded,
      palette: StatusPalette.reserved);

  static const AppStatusVisual rentalActive = AppStatusVisual(
    label: 'En curso', icon: Icons.timer_rounded,
      palette: StatusPalette.occupied);

  static const AppStatusVisual rentalExtended = AppStatusVisual(
    label: 'Extendido', icon: Icons.more_time_rounded,
      palette: StatusPalette.occupied);

  static const AppStatusVisual completed = AppStatusVisual(
    label: 'Finalizado', icon: Icons.archive_rounded,
      palette: StatusPalette.closed);

  static const AppStatusVisual cancelled = AppStatusVisual(
    label: 'Cancelado', icon: Icons.cancel_outlined,
      palette: StatusPalette.cancelled);

  static const AppStatusVisual expired = AppStatusVisual(
    label: 'Vencida', icon: Icons.timer_off_rounded,
      palette: StatusPalette.closed);
}
