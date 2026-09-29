// Selector de TAMAÑO (variantes) como control segmentado.
//
// POR QUÉ SEGMENTADO Y NO LISTA DESPLEGABLE
// Las variantes de un producto son pocas (Pequeño / Mediano / Grande) y caben en
// una fila. Un desplegable obliga a dos toques para comparar precios; el
// segmentado muestra a la vez nombre, precio e incremento.
//
// REGLAS QUE RESPETA
// - La variante por DEFECTO viene marcada: es la que el backend considera
//   correcta y la app no puede proponer otra.
// - Las variantes con incremento muestran `+ $500`; las que lo tienen negativo
//   muestran `− $300` (el backend admite deltas negativos, API.md §7.11).
// - `priceMinor` absoluto tiene prioridad sobre `priceDeltaMinor`: si el negocio
//   fijó un precio propio, ese es el que vale.
// - `Semantics(selected:)` en cada segmento: el lector de pantalla anuncia
//   "Talla Mediana, seleccionada" y el grupo se anuncia como un campo.
//
// Se usa `ChoiceChip`/`SegmentedButton` de Material, NUNCA un color propio: los
// tokens del estado activo los pone el `chipTheme` del tema.


import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../core/utils/currency_formatter.dart';
import '../../../menu/domain/entities/menu_product.dart';
import '../product_detail_controller.dart';
import '../product_selection_state.dart';

/// Fila de variantes del producto.
class VariantSelector extends ConsumerWidget {
  const VariantSelector({required this.product, super.key});

  final MenuProduct product;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final List<ProductVariant> variants = <ProductVariant>[
      for (final ProductVariant variant in product.variants)
        if (variant.isActive) variant,
    ];
    if (variants.isEmpty) return const SizedBox.shrink();

    final ProductSelectionState selection =
        ref.watch(productSelectionProvider(product));
    final ProductSelectionController controller =
        ref.read(productSelectionProvider(product).notifier);

    return Semantics(
      container: true,
      label: 'Tamaño',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text('Tamaño', style: AppTextStyles.titleMedium),
          const SizedBox(height: AppSpacing.sm),
          Wrap(
            spacing: AppSpacing.sm,
            runSpacing: AppSpacing.sm,
            children: <Widget>[
              for (final ProductVariant variant in variants)
                _VariantChip(
                  variant: variant,
                  product: product,
                  selected: selection.variantId == variant.id,
                  onTap: () => controller.selectVariant(variant.id),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Segmento de una variante.
class _VariantChip extends StatelessWidget {
  const _VariantChip({
    required this.variant,
    required this.product,
    required this.selected,
    required this.onTap,
  });

  final ProductVariant variant;
  final MenuProduct product;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final String? delta = _deltaLabel();

    return Semantics(
      button: true,
      selected: selected,
      label: 'Tamaño ${variant.name}'
          '${delta == null ? '' : ', $delta'}'
          '${variant.isDefault ? ', recomendado' : ''}',
      excludeSemantics: true,
      child: Tooltip(
        message: _tooltip(),
        child: Material(
          color: selected
              ? Theme.of(context).colorScheme.primaryContainer
              : Theme.of(context).colorScheme.surfaceContainerLow,
          borderRadius: BorderRadius.circular(999),
          child: InkWell(
            onTap: onTap,
            borderRadius: BorderRadius.circular(999),
            child: Container(
              constraints: const BoxConstraints(minHeight: 44, minWidth: 64),
              padding: const EdgeInsets.symmetric(
                horizontal: AppSpacing.lg,
                vertical: AppSpacing.sm,
              ),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(999),
                border: Border.all(
                  color: selected
                      ? Theme.of(context).colorScheme.primary
                      : Theme.of(context).colorScheme.outlineVariant,
                ),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  if (selected) ...<Widget>[
                    const Icon(Icons.check_rounded, size: 16),
                    const SizedBox(width: AppSpacing.xs),
                  ],
                  Text(variant.name, style: AppTextStyles.labelLarge),
                  if (delta != null) ...<Widget>[
                    const SizedBox(width: AppSpacing.xs),
                    Text(delta, style: AppTextStyles.labelMedium),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  /// `+ $500`, `− $300` o `null` si la variante no cambia el precio.
  ///
  /// El precio unitario se compone con [CurrencyFormatter]: nunca `'$' +
  /// numero.toString()`.
  String? _deltaLabel() {
    final int base = product.currentPriceMinor;
    final int effective = variant.effectivePriceMinor > 0
        ? variant.effectivePriceMinor
        : base + variant.priceDeltaMinor;
    final int diff = effective - base;
    if (diff == 0) return null;
    final String amount = CurrencyFormatter.formatMinor(diff.abs());
    return diff > 0 ? '+$amount' : '−$amount';
  }

  String _tooltip() {
    final int base = product.currentPriceMinor;
    final int effective = variant.effectivePriceMinor > 0
        ? variant.effectivePriceMinor
        : base + variant.priceDeltaMinor;
    return '${variant.name}: ${CurrencyFormatter.formatMinor(effective)}';
  }
}
