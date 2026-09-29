// Tarjeta de alquiler en curso. MÓDULO `features/admin/presentation/widgets`.
//
// EL TEMPORIZADOR
// Muestra lo que el servidor ya calculó (`remainingMinutes` o `overtimeMinutes`) y
// se refresca cada segundo SOLO para el texto, no recalculando nada. Al pasar el
// último minuto, el reloj queda en rojo y con icono de overtime: el excess se
// cobra al precio CONGELADO de la silla (BR-RENTAL-003), así que avisar en el
// momento exacto es información de dinero.
//
// UN `Timer` POR TARJETA, LIBERADO EN `dispose`
// Un `Timer.periodic` sin liberar sigue corriendo tras salir de la pantalla. Aquí
// se crea en `initState` y se cancela en `dispose`: sin eso, la app zoume la
// memoria cada vez que se abre y se cierra la pantalla de alquileres.
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/theme/app_radii.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../core/utils/date_formatter.dart';
import '../../../../shared/widgets/ui/app_button.dart';
import '../../../../shared/widgets/ui/app_card.dart';
import '../../../../shared/widgets/ui/price_display.dart';
import '../../../../shared/widgets/ui/status_badge.dart';
import '../../domain/entities/admin_rentals.dart';
import '../admin_rental_controller.dart';

/// Tarjeta de un alquiler activo.
class AdminRentalCard extends ConsumerStatefulWidget {
  const AdminRentalCard({required this.rental, super.key});

  final AdminRental rental;

  @override
  ConsumerState<AdminRentalCard> createState() => _AdminRentalCardState();
}

class _AdminRentalCardState extends ConsumerState<AdminRentalCard> {
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    // Un segundo es suficiente: el texto cambia de minuto a minuto, y un tick más
    // rápido solo gastaría batería.
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted) return;
      setState(() {});
    });
  }

  @override
  void dispose() {
    // Sin este `cancel`, el timer sobrevive a la pantalla.
    _timer?.cancel();
    _timer = null;
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final AdminRental rental = widget.rental;
    final AsyncValue<void> busy = ref.watch(adminRentalProvider(rental.id));
    final bool overtime = rental.isOvertime;

    return AppCard(
      padding: const EdgeInsets.all(AppSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  rental.chairCode ?? rental.code,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppTextStyles.titleMedium,
                ),
              ),
              StatusBadge.rental(rental.status, compact: true),
            ],
          ),
          const SizedBox(height: AppSpacing.xs),
          if (rental.customerName != null)
            Text(
              rental.customerName!,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppTextStyles.bodySmall
                  .copyWith(color: context.tokens.textSecondary),
            ),
          const SizedBox(height: AppSpacing.md),
          _TimerPanel(rental: rental, overtime: overtime),
          const SizedBox(height: AppSpacing.md),
          Row(
            children: <Widget>[
              PriceDisplay(
                currentMinor: rental.subtotalMinor + rental.extensionsMinor,
                unitLabel: 'acumulado',
              ),
              const Spacer(),
              if (rental.endAt != null)
                Text(
                  'Termina ${DateFormatter.time(rental.endAt!)}',
                  style: AppTextStyles.captionSmall
                      .copyWith(color: context.tokens.textTertiary),
                ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          Row(
            children: <Widget>[
              Expanded(
                child: AppButton(
                  label: 'Extender 30 min',
                  icon: Icons.more_time_rounded,
                  variant: AppButtonVariant.secondary,
                  size: AppButtonSize.small,
                  isFullWidth: true,
                  isLoading: busy.isLoading,
                  onPressed: busy.isLoading
                      ? null
                      : () => ref
                          .read(adminRentalProvider(rental.id).notifier)
                          .extend(30),
                  tooltip: 'Suma 30 minutos y los cobra al pedido abierto',
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              AppButton(
                label: 'Cerrar',
                icon: Icons.stop_circle_outlined,
                variant: AppButtonVariant.primary,
                size: AppButtonSize.small,
                isLoading: busy.isLoading,
                onPressed: busy.isLoading
                    ? null
                    : () => ref
                        .read(adminRentalProvider(rental.id).notifier)
                        .complete(),
                tooltip: 'Cierra el alquiler y calcula el cobro',
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Panel del reloj: tiempo restante o exceso.
class _TimerPanel extends StatelessWidget {
  const _TimerPanel({required this.rental, required this.overtime});

  final AdminRental rental;
  final bool overtime;

  @override
  Widget build(BuildContext context) {
    // Cifras TABULARES: sin eso los dígitos "bailan" en cada tick (tokens §2.4.1).
    final String clock = overtime
        ? DateFormatter.countdown(
            Duration(minutes: (rental.overtimeMinutes ?? 0)),
          )
        : DateFormatter.countdown(
            Duration(minutes: rental.remainingMinutes ?? rental.plannedMinutes),
          );
    final Color color = overtime ? context.tokens.textError : context.tokens.textPrimary;

    return Semantics(
      liveRegion: true,
      label: overtime
          ? 'Excedido $clock'
          : 'Quedan $clock de alquiler',
      excludeSemantics: true,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
          color: overtime
              ? context.tokens.surfaceErrorSubtle
              : context.tokens.surfaceMuted,
          borderRadius: BorderRadius.circular(AppRadii.md),
        ),
        child: Column(
          children: <Widget>[
            Text(
              overtime ? 'Excedido' : 'Quedan',
              style: AppTextStyles.captionMedium.copyWith(color: color),
            ),
            Text(
              clock,
              style: AppTextStyles.timerLarge.copyWith(color: color),
            ),
            if (overtime)
              Text(
                'Se cobra al precio congelado de la silla',
                style: AppTextStyles.captionSmall
                    .copyWith(color: context.tokens.textError),
              ),
          ],
        ),
      ),
    );
  }
}
