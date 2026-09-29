// Lista de EXTRAS (complementos) del producto.
//
// RESPETA LAS REGLAS DEL DOMINIO
// - `isMultiple: false` → casilla simple (0 o 1). Es el caso habitual.
// - `isMultiple: true`  → stepper de unidades, tope `maxSelect` (y nunca por
//   encima de `kAddonHardMax`, que es el límite de la API para
//   `order_item_addons.quantity`).
// - Cuando se alcanza el tope, el botón de "añadir" se DESABILITA con una
//   explicación, en vez de dejar pulsar y recibir un `422 ADDON_SELECTION_LIMIT`.
//
// ACCESIBILIDAD
// - El `Checkbox` del design system usa borde `borderStrong` (3:1, WCAG 1.4.11)
//   porque aquí el control se identifica por su propio estado, no por una etiqueta
//   flotante.
// - `Semantics(toggled:)` en la casilla y `Semantics(value:)` en el stepper, para
//   que "marcado" y "2 unidades" se anuncien y no se lean como un número suelto.


import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../core/utils/currency_formatter.dart';
import '../../../../shared/widgets/ui/quantity_stepper.dart';
import '../../../menu/domain/entities/menu_product.dart';
import '../product_detail_controller.dart';
import '../product_selection_state.dart';

/// Lista de complementos del producto.
class AddonSelector extends ConsumerWidget {
  const AddonSelector({required this.product, super.key});

  final MenuProduct product;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final List<ProductAddon> addons = product.activeAddons;
    if (addons.isEmpty) return const SizedBox.shrink();

    final ProductSelectionState selection =
        ref.watch(productSelectionProvider(product));
    final ProductSelectionController controller =
        ref.read(productSelectionProvider(product).notifier);

    return Semantics(
      container: true,
      label: 'Extras y complementos',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text('Extras', style: AppTextStyles.titleMedium),
          const SizedBox(height: AppSpacing.xxs),
          Text(
            'Opcionales. Se suman al total.',
            style: AppTextStyles.captionMedium
                .copyWith(color: context.tokens.textSecondary),
          ),
          const SizedBox(height: AppSpacing.sm),
          for (final ProductAddon addon in addons)
            Padding(
              padding: const EdgeInsets.only(bottom: AppSpacing.xs),
              child: addon.isMultiple
                  ? _MultipleAddonRow(
                      addon: addon,
                      quantity: selection.addons[addon.id] ?? 0,
                      onChanged: (int value) =>
                          controller.setAddonQuantity(addon, value),
                    )
                  : _SimpleAddonRow(
                      addon: addon,
                      selected: (selection.addons[addon.id] ?? 0) > 0,
                      onChanged: () => controller.toggleAddon(addon),
                    ),
            ),
        ],
      ),
    );
  }
}

/// Fila de un complemento simple (casilla).
class _SimpleAddonRow extends StatelessWidget {
  const _SimpleAddonRow({
    required this.addon,
    required this.selected,
    required this.onChanged,
  });

  final ProductAddon addon;
  final bool selected;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      toggled: selected,
      label: addon.name,
      value: selected ? 'Añadido' : 'No añadido',
      excludeSemantics: true,
      child: Material(
        color: selected
            ? Theme.of(context).colorScheme.primaryContainer
            : Theme.of(context).colorScheme.surface,
        borderRadius: BorderRadius.circular(12),
        child: InkWell(
          onTap: onChanged,
          borderRadius: BorderRadius.circular(12),
          child: Container(
            constraints: const BoxConstraints(minHeight: 48),
            padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.md,
              vertical: AppSpacing.sm,
            ),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(12),
              border: Border.all(
                color: selected
                    ? Theme.of(context).colorScheme.primary
                    : context.tokens.borderDefault,
              ),
            ),
            child: Row(
              children: <Widget>[
                SizedBox.square(
                  dimension: 24,
                  child: Checkbox(
                    value: selected,
                    onChanged: (bool? _) => onChanged(),
                  ),
                ),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  child: Text(addon.name, style: AppTextStyles.bodyLarge),
                ),
                const SizedBox(width: AppSpacing.sm),
                Text(
                  _price(addon.priceMinor),
                  style: AppTextStyles.price
                      .copyWith(color: context.tokens.textSecondary),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  /// `Incluido` si vale 0, o el precio formateado.
  static String _price(int minor) => minor <= 0
      ? 'Incluido'
      : '+${CurrencyFormatter.formatMinor(minor)}';
}

/// Fila de un complemento múltiple (stepper con tope).
class _MultipleAddonRow extends StatelessWidget {
  const _MultipleAddonRow({
    required this.addon,
    required this.quantity,
    required this.onChanged,
  });

  final ProductAddon addon;
  final int quantity;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    final int limit = addon.selectableMax;
    final bool atLimit = quantity >= limit;

    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.md,
        vertical: AppSpacing.sm,
      ),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: quantity > 0
              ? Theme.of(context).colorScheme.primary
              : context.tokens.borderDefault,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(addon.name, style: AppTextStyles.bodyLarge),
                    Text(
                      '${CurrencyFormatter.formatMinor(addon.priceMinor)} c/u'
                      '${addon.maxSelect == null ? '' : ' · máx. $limit'}',
                      style: AppTextStyles.captionMedium
                          .copyWith(color: context.tokens.textSecondary),
                    ),
                  ],
                ),
              ),
              QuantityStepper(
                quantity: quantity,
                min: 0,
                max: limit,
                semanticLabel: addon.name,
                onChanged: onChanged,
              ),
            ],
          ),
          if (atLimit)
            Padding(
              padding: const EdgeInsets.only(top: AppSpacing.xs),
              child: Text(
                'Llegaste al máximo de $limit unidades de este extra.',
                style: AppTextStyles.captionSmall
                    .copyWith(color: context.tokens.textWarning),
              ),
            ),
        ],
      ),
    );
  }
}
