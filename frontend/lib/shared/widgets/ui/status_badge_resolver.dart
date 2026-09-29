// Resolución `String` (de la API) → [AppStatusVisual]. MÓDULO `StatusBadge`.
//
// Es el puente entre los enums que manda el backend y el catálogo visual. Un
// valor desconocido NUNCA rompe la pantalla: cae en
// `AppStatusVisuals.unknown`, que sigue cumpliendo texto + ícono + color.
//
// Las claves son los literales de `GET /api/v1/meta/enums` (API.md §6.2).
// Si el backend agrega un estado, el fallback se ve (bug visible) en vez de
// desaparecer en silencio: esa es la intención.

import 'package:flutter/material.dart';

import '../../../app/theme/app_tokens.dart';
import './status_badge_visuals.dart';
import './status_badge_visuals_ops.dart';

/// `ChairStatus` → visual. `AVAILABLE | OCCUPIED | RESERVED | BLOCKED |
/// MAINTENANCE | CLEANING`.
AppStatusVisual forChair(String status) =>
    _chairVisuals[status] ?? AppStatusVisuals.unknown;

/// `OrderStatus` → visual.
AppStatusVisual forOrder(String status) =>
    _orderVisuals[status] ?? AppStatusVisuals.unknown;

/// `PaymentStatus` → visual.
AppStatusVisual forPayment(String status) =>
    _paymentVisuals[status] ?? AppStatusVisuals.unknown;

/// `ReservationStatus` → visual.
AppStatusVisual forReservation(String status) =>
    _reservationVisuals[status] ?? AppStatusVisuals.unknown;

/// `RentalStatus` → visual.
AppStatusVisual forRental(String status) =>
    _rentalVisuals[status] ?? AppStatusVisuals.unknown;

/// Búsqueda genérica: intenta silla → pedido → pago → reserva → alquiler.
/// Útil cuando el estado llega de un webhook sin dominio conocido.
AppStatusVisual forAny(String status) =>
    _chairVisuals[status] ??
    _orderVisuals[status] ??
    _paymentVisuals[status] ??
    _reservationVisuals[status] ??
    _rentalVisuals[status] ??
    AppStatusVisuals.unknown;

const Map<String, AppStatusVisual> _chairVisuals = <String, AppStatusVisual>{
  'AVAILABLE': AppStatusVisuals.chairAvailable,
  'OCCUPIED': AppStatusVisuals.chairOccupied,
  'RESERVED': AppStatusVisuals.chairReserved,
  'BLOCKED': AppStatusVisuals.chairBlocked,
  'MAINTENANCE': AppStatusVisuals.chairMaintenance,
  'CLEANING': AppStatusVisuals.chairCleaning,
};

const Map<String, AppStatusVisual> _orderVisuals = <String, AppStatusVisual>{
  'DRAFT': AppStatusVisuals.orderDraft,
  'PENDING': AppStatusVisuals.orderPending,
  'CONFIRMED': AppStatusVisuals.orderConfirmed,
  'PREPARING': AppStatusVisuals.orderPreparing,
  'READY': AppStatusVisuals.orderReady,
  'DELIVERING': AppStatusVisuals.orderDelivering,
  'COMPLETED': AppStatusVisuals.orderCompleted,
  'CANCELLED': AppStatusVisuals.orderCancelled,
  'REFUNDED': AppStatusVisuals.orderRefunded,
};

const Map<String, AppStatusVisual> _paymentVisuals = <String, AppStatusVisual>{
  'PENDING': AppStatusVisualsOps.paymentPending,
  'APPROVED': AppStatusVisualsOps.paymentApproved,
  'FAILED': AppStatusVisualsOps.paymentFailed,
  'REFUNDED': AppStatusVisualsOps.paymentRefunded,
  'PARTIALLY_REFUNDED': AppStatusVisualsOps.paymentRefunded,
  'CANCELLED': AppStatusVisualsOps.cancelled,
};

const Map<String, AppStatusVisual> _reservationVisuals =
    <String, AppStatusVisual>{
  'PENDING': AppStatusVisuals.orderPending,
  'CONFIRMED': AppStatusVisualsOps.reservationUpcoming,
  'ACTIVE': AppStatusVisualsOps.rentalActive,
  'COMPLETED': AppStatusVisualsOps.completed,
  'CANCELLED': AppStatusVisualsOps.cancelled,
  'EXPIRED': AppStatusVisualsOps.expired,
};

const Map<String, AppStatusVisual> _rentalVisuals = <String, AppStatusVisual>{
  'ACTIVE': AppStatusVisualsOps.rentalActive,
  'EXTENDED': AppStatusVisualsOps.rentalExtended,
  'COMPLETED': AppStatusVisualsOps.completed,
  'CANCELLED': AppStatusVisualsOps.cancelled,
};

/// Resuelve la paleta semántica de un estado contra los tokens del tema.
///
/// ESTE ES EL PUNTO ÚNICO donde un estado se convierte en color. Todo lo demás
/// del módulo trabaja con [AppStatusVisual] (que es `const`) y llama aquí en el
/// momento de pintar, con el tema ya resuelto: por eso el mismo catálogo sirve
/// para el modo claro y el oscuro sin duplicar 30 triplets.
StatusColors statusColorsOf(BuildContext context, StatusPalette palette) {
  final AppTokens t = context.tokens;
  return switch (palette) {
    StatusPalette.available => StatusColors(
        surface: t.availableSurface, text: t.availableText, dot: t.availableDot),
    StatusPalette.occupied => StatusColors(
        surface: t.occupiedSurface, text: t.occupiedText, dot: t.occupiedDot),
    StatusPalette.reserved => StatusColors(
        surface: t.reservedSurface, text: t.reservedText, dot: t.reservedDot),
    StatusPalette.blocked => StatusColors(
        surface: t.blockedSurface, text: t.blockedText, dot: t.blockedDot),
    StatusPalette.maintenance => StatusColors(
        surface: t.maintenanceSurface,
        text: t.maintenanceText,
        dot: t.maintenanceDot),
    StatusPalette.cleaning => StatusColors(
        surface: t.cleaningSurface, text: t.cleaningText, dot: t.cleaningDot),
    StatusPalette.pending => StatusColors(
        surface: t.orderPendingSurface,
        text: t.orderPendingText,
        dot: t.orderPendingDot),
    StatusPalette.progress => StatusColors(
        surface: t.orderProgressSurface,
        text: t.orderProgressText,
        dot: t.orderProgressDot),
    StatusPalette.ready => StatusColors(
        surface: t.orderReadySurface, text: t.orderReadyText, dot: t.orderReadyDot),
    StatusPalette.closed => StatusColors(
        surface: t.orderClosedSurface, text: t.orderClosedText, dot: t.orderClosedDot),
    StatusPalette.cancelled => StatusColors(
        surface: t.orderCancelledSurface,
        text: t.orderCancelledText,
        dot: t.orderCancelledDot),
    StatusPalette.neutral => StatusColors(
        surface: t.surfaceNeutralSubtle,
        text: t.textNeutral,
        dot: t.stateNeutral),
  };
}
