// Tarjeta de la silla activa con temporizador en vivo, y el mapa del local.
// Módulo `features/chair/presentation/widgets`.
//
// Van aparte de la página porque la tarjeta se REUTILIZA: la home pinta una versión
// reducida de la misma información, y duplicarla haría que "mi silla" se viera
// distinto en dos pantallas (que es exactamente el tipo de bug que hace que alguien
// no sepa si su silla cambió).
//
// EL TEMPORIZADOR ES EL DEL RELOJ COMPARTIDO
// `RentalCountdown` se alimenta de `clockProvider`
// (`shared/widgets/rental_countdown.dart`), el mismo `Stream` de un segundo que
// usan el detalle del pedido y la home. Tres relojes independientes derivarían uno
// del otro y las cifras no coincidirían entre pantallas.
//
// ESTADOS: NUNCA "NO TIENES NINGUNA" EN VEZ DE UN ERROR
// La tarjeta vacía solo se pinta si la consulta TERMINÓ con éxito. Si falló, la
// pantalla muestra el error con reintento: decir "no tienes silla" cuando lo que
// falló fue la consulta sería una mentira que puede costar dinero.


import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../app/routes.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../core/customer/chair_map.dart';
import '../../../../core/utils/currency_formatter.dart';
import '../../../../core/utils/date_formatter.dart';
import '../../../../shared/widgets/rental_countdown.dart';
import '../../../../shared/widgets/ui/app_button.dart';
import '../../../../shared/widgets/ui/app_card.dart';
import '../../../../shared/widgets/ui/empty_state.dart';
import '../../../../shared/widgets/ui/price_display.dart';
import '../../../../shared/widgets/ui/status_badge.dart';
// `forChair` es una función TOP-LEVEL de `status_badge_resolver.dart`, no un
// método estático de `StatusBadge`, y `import ... show` en `status_badge.dart` no
// la reexporta: hay que importar el resolver.
import '../../../../shared/widgets/ui/status_badge_resolver.dart';
import '../../../orders/domain/entities/rental.dart';

/// Estado vacío: no hay alquiler activo. Con salida al checkout.
class NoActiveRentalNotice extends StatelessWidget {
  const NoActiveRentalNotice({super.key});

  @override
  Widget build(BuildContext context) {
    return EmptyState(
      icon: Icons.event_seat_outlined,
      title: 'No tienes ninguna silla ahora',
      message: 'Puedes elegir una del mapa y alquilarla por el tiempo que '
          'quieras, o consumir aquí y pagar al terminar.',
      actionLabel: 'Elegir una silla',
      onAction: () => context.push(AppRoutes.checkout),
    );
  }
}

/// Tarjeta de la silla activa, con temporizador en vivo.
class ActiveRentalCard extends StatelessWidget {
  const ActiveRentalCard({required this.rental, super.key});

  final Rental rental;

  @override
  Widget build(BuildContext context) {
    final DateTime? end = rental.endAt;
    final DateTime? start = rental.startAt;

    return AppCard(
      variant: AppCardVariant.elevated,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      'Tu silla',
                      style: AppTextStyles.labelMedium
                          .copyWith(color: context.tokens.textSecondary),
                    ),
                    const SizedBox(height: AppSpacing.xxs),
                    Text(
                      rental.chairCode ?? 'Silla reservada',
                      style: AppTextStyles.headlineSmall,
                    ),
                  ],
                ),
              ),
              StatusBadge.rental(rental.status),
            ],
          ),
          if (end != null) ...<Widget>[
            const SizedBox(height: AppSpacing.lg),
            RentalCountdown(endAt: end, large: true),
            const SizedBox(height: AppSpacing.xxs),
            Text(
              start == null
                  ? 'Termina a las ${DateFormatter.time(end)}'
                  : 'De ${DateFormatter.time(start)} a ${DateFormatter.time(end)}',
              style: AppTextStyles.captionMedium
                  .copyWith(color: context.tokens.textSecondary),
            ),
          ],
          if (rental.code != null) ...<Widget>[
            const SizedBox(height: AppSpacing.md),
            Text(
              'Alquiler ${rental.code}',
              style: AppTextStyles.captionSmall
                  .copyWith(color: context.tokens.textTertiary),
            ),
          ],
          const SizedBox(height: AppSpacing.lg),
          const Divider(height: 1),
          const SizedBox(height: AppSpacing.md),
          Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  rental.totalMinor > 0
                      ? 'Alquiler hasta ahora: '
                          '${CurrencyFormatter.formatMinor(rental.totalMinor)}'
                      : 'El importe se calcula al cerrar el alquiler.',
                  style: AppTextStyles.bodySmall
                      .copyWith(color: context.tokens.textSecondary),
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              AppButton(
                label: 'Ver pedido',
                variant: AppButtonVariant.ghost,
                size: AppButtonSize.small,
                onPressed: () => context.push(AppRoutes.orders),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Panel de detalle de la silla seleccionada (solo en desktop/wide).
/// En móvil el detalle se muestra dentro de la tarjeta del mapa.
class SelectedChairPanel extends StatelessWidget {
  const SelectedChairPanel({
    required this.map,
    required this.selectedId,
    super.key,
  });

  final ChairMap map;
  final int? selectedId;

  @override
  Widget build(BuildContext context) {
    final int? id = selectedId;
    if (id == null) {
      return const Padding(
        padding: EdgeInsets.all(AppSpacing.xl),
        child: EmptyState(
          icon: Icons.touch_app_outlined,
          title: 'Toca una silla del mapa',
          message: 'Te enseñamos su estado, su precio por hora y si está libre '
              'ahora mismo.',
          compact: true,
        ),
      );
    }
    final ChairInfo? chair = map.byId(id);
    if (chair == null) return const SizedBox.shrink();

    return ListView(
      padding: const EdgeInsets.all(AppSpacing.lg),
      children: <Widget>[
        StaticChairDetail(chair: chair),
        const SizedBox(height: AppSpacing.md),
        AppButton(
          label: 'Reservar esta silla',
          icon: Icons.event_seat_rounded,
          variant: AppButtonVariant.espresso,
          isFullWidth: true,
          // Una silla no reservable o no libre no ofrece un botón que va a fallar.
          onPressed: chair.isSelectable
              ? () => context.push(AppRoutes.checkout)
              : null,
        ),
      ],
    );
  }
}

/// Detalle estático de una silla, sin el estado del checkout.
class StaticChairDetail extends StatelessWidget {
  const StaticChairDetail({required this.chair, super.key});

  final ChairInfo chair;

  @override
  Widget build(BuildContext context) {
    // El catálogo de estados es el ÚNICO lugar que traduce `ChairStatus` a
    // color + ícono + texto. Esta pantalla no declara ningún mapa de estados.
    final AppStatusVisual visual = forChair(chair.status);
    final StatusColors stateColors = statusColorsOf(context, visual.palette);

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: Text(chair.cellLabel, style: AppTextStyles.titleLarge),
              ),
              StatusBadge.chair(chair.status),
            ],
          ),
          if (chair.zoneName != null) ...<Widget>[
            const SizedBox(height: AppSpacing.xxs),
            Text(
              chair.zoneName!,
              style: AppTextStyles.captionMedium
                  .copyWith(color: context.tokens.textSecondary),
            ),
          ],
          const SizedBox(height: AppSpacing.md),
          PriceDisplay(
            currentMinor: chair.pricePerHourMinor,
            variant: PriceVariant.costPerUnit,
            unitLabel: 'hora',
          ),
          const SizedBox(height: AppSpacing.md),
          Row(
            children: <Widget>[
              // Colores del estado resueltos contra el tema activo (el
              // catálogo guarda la clave, no tres `Color` del modo claro).
              Icon(visual.icon, size: 16, color: stateColors.text),
              const SizedBox(width: AppSpacing.xs),
              Text(
                visual.label,
                style: AppTextStyles.bodySmall.copyWith(color: stateColors.text),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
