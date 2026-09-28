// Catálogo de estados visuales de negocio. MÓDULO `StatusBadge`.
//
// ⚠️ Este archivo es la ÚNICA fuente de "cómo se ve un estado" en la app.
// Se consume a través de las fábricas de `status_badge.dart` y de los
// resolvers de `status_badge_resolver.dart`. Ninguna feature re-declara el
// mapa: si falta un estado, se agrega AQUÍ, no en la pantalla.
//
// Por qué se separa del widget: son ~30 estados y un archivo de widget debe
// seguir siendo legible. Las reglas viven en un solo módulo.
//
// REGLAS (WCAG 1.4.1 no solo color, 1.4.11 uso de color):
//   - Texto visible siempre. ~8% de los hombres tiene daltonismo rojo/verde y
//     "ocupada" / "disponible" son idénticos sin forma.
//   - Ícono distinto por estado (también para impresión B/N).
//   - El texto usa el tono oscuro del mismo color sobre su superficie diluida,
//     con contraste AA verificado (docs/DESIGN-TOKENS.md §1.4 y §6).
//
// Las claves son los literales exactos de `GET /api/v1/meta/enums` (API.md
// §6.2): la app NO re-declara los enums del backend para no divergir.

import 'package:flutter/material.dart';

import '../../../app/theme/app_colors.dart';

/// Resolución visual de un estado. Inmutable y comparable por valor.
@immutable
final class AppStatusVisual {
  const AppStatusVisual({
    required this.label,
    required this.icon,
    required this.surface,
    required this.text,
    required this.dot,
  });

  /// Texto visible y anunciado (español, minúscula: encaja en chips).
  final String label;

  /// Ícono: segundo canal de información además del color.
  final IconData icon;

  /// Fondo del pill (color del estado muy diluido).
  final Color surface;

  /// Texto e ícono: tono oscuro del mismo color (AA verificado).
  final Color text;

  /// Punto sólido para tablas densas donde no cabe el ícono.
  final Color dot;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is AppStatusVisual && label == other.label && icon == other.icon;

  @override
  int get hashCode => Object.hash(label, icon);

  @override
  String toString() => 'AppStatusVisual($label)';
}

/// Catálogo único de estados visuales. No instanciable.
abstract final class AppStatusVisuals {
  // ------------------------------------------------ Sillas — `ChairStatus`
  static const AppStatusVisual chairAvailable = AppStatusVisual(
    label: 'Disponible', icon: Icons.event_available_rounded,
    surface: AppStateColors.availableSurface, text: AppStateColors.availableText,
    dot: AppStateColors.availableDot);

  static const AppStatusVisual chairOccupied = AppStatusVisual(
    label: 'Ocupada', icon: Icons.event_seat_rounded,
    surface: AppStateColors.occupiedSurface, text: AppStateColors.occupiedText,
    dot: AppStateColors.occupiedDot);

  static const AppStatusVisual chairReserved = AppStatusVisual(
    label: 'Reservada', icon: Icons.event_note_rounded,
    surface: AppStateColors.reservedSurface, text: AppStateColors.reservedText,
    dot: AppStateColors.reservedDot);

  static const AppStatusVisual chairBlocked = AppStatusVisual(
    label: 'Bloqueada', icon: Icons.block_rounded,
    surface: AppStateColors.blockedSurface, text: AppStateColors.blockedText,
    dot: AppStateColors.blockedDot);

  static const AppStatusVisual chairMaintenance = AppStatusVisual(
    label: 'Mantenimiento', icon: Icons.build_rounded,
    surface: AppStateColors.maintenanceSurface, text: AppStateColors.maintenanceText,
    dot: AppStateColors.maintenanceDot);

  static const AppStatusVisual chairCleaning = AppStatusVisual(
    label: 'Limpieza', icon: Icons.cleaning_services_rounded,
    surface: AppStateColors.cleaningSurface, text: AppStateColors.cleaningText,
    dot: AppStateColors.cleaningDot);

  // ----------------------------------------------- Pedidos — `OrderStatus`
  static const AppStatusVisual orderDraft = AppStatusVisual(
    label: 'Borrador', icon: Icons.edit_note_rounded,
    surface: AppStateColors.orderClosedSurface, text: AppStateColors.orderClosedText,
    dot: AppStateColors.orderClosedDot);

  static const AppStatusVisual orderPending = AppStatusVisual(
    label: 'Pendiente', icon: Icons.schedule_rounded,
    surface: AppStateColors.orderPendingSurface, text: AppStateColors.orderPendingText,
    dot: AppStateColors.orderPendingDot);

  static const AppStatusVisual orderConfirmed = AppStatusVisual(
    label: 'Confirmado', icon: Icons.check_circle_outline_rounded,
    surface: AppStateColors.orderProgressSurface, text: AppStateColors.orderProgressText,
    dot: AppStateColors.orderProgressDot);

  static const AppStatusVisual orderPreparing = AppStatusVisual(
    label: 'En preparación', icon: Icons.local_cafe_rounded,
    surface: AppStateColors.orderPendingSurface, text: AppStateColors.orderPendingText,
    dot: AppStateColors.orderPendingDot);

  static const AppStatusVisual orderReady = AppStatusVisual(
    label: 'Listo', icon: Icons.room_service_rounded,
    surface: AppStateColors.orderReadySurface, text: AppStateColors.orderReadyText,
    dot: AppStateColors.orderReadyDot);

  static const AppStatusVisual orderDelivering = AppStatusVisual(
    label: 'En camino', icon: Icons.delivery_dining_rounded,
    surface: AppStateColors.orderProgressSurface, text: AppStateColors.orderProgressText,
    dot: AppStateColors.orderProgressDot);

  static const AppStatusVisual orderCompleted = AppStatusVisual(
    label: 'Completado', icon: Icons.done_all_rounded,
    surface: AppStateColors.orderClosedSurface, text: AppStateColors.orderClosedText,
    dot: AppStateColors.orderClosedDot);

  static const AppStatusVisual orderCancelled = AppStatusVisual(
    label: 'Cancelado', icon: Icons.cancel_rounded,
    surface: AppStateColors.orderCancelledSurface, text: AppStateColors.orderCancelledText,
    dot: AppStateColors.orderCancelledDot);

  static const AppStatusVisual orderRefunded = AppStatusVisual(
    label: 'Reembolsado', icon: Icons.undo_rounded,
    surface: AppStateColors.orderCancelledSurface, text: AppStateColors.orderCancelledText,
    dot: AppStateColors.orderCancelledDot);

  /// Fallback para un estado no catalogado: nunca se muestra un color solo.
  static const AppStatusVisual unknown = AppStatusVisual(
    label: 'Desconocido', icon: Icons.help_outline_rounded,
    surface: AppColors.surfaceNeutralSubtle, text: AppColors.textNeutral,
    dot: AppColors.stateNeutral);
}
