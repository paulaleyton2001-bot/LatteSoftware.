// Lista de líneas del pedido en curso. MÓDULO `pos/presentation/widgets`.
//
// Panel del pedido en curso: cabecera, líneas y pie.
//
// QUÉ HACE ESTE ARCHIVO
// Compone el panel y pinta el pie con el subtotal. Las LÍNEAS viven en
// `pos_line_row.dart` porque cada una lleva un stepper, dos acciones de ícono y dos
// diálogos: pegadas al panel, el archivo pasaba de 340 líneas y la parte
// interactiva quedaba enterrada bajo el `EmptyState`.
//
// CANTIDAD A CERO = BORRAR
// Es el comportamiento que espera cualquiera que use un stepper: bajar de 1 quita
// la línea. `CartStore.setQuantity` ya lo hace, y por eso el `min` del stepper es
// `0` y no `1`.
//
// EL STEPPER ES EL DEL DESIGN SYSTEM
// `QuantityStepper` ya trae los targets de 44 dp, los `tooltip` y el `Semantics`
// con la cantidad; reimplementarlo aquí sería una copia que se queda vieja.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../core/customer/cart_state.dart';
import '../../../../shared/widgets/ui/empty_state.dart';
import '../../../../shared/widgets/ui/price_display.dart';
import '../pos_cart_controller.dart';
import './pos_line_row.dart';

/// Panel del pedido en curso: cabecera, líneas y pie con el número de artículos.
class PosOrderPanel extends ConsumerWidget {
  const PosOrderPanel({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final List<CartLine> lines = ref.watch(posLinesProvider);
    final int subtotal = ref.watch(posSubtotalMinorProvider);
    final int minutes = ref.watch(posPreparationMinutesProvider);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        _OrderHeader(itemCount: lines.length, minutes: minutes),
        const Divider(height: 1),
        Expanded(
          child: lines.isEmpty
              ? const EmptyState(
                  icon: Icons.receipt_long_outlined,
                  title: 'Pedido vacío',
                  message: 'Toca un producto del catálogo o escribe su nombre '
                      'en el buscador para empezar.',
                  compact: true,
                )
              : ListView.separated(
                  padding: const EdgeInsets.all(AppSpacing.md),
                  itemCount: lines.length,
                  separatorBuilder: (BuildContext context, int index) =>
                      const SizedBox(height: AppSpacing.sm),
                  itemBuilder: (BuildContext context, int index) => PosLineRow(
                    line: lines[index],
                  ),
                ),
        ),
        const Divider(height: 1),
        _OrderFooter(subtotalMinor: subtotal),
      ],
    );
  }
}

/// Cabecera del panel: cuántos artículos y cuántos minutos de preparación.
class _OrderHeader extends StatelessWidget {
  const _OrderHeader({required this.itemCount, required this.minutes});

  final int itemCount;
  final int minutes;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.lg,
        AppSpacing.md,
        AppSpacing.md,
        AppSpacing.md,
      ),
      child: Row(
        children: <Widget>[
          Expanded(
            child: Semantics(
              header: true,
              child: Text('Pedido en curso', style: AppTextStyles.titleLarge),
            ),
          ),
          if (itemCount > 0 && minutes > 0)
            Tooltip(
              message: 'Suma de los minutos de preparación estimados',
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  Icon(Icons.schedule_rounded,
                      size: 16, color: context.tokens.textSecondary),
                  const SizedBox(width: AppSpacing.xxs),
                  Text(
                    '~$minutes min',
                    style: AppTextStyles.captionMedium
                        .copyWith(color: context.tokens.textSecondary),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

/// Pie del panel: subtotal PREVISUALIZADO y aviso de que el total es del
/// servidor (BR-PRICE-008).
class _OrderFooter extends StatelessWidget {
  const _OrderFooter({required this.subtotalMinor});

  final int subtotalMinor;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(AppSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  'Subtotal estimado',
                  style: AppTextStyles.bodyMedium
                      .copyWith(color: context.tokens.textSecondary),
                ),
              ),
              PriceDisplay(
                currentMinor: subtotalMinor,
                variant: PriceVariant.large,
                semanticLabel: 'Subtotal estimado antes de impuestos y descuentos',
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            'Con impuestos, descuentos y propina, el total lo pone el servidor '
            'al registrar el pedido.',
            style: AppTextStyles.captionSmall
                .copyWith(color: context.tokens.textTertiary),
          ),
        ],
      ),
    );
  }
}
