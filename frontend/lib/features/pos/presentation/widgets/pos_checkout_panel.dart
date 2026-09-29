// Panel de cobro del mostrador: totales, silla y botón grande de cobro.
//
// ESTE ES EL PANEL QUE HACE QUE EL POS SEA "RÁPIDO"
// El botón de cobrar ocupa 56 dp de alto y el ancho completo: es el control que
// el cajero tiene que acertar con dos dedos y sin mirar. Todo lo demás cabe
// alrededor.
//
// EL TOTAL QUE SE MUESTRA ES EL DEL SERVIDOR
// Al cobrar se llama primero a `POST /orders`, que devuelve `totalMinor` y
// `balanceMinor` REALES (con impuestos, descuentos y cupón). El subtotal que se
// ve mientras se arma el pedido es solo una previsualización (BR-PRICE-008), y
// se rotula como tal para que nadie lo confunda con lo que se va a cobrar.
//
// EL COBRO NO ES UNA PASARELA
// El botón abre un diálogo de pago MANUAL (efectivo con cambio, o tarjeta con la
// referencia que anota el cajero). No hay redirección, no hay iframe y no se
// guarda ningún dato de tarjeta.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../core/customer/cart_state.dart';
import '../../../../core/customer/chair_map.dart';
import '../../../../core/customer/venue_providers.dart';
import '../../../../core/error/failures.dart';
import '../../../../shared/constants/app_strings.dart';
import '../../../../shared/widgets/ui/app_button.dart';
import '../../../../shared/widgets/ui/price_display.dart';
import '../../domain/entities/pos_draft.dart';
import '../../domain/repositories/pos_repository_models.dart';
import '../pos_cart_controller.dart';
import '../pos_controller.dart';
import './pos_chair_picker.dart';
import './pos_order_type_selector.dart';
import './pos_shortcut_hints.dart';
import './pos_walkin_rental_dialog.dart';

/// Panel derecho del POS: selector de tipo, silla, totales y cobro.
class PosCheckoutPanel extends ConsumerWidget {
  const PosCheckoutPanel({
    required this.onCharge,
    required this.onNewOrder,
    this.showShortcutHints = true,
    super.key,
  });

  /// Abre el diálogo de cobro. `Enter` en desktop lo dispara.
  final VoidCallback onCharge;

  /// Vacia el pedido y el borrador (`F2`).
  final VoidCallback onNewOrder;

  /// `true` en desktop, donde hay sitio para la fila de atajos.
  final bool showShortcutHints;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final PosDraft draft = ref.watch(posDraftProvider);
    final List<CartLine> lines = ref.watch(posLinesProvider);
    final int subtotal = ref.watch(posSubtotalMinorProvider);
    final bool empty = lines.isEmpty;
    final bool blocked = draft.hasBlockingGap;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        const SizedBox(height: AppSpacing.md),
        const PosOrderTypeSelector(),
        const SizedBox(height: AppSpacing.md),
        if (draft.type.requiresChair)
          Expanded(child: _ChairSection(draft: draft))
        else
          const Expanded(child: SizedBox.shrink()),
        if (draft.type.requiresChair) ...<Widget>[
          const PosOrderTypeHint(),
          const SizedBox(height: AppSpacing.sm),
          if (draft.chairId != null) const _WalkInRentalAction(),
        ],
        _Totals(subtotalMinor: subtotal),
        const SizedBox(height: AppSpacing.md),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
          child: AppButton(
            label: empty ? 'Añade productos' : AppStrings.chargeButton,
            icon: empty ? Icons.shopping_basket_outlined : Icons.payments_rounded,
            variant: AppButtonVariant.espresso,
            size: AppButtonSize.large,
            isFullWidth: true,
            onPressed: (empty || blocked) ? null : onCharge,
            semanticLabel: empty
                ? 'No hay productos en el pedido'
                : '${AppStrings.chargeButton} el pedido en curso',
            tooltip: empty || blocked ? null : '${AppStrings.shortcutCharge}: cobrar',
          ),
        ),
        const SizedBox(height: AppSpacing.sm),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
          child: AppButton(
            label: 'Nuevo pedido',
            icon: Icons.add_rounded,
            variant: AppButtonVariant.secondary,
            size: AppButtonSize.medium,
            isFullWidth: true,
            onPressed: onNewOrder,
            tooltip: '${AppStrings.shortcutNewOrder}: empezar un pedido vacío',
          ),
        ),
        if (showShortcutHints) ...<Widget>[
          const SizedBox(height: AppSpacing.md),
          const PosShortcutHintRow(),
        ],
        const SizedBox(height: AppSpacing.md),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
          child: Text(
            AppStrings.posNoGateway,
            textAlign: TextAlign.center,
            style: AppTextStyles.captionSmall
                .copyWith(color: context.tokens.textTertiary),
          ),
        ),
        const SizedBox(height: AppSpacing.md),
      ],
    );
  }
}

/// Acción de alquiler walk-in, visible cuando ya hay silla elegida.
///
/// `type = CHAIR_RENTAL` exige `reservationId`, así que sin reserva el backend
/// rechaza el pedido. Este botón abre la vía que SÍ existe para un cliente sin
/// reserva: `POST /rentals`, que materializa el pedido con el total ya calculado.
///
/// No sustituye al cobro: el alquiler se paga al cerrarlo, no al abrirlo, así que
/// este botón lleva a un diálogo de DURACIÓN y no al de pago.
class _WalkInRentalAction extends ConsumerWidget {
  const _WalkInRentalAction();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final int? chairId = ref.watch(posDraftProvider).chairId;
    final AsyncValue<PosOrderResult?> walkIn = ref.watch(posWalkInProvider);
    if (chairId == null) return const SizedBox.shrink();

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
      child: AppButton(
        label: 'Abrir alquiler sin reserva',
        icon: Icons.meeting_room_rounded,
        variant: AppButtonVariant.secondary,
        size: AppButtonSize.small,
        isFullWidth: true,
        isLoading: walkIn.isLoading,
        onPressed: walkIn.isLoading
            ? null
            : () => _open(context, ref, chairId),
        tooltip: 'Abre el alquiler y crea su pedido pendiente de cobro',
      ),
    );
  }

  Future<void> _open(BuildContext context, WidgetRef ref, int chairId) async {
    final AsyncValue<ChairMap> map = ref.read(venueMapProvider);
    final ChairInfo? chair = map.valueOrNull?.byId(chairId);
    if (chair == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('No se encontró la silla. Recarga el plano.'),
          behavior: SnackBarBehavior.floating,
        ),
      );
      return;
    }
    final int? minutes = await PosWalkInRentalDialog.show(context, chair);
    if (minutes == null || !context.mounted) return;
    final PosOrderResult? order = await ref
        .read(posWalkInProvider.notifier)
        .open(chairId: chairId, plannedMinutes: minutes);
    if (!context.mounted) return;
    if (order == null) {
      final Object? error = ref.read(posWalkInProvider).error;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(error is Failure ? error.message : 'No se pudo abrir el alquiler'),
          behavior: SnackBarBehavior.floating,
        ),
      );
      ref.read(posWalkInProvider.notifier).acknowledge();
    }
  }
}

/// Bloque de selección de silla, visible solo en `CHAIR_RENTAL`.
class _ChairSection extends ConsumerWidget {
  const _ChairSection({required this.draft});

  final PosDraft draft;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
          child: PosChairSummary(
            onClear: () => ref.read(posDraftProvider.notifier).clearChair(),
          ),
        ),
        // `Expanded` en lugar de altura fija: la rejilla de sillas decide cuántas
        // caben en el hueco que sobra, sin inventar medidas que no encajan con el
        // número de zonas que tenga el local.
        const Expanded(
          child: Padding(
            padding: EdgeInsets.only(top: AppSpacing.sm),
            child: PosChairPicker(),
          ),
        ),
      ],
    );
  }
}

/// Totales del pedido en curso.
///
/// El subtotal es una ESTIMACIÓN y se rotula así. El total real aparece después
/// de `POST /orders`, en el resumen que se muestra tras cobrar.
class _Totals extends StatelessWidget {
  const _Totals({required this.subtotalMinor});

  final int subtotalMinor;

  @override
  Widget build(BuildContext context) {
    if (subtotalMinor <= 0) {
      // Sin `const`: `TextStyle.copyWith` es una llamada a método y no puede ir
      // en una expresión constante. El `const` va en lo que sí lo es.
      return Padding(
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
        child: Text(
          'El total aparece al cobrar',
          style: AppTextStyles.bodySmall
              .copyWith(color: context.tokens.textSecondary),
        ),
      );
    }
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
      child: Row(
        children: <Widget>[
          Expanded(
            child: Text(
              'Subtotal estimado',
              style: AppTextStyles.bodyMedium
                  .copyWith(color: context.tokens.textSecondary),
            ),
          ),
          PriceDisplay(currentMinor: subtotalMinor, variant: PriceVariant.large),
        ],
      ),
    );
  }
}
