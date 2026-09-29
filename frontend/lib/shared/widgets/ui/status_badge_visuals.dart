// Catálogo de estados visuales de negocio. MÓDULO `StatusBadge`.
//
// ⚠️ Este archivo es la ÚNICA fuente de "cómo se ve un estado" en la app.
// Se consume a través de las fábricas de `status_badge.dart` y de los
// resolvers de `status_badge_resolver.dart`. Ninguna feature re-declara el
// mapa: si falta un estado, se agrega AQUÍ, no en la pantalla.
//
// POR QUÉ EL ESTADO GUARDA UNA CLAVE Y NO TRES COLORES
// Antes cada entrada congelaba `surface`, `text` y `dot` como `Color`
// constantes. Eso fijaba el catálogo al modo claro: en modo oscuro el pill de
// "Ocupada" salía naranja claro y su texto marrón encima (ilegible), y el
// punto de "Disponible" era un verde que no se distinguía del fondo. Ahora cada
// estado declara su [StatusPalette] —una clave semántica— y [StatusBadge] pide
// los tres colores a `AppTokens`, que ya está resuelto para el modo activo.
// Añadir un estado al catálogo sigue siendo una línea `const`.
//
// REGLAS (WCAG 1.4.1 no solo color, 1.4.11 uso de color):
//   - Texto visible siempre. ~8 % de los hombres tiene daltonismo rojo/verde y
//     "ocupada" / "disponible" son idénticos sin forma.
//   - Ícono distinto por estado (también para impresión B/N).
//   - El texto usa el tono del mismo color sobre su superficie diluida, con
//     contraste AA verificado en los dos modos (docs/DESIGN-TOKENS.md §1.4).

import 'package:flutter/material.dart';

/// Paleta semántica de un estado. Es la CLAVE, no el color.
///
/// [StatusBadge] la resuelve contra los tokens del tema activo; por eso el
/// catálogo entero sigue siendo `const` y el modo se aplica en un solo sitio.
enum StatusPalette {
  /// Silla libre.
  available,

  /// Silla ocupada ahora mismo.
  occupied,

  /// Silla con reserva.
  reserved,

  /// Silla bloqueada por el negocio.
  blocked,

  /// Silla en mantenimiento.
  maintenance,

  /// Silla por limpiar.
  cleaning,

  /// Pedido pendiente o en preparación.
  pending,

  /// Pedido confirmado o en camino.
  progress,

  /// Pedido listo / pagado.
  ready,

  /// Pedido cerrado con éxito.
  closed,

  /// Pedido cancelado o reembolsado.
  cancelled,

  /// Estado no catalogado.
  neutral,
}

/// Resolución visual de un estado. Inmutable y comparable por valor.
///
/// Solo describe el estado; los colores se piden al tema al pintar.
@immutable
final class AppStatusVisual {
  const AppStatusVisual({
    required this.label,
    required this.icon,
    required this.palette,
  });

  /// Texto visible y anunciado (español, minúscula: encaja en chips).
  final String label;

  /// Ícono: segundo canal de información además del color.
  final IconData icon;

  /// Paleta semántica; se resuelve a color con los tokens del tema activo.
  final StatusPalette palette;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is AppStatusVisual &&
          other.label == label &&
          other.icon == icon &&
          other.palette == palette;

  @override
  int get hashCode => Object.hash(label, icon, palette);

  @override
  String toString() => 'AppStatusVisual($label)';
}

/// Catálogo único de estados visuales. No instanciable.
abstract final class AppStatusVisuals {
  // ------------------------------------------------ Sillas — `ChairStatus`
  static const AppStatusVisual chairAvailable = AppStatusVisual(
      label: 'Disponible', icon: Icons.event_available_rounded,
      palette: StatusPalette.available);

  static const AppStatusVisual chairOccupied = AppStatusVisual(
      label: 'Ocupada', icon: Icons.event_seat_rounded,
      palette: StatusPalette.occupied);

  static const AppStatusVisual chairReserved = AppStatusVisual(
      label: 'Reservada', icon: Icons.event_note_rounded,
      palette: StatusPalette.reserved);

  static const AppStatusVisual chairBlocked = AppStatusVisual(
      label: 'Bloqueada', icon: Icons.block_rounded,
      palette: StatusPalette.blocked);

  static const AppStatusVisual chairMaintenance = AppStatusVisual(
      label: 'Mantenimiento', icon: Icons.build_rounded,
      palette: StatusPalette.maintenance);

  static const AppStatusVisual chairCleaning = AppStatusVisual(
      label: 'Limpieza', icon: Icons.cleaning_services_rounded,
      palette: StatusPalette.cleaning);

  // ----------------------------------------------- Pedidos — `OrderStatus`
  static const AppStatusVisual orderDraft = AppStatusVisual(
      label: 'Borrador', icon: Icons.edit_note_rounded,
      palette: StatusPalette.closed);

  static const AppStatusVisual orderPending = AppStatusVisual(
      label: 'Pendiente', icon: Icons.schedule_rounded,
      palette: StatusPalette.pending);

  static const AppStatusVisual orderConfirmed = AppStatusVisual(
      label: 'Confirmado', icon: Icons.check_circle_outline_rounded,
      palette: StatusPalette.progress);

  static const AppStatusVisual orderPreparing = AppStatusVisual(
      label: 'En preparación', icon: Icons.local_cafe_rounded,
      palette: StatusPalette.pending);

  static const AppStatusVisual orderReady = AppStatusVisual(
      label: 'Listo', icon: Icons.room_service_rounded,
      palette: StatusPalette.ready);

  static const AppStatusVisual orderDelivering = AppStatusVisual(
      label: 'En camino', icon: Icons.delivery_dining_rounded,
      palette: StatusPalette.progress);

  static const AppStatusVisual orderCompleted = AppStatusVisual(
      label: 'Completado', icon: Icons.done_all_rounded,
      palette: StatusPalette.closed);

  static const AppStatusVisual orderCancelled = AppStatusVisual(
      label: 'Cancelado', icon: Icons.cancel_rounded,
      palette: StatusPalette.cancelled);

  static const AppStatusVisual orderRefunded = AppStatusVisual(
      label: 'Reembolsado', icon: Icons.undo_rounded,
      palette: StatusPalette.cancelled);

  /// Fallback para un estado no catalogado: nunca se muestra un color solo.
  static const AppStatusVisual unknown = AppStatusVisual(
      label: 'Desconocido', icon: Icons.help_outline_rounded,
      palette: StatusPalette.neutral);
}

/// Colores concretos de un estado YA resueltos contra el tema activo.
///
/// Lo devuelve [statusColorsOf]; nadie lo construye a mano.
@immutable
class StatusColors {
  const StatusColors({
    required this.surface,
    required this.text,
    required this.dot,
  });

  /// Relleno del pill.
  final Color surface;

  /// Texto e ícono sobre [surface].
  final Color text;

  /// Punto sólido para tablas densas donde no cabe el ícono.
  final Color dot;
}
