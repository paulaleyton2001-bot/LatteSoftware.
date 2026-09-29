// Línea del pedido en curso. MÓDULO `pos/presentation/widgets`.
//
// QUÉ PUEDE HACER EL CAJERO CON UNA LÍNEA, Y EN CUANTOS CLICS
//   - Cambiar cantidad: `QuantityStepper` (el widget del design system).
//   - Nota de preparación: diálogo, porque escribir en un `TextField` dentro de una
//     fila con steppers es un blanco difícil de acertar con el dedo.
//   - Borrar: un toque, con `ConfirmDialog`, por el riesgo real: si se borra sin
//     querer, el producto está en el pedido del servidor en cuanto se cobra.
//
// LOS NOMBRES Y LOS PRECIOS SON DEL CARRITO, NO DEL SERVIDOR
// La línea se pinta con el nombre y el precio que el cajero añadió. Los del
// servidor solo aparecen tras `POST /orders`, y entonces son snapshots de lo que se
// cobró (BR-PRICE-004). Mezclarlos mostraría un precio distinto del que se está a
// punto de cobrar.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/theme/app_radii.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../core/customer/cart_providers.dart';
import '../../../../core/customer/cart_state.dart';
import '../../../../shared/widgets/ui/app_text_field.dart';
import '../../../../shared/widgets/ui/confirm_dialog.dart';
import '../../../../shared/widgets/ui/price_display.dart';
import '../../../../shared/widgets/ui/quantity_stepper.dart';

/// Fila de una línea del pedido.
class PosLineRow extends ConsumerWidget {
  const PosLineRow({required this.line, super.key});

  final CartLine line;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final String semantic =
        '${line.productName}, ${line.quantity} unidades, ${line.notes.isEmpty ? 'sin notas' : 'nota: ${line.notes}'}';

    return Semantics(
      container: true,
      label: semantic,
      child: Container(
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
          color: context.tokens.surface,
          borderRadius: BorderRadius.circular(AppRadii.md),
          border: Border.all(color: context.tokens.borderSubtle),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Expanded(
                  child: Text(
                    line.variantName.isEmpty
                        ? line.productName
                        : '${line.productName} · ${line.variantName}',
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: AppTextStyles.titleSmall,
                  ),
                ),
                const SizedBox(width: AppSpacing.sm),
                PriceDisplay(currentMinor: line.lineTotalMinor),
              ],
            ),
            if (line.notes.isNotEmpty) ...<Widget>[
              const SizedBox(height: AppSpacing.xs),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Icon(Icons.sticky_note_2_outlined,
                      size: 14, color: context.tokens.textSecondary),
                  const SizedBox(width: AppSpacing.xxs),
                  Expanded(
                    child: Text(
                      line.notes,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: AppTextStyles.captionMedium
                          .copyWith(color: context.tokens.textSecondary),
                    ),
                  ),
                ],
              ),
            ],
            const SizedBox(height: AppSpacing.sm),
            Row(
              children: <Widget>[
                QuantityStepper(
                  quantity: line.quantity,
                  min: 0,
                  max: kCartMaxLineQuantity,
                  semanticLabel: line.productName,
                  onChanged: (int value) => ref
                      .read(cartStoreProvider)
                      .setQuantity(line.id, value),
                ),
                const Spacer(),
                // El widget es PÚBLICO (`PosLineIconAction`): lo usan también el
                // panel de pedido y el resumen, y un `_` lo volvería invisible.
                PosLineIconAction(
                  icon: Icons.note_add_outlined,
                  tooltip: 'Nota de preparación',
                  semanticLabel: 'Añadir nota de preparación a ${line.productName}',
                  onTap: () => _editNotes(context, ref),
                ),
                const SizedBox(width: AppSpacing.xs),
                PosLineIconAction(
                  icon: Icons.delete_outline_rounded,
                  tooltip: 'Quitar del pedido',
                  semanticLabel: 'Quitar ${line.productName} del pedido',
                  onTap: () => _remove(context, ref),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  /// Diálogo de nota de preparación (máx. 300 en la API).
  Future<void> _editNotes(BuildContext context, WidgetRef ref) async {
    final TextEditingController controller =
        TextEditingController(text: line.notes);
    final String? notes = await showDialog<String>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: const Text('Nota de preparación'),
        content: AppTextField(
          controller: controller,
          label: 'Instrucción para la barra',
          hint: 'Sin lactosa, con hielo aparte…',
          maxLines: 3,
          maxLength: 300,
          autofocus: true,
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(controller.text),
            child: const Text('Guardar'),
          ),
        ],
      ),
    );
    controller.dispose();
    // `context.mounted` y no `ref.mounted`: lo que puede desmontarse mientras se
    // abre el diálogo es el WIDGET, no el provider.
    if (notes == null || !context.mounted) return;
    ref.read(cartStoreProvider).replaceLine(line.copyWith(notes: notes.trim()));
  }

  /// Borrado con confirmación: quitar la última línea deja el pedido vacío y el
  /// cajero pierde lo que llevaba un minuto tecleando.
  Future<void> _remove(BuildContext context, WidgetRef ref) async {
    final DialogAction action = await ConfirmDialog.show(
      context,
      title: '¿Quitar ${line.productName}?',
      message: 'Se saca del pedido en curso. Todavía no se ha cobrado nada.',
      confirmLabel: 'Quitar',
      action: DialogAction.cancel,
      icon: Icons.delete_outline_rounded,
    );
    if (action != DialogAction.confirm || !context.mounted) return;
    ref.read(cartStoreProvider).removeLine(line.id);
  }
}

/// Botón de ícono de una línea. 44 dp y `tooltip` (WCAG 2.5.5 y 4.1.2).
class PosLineIconAction extends StatelessWidget {
  const PosLineIconAction({
    required this.icon,
    required this.tooltip,
    required this.semanticLabel,
    required this.onTap,
  });

  final IconData icon;
  final String tooltip;
  final String semanticLabel;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: semanticLabel,
      excludeSemantics: true,
      child: Tooltip(
        message: tooltip,
        child: Material(
          color: Colors.transparent,
          borderRadius: BorderRadius.circular(AppRadii.md),
          child: InkWell(
            onTap: onTap,
            borderRadius: BorderRadius.circular(AppRadii.md),
            child: SizedBox.square(
              dimension: 44,
              child: Icon(icon, size: 20, color: context.tokens.textSecondary),
            ),
          ),
        ),
      ),
    );
  }
}
