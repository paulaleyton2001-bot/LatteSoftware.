// Badge de estado: color + ícono + TEXTO. Nunca solo color.
//
// Este widget es la ÚNICA puerta de entrada al catálogo de estados de negocio
// (módulo `StatusBadge` = este archivo + `status_badge_visuals.dart` +
// `status_badge_resolver.dart`). Ninguna feature re-declara un mapa de
// estados: si falta un estado, se agrega al catálogo, no a la pantalla.
//
// Por qué texto + ícono + color (WCAG 1.4.1, 1.4.11):
//   - ~8% de los hombres tiene daltonismo rojo/verde: "ocupada" y "disponible"
//     son idénticos sin forma.
//   - En impresión B/N y con lector de pantalla solo sobrevive el texto.
//
// Uso típico:
// ```dart
// StatusBadge.chair('OCCUPIED');              // pill "Ocupada" + ícono asiento
// StatusBadge.order('PREPARING');             // pill "En preparación"
// StatusBadge.order('READY', compact: true);  // punto + texto (tablas densas)
// StatusBadge(visual: AppStatusVisualsOps.paymentApproved);
// ```

import 'package:flutter/material.dart';

import '../../../app/theme/app_radii.dart';
import '../../../app/theme/app_spacing.dart';
import '../../../app/theme/app_typography.dart';
import 'status_badge_resolver.dart';
import 'status_badge_visuals.dart';

export 'status_badge_visuals.dart' show AppStatusVisual, AppStatusVisuals;

/// Badge de estado reutilizable. Inmutable.
class StatusBadge extends StatelessWidget {
  /// Badge con visual explícito (el caller ya resolvió el estado).
  const StatusBadge({
    required this.visual,
    this.compact = false,
    super.key,
  })  : domain = _StatusDomain.none,
        status = '';

  /// Estado de silla (`ChairStatus` de la API, p. ej. `'OCCUPIED'`).
  const StatusBadge.chair(String value, {this.compact = false, super.key})
      : visual = null,
        domain = _StatusDomain.chair,
        status = value;

  /// Estado de pedido (`OrderStatus`).
  const StatusBadge.order(String value, {this.compact = false, super.key})
      : visual = null,
        domain = _StatusDomain.order,
        status = value;

  /// Estado de pago (`PaymentStatus`).
  const StatusBadge.payment(String value, {this.compact = false, super.key})
      : visual = null,
        domain = _StatusDomain.payment,
        status = value;

  /// Estado de reserva (`ReservationStatus`).
  const StatusBadge.reservation(String value, {this.compact = false, super.key})
      : visual = null,
        domain = _StatusDomain.reservation,
        status = value;

  /// Estado de alquiler (`RentalStatus`).
  const StatusBadge.rental(String value, {this.compact = false, super.key})
      : visual = null,
        domain = _StatusDomain.rental,
        status = value;

  /// Visual explícito.
  final AppStatusVisual? visual;

  /// Dominio del estado (determina el resolver).
  final _StatusDomain domain;

  /// Literal del enum del backend.
  final String status;

  /// `true` = punto de color + texto (tablas densas). `false` = ícono + texto.
  final bool compact;

  /// Visual final; nunca nulo (cae en `unknown`).
  AppStatusVisual get resolved => switch (domain) {
        _StatusDomain.chair => forChair(status),
        _StatusDomain.order => forOrder(status),
        _StatusDomain.payment => forPayment(status),
        _StatusDomain.reservation => forReservation(status),
        _StatusDomain.rental => forRental(status),
        _StatusDomain.none => visual ?? AppStatusVisuals.unknown,
      };

  @override
  Widget build(BuildContext context) {
    final state = resolved;
    return Semantics(
      label: 'Estado: ${state.label}',
      excludeSemantics: true,
      child: Container(
        padding: compact
            ? const EdgeInsets.symmetric(
                horizontal: AppSpacing.sm,
                vertical: AppSpacing.xxs,
              )
            : const EdgeInsets.symmetric(
                horizontal: AppSpacing.md,
                vertical: AppSpacing.xs,
              ),
        decoration: BoxDecoration(
          color: state.surface,
          borderRadius: BorderRadius.circular(AppRadii.pill),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            if (compact)
              _StatusDot(color: state.dot)
            else
              Icon(state.icon, size: 14, color: state.text),
            SizedBox(width: compact ? AppSpacing.xs : AppSpacing.sm),
            Text(
              state.label,
              style: AppTextStyles.labelMedium.copyWith(color: state.text),
            ),
          ],
        ),
      ),
    );
  }
}

/// Dominios soportados por los resolvers. Privado del módulo.
enum _StatusDomain { none, chair, order, payment, reservation, rental }

/// Punto de color de 8 dp. Siempre acompañado de texto.
class _StatusDot extends StatelessWidget {
  const _StatusDot({required this.color});

  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 8,
      height: 8,
      decoration: BoxDecoration(color: color, shape: BoxShape.circle),
    );
  }
}
