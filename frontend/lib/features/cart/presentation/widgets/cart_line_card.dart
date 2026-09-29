// Tarjeta de una línea del carrito.
//
// QUÉ MUESTRA Y POR QUÉ
// - Thumbnail del producto: reconocer lo que se pidió de un vistazo vale más que
//   el nombre solo.
// - Variante, complementos y notas: son parte de la línea y afectan al precio.
// - Precio unitario con complementos + total de la línea: el usuario necesita ver
//   el desglose, no solo el total.
// - Stepper para cambiar la cantidad SIN salir de la lista: es la operación más
//   frecuente y no debería obligar a abrir un editor.
// - Eliminar con `ConfirmDialog`: es destructivo y `barrierDismissible: false`.
//
// BR-PRICE-008: estos importes son la previsualización del cliente. El total
// definitivo es el que devuelve `POST /orders`.


import 'package:flutter/material.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../core/customer/cart_state.dart';
import '../../../../shared/widgets/ui/app_card.dart';
import '../../../../shared/widgets/ui/confirm_dialog.dart';
import '../../../../shared/widgets/ui/price_display.dart';
import '../../../../shared/widgets/ui/quantity_stepper.dart';
import '../../../menu/presentation/widgets/product_image.dart';

/// Línea editable del carrito.
class CartLineCard extends StatelessWidget {
  const CartLineCard({
    required this.line,
    required this.onQuantityChanged,
    required this.onRemove,
    super.key,
  });

  final CartLine line;
  final ValueChanged<int> onQuantityChanged;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    final String name = line.variantName.isEmpty
        ? line.productName
        : '${line.productName} · ${line.variantName}';

    return Semantics(
      container: true,
      label: _summary(),
      child: AppCard(
        margin: EdgeInsets.zero,
        padding: const EdgeInsets.all(AppSpacing.md),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            SizedBox.square(
              dimension: 64,
              child: ProductImage(
                name: line.productName,
                url: line.productImageUrl,
                borderRadius: AppSpacing.sm,
              ),
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    name,
                    style: AppTextStyles.titleMedium,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  if (line.addons.isNotEmpty) ...<Widget>[
                    const SizedBox(height: AppSpacing.xxs),
                    Text(
                      _addonsLabel(),
                      style: AppTextStyles.captionMedium
                          .copyWith(color: context.tokens.textSecondary),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                  if (line.notes.isNotEmpty) ...<Widget>[
                    const SizedBox(height: AppSpacing.xxs),
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Icon(
                          Icons.sticky_note_2_outlined,
                          size: 14,
                          color: context.tokens.textTertiary,
                        ),
                        const SizedBox(width: AppSpacing.xs),
                        Expanded(
                          child: Text(
                            line.notes,
                            style: AppTextStyles.captionMedium
                                .copyWith(color: context.tokens.textTertiary),
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ],
                    ),
                  ],
                  const SizedBox(height: AppSpacing.sm),
                  QuantityStepper(
                    quantity: line.quantity,
                    semanticLabel: name,
                    onChanged: onQuantityChanged,
                  ),
                ],
              ),
            ),
            const SizedBox(width: AppSpacing.sm),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: <Widget>[
                Text(
                  line.quantity > 1 ? '${line.quantity} ×' : '',
                  style: AppTextStyles.captionSmall
                      .copyWith(color: context.tokens.textSecondary),
                ),
                PriceDisplay(currentMinor: line.lineTotalMinor),
                const SizedBox(height: AppSpacing.xxs),
                _RemoveButton(onRemove: onRemove, name: name),
              ],
            ),
          ],
        ),
      ),
    );
  }

  /// `2 × extra de avena`, `1 × shot extra`.
  String _addonsLabel() => line.addons
      .map(
        (CartAddonSelection addon) =>
            '${addon.quantity > 1 ? '${addon.quantity} × ' : ''}${addon.name}',
      )
      .join(' · ');

  /// Frase para el lector de pantalla: toda la información de la línea en una.
  String _summary() {
    // `List<String>`, no `String`: la lista de partes se une al final con
    // `join(', ')`. Declararla `String` no compila y `join` sobre `String` tampoco.
    final List<String> parts = <String>[
      line.productName,
      if (line.variantName.isNotEmpty) line.variantName,
      if (line.addons.isNotEmpty) _addonsLabel(),
      if (line.notes.isNotEmpty) 'nota: ${line.notes}',
      '${line.quantity} unidades',
    ];
    return parts.join(', ');
  }
}

/// Botón de eliminar. Icono con `tooltip` + `Semantics` (WCAG 4.1.2) y target de
/// 44 dp, y confirmación antes de destruir trabajo.
class _RemoveButton extends StatelessWidget {
  const _RemoveButton({required this.onRemove, required this.name});

  final VoidCallback onRemove;
  final String name;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: 'Quitar $name del carrito',
      excludeSemantics: true,
      child: Tooltip(
        message: 'Quitar del carrito',
        child: SizedBox.square(
          dimension: 44,
          child: IconButton(
            onPressed: () => _confirm(context),
            icon: const Icon(Icons.delete_outline_rounded, size: 20),
            color: context.tokens.actionDanger,
            tooltip: 'Quitar del carrito',
          ),
        ),
      ),
    );
  }

  Future<void> _confirm(BuildContext context) async {
    final DialogAction action = await ConfirmDialog.show(
      context,
      title: '¿Quitar $name?',
      message: 'Lo quitamos del pedido. Puedes volver a añadirlo desde el menú.',
      action: DialogAction.cancel,
      confirmLabel: 'Quitar',
      icon: Icons.delete_outline_rounded,
    );
    if (action == DialogAction.confirm) onRemove();
  }
}
