// Tarjeta de producto en el catálogo. MÓDULO `features/admin/presentation/widgets`.
//
// TRES ESTADOS DISTINTOS, TRES SEÑALES
//   - `isAvailable` → agotado o fuera de temporada. Se PUEDE reactivar.
//   - `isActive`    → dado de baja: fuera del catálogo. También se puede reactivar.
//   - precio        → con promoción o sin ella.
//
// Son conceptos distintos y por eso tienen acciones distintas
// (BR-PRICE-006). Un solo interruptor de "visible" los confundiría, y equivocarse
// significa dejar de vender algo o no poder venderlo.
//
// LA FOTO ES UN CAMPO URL, NO UN UPLOAD
// `POST /products` acepta `imageUrl` como texto. Este producto no sube archivos:
// se pega la URL. Es lo que el contrato define y añadir una subida sería inventar
// un endpoint.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../core/error/failures.dart';
import '../../../../shared/widgets/ui/app_button.dart';
import '../../../../shared/widgets/ui/app_card.dart';
import '../../../../shared/widgets/ui/empty_placeholder_image.dart';
import '../../../../shared/widgets/ui/price_display.dart';
import '../../domain/entities/admin_products.dart';
import '../admin_products_controller.dart';
import './admin_product_form_dialog.dart';

/// Tarjeta de producto con sus acciones.
class AdminProductCard extends ConsumerWidget {
  const AdminProductCard({required this.product, super.key});

  final AdminProduct product;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<void> busy = ref.watch(adminProductProvider(product.id));
    final bool enabled = !busy.isLoading;

    return AppCard(
      padding: EdgeInsets.zero,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          SizedBox(
            height: 96,
            child: product.imageUrl == null
                ? EmptyPlaceholderImage(name: product.name)
                : Image.network(
                    product.imageUrl!,
                    fit: BoxFit.cover,
                    // Sin foto manejable: placeholder, que además reserva el mismo
                    // alto (no hay salto de layout al cargar).
                    errorBuilder: (BuildContext context, Object error,
                            StackTrace? stack) =>
                        EmptyPlaceholderImage(name: product.name),
                  ),
          ),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.all(AppSpacing.md),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    product.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppTextStyles.titleSmall,
                  ),
                  Text(
                    product.sku,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppTextStyles.captionSmall
                        .copyWith(color: context.tokens.textTertiary),
                  ),
                  const SizedBox(height: AppSpacing.xs),
                  Row(
                    children: <Widget>[
                      if (product.hasPromo)
                        PriceDisplay(
                          currentMinor: product.promoPriceMinor!,
                          originalMinor: product.basePriceMinor,
                        )
                      else
                        PriceDisplay(currentMinor: product.basePriceMinor),
                      const Spacer(),
                      if (product.trackStock && product.stock != null)
                        Text(
                          'Stock ${_stock(product.stock!)}',
                          style: AppTextStyles.captionSmall.copyWith(
                            color: product.stock! <= 0
                                ? context.tokens.textError
                                : context.tokens.textTertiary,
                          ),
                        ),
                    ],
                  ),
                  const Spacer(),
                  _Flags(product: product),
                  const SizedBox(height: AppSpacing.sm),
                  Row(
                    children: <Widget>[
                      Expanded(
                        child: AppButton(
                          label: product.isAvailable
                              ? 'Marcar agotado'
                              : 'Marcar disponible',
                          icon: product.isAvailable
                              ? Icons.remove_circle_outline_rounded
                              : Icons.check_circle_outline_rounded,
                          variant: AppButtonVariant.secondary,
                          size: AppButtonSize.small,
                          isFullWidth: true,
                          isLoading: busy.isLoading,
                          onPressed: enabled
                              ? () => ref
                                  .read(adminProductProvider(product.id).notifier)
                                  .setAvailability(!product.isAvailable)
                              : null,
                        ),
                      ),
                      const SizedBox(width: AppSpacing.sm),
                      AppButton(
                        label: 'Editar',
                        size: AppButtonSize.small,
                        isLoading: busy.isLoading,
                        onPressed: enabled
                            ? () => showAdminProductEditor(context, ref, product)
                            : null,
                        tooltip: 'Editar ${product.name}',
                      ),
                      const SizedBox(width: AppSpacing.sm),
                      AppButton(
                        label: product.isActive ? 'Dar de baja' : 'Reactivar',
                        icon: product.isActive
                            ? Icons.archive_outlined
                            : Icons.unarchive_outlined,
                        variant: product.isActive
                            ? AppButtonVariant.secondary
                            : AppButtonVariant.primary,
                        size: AppButtonSize.small,
                        isLoading: busy.isLoading,
                        onPressed: enabled
                            ? () => ref
                                .read(adminProductProvider(product.id).notifier)
                                .setActive(!product.isActive)
                            : null,
                        tooltip: product.isActive
                            ? 'Lo saca del catálogo (se puede reactivar)'
                            : 'Lo devuelve al catálogo',
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// Cantidad de stock legible: entera sin decimales, fraccional con uno.
  static String _stock(double value) => value == value.roundToDouble()
      ? value.toInt().toString()
      : value.toStringAsFixed(1);
}

/// Distintivos de disponibilidad y catálogo. Ícono + palabra, no solo color.
class _Flags extends StatelessWidget {
  const _Flags({required this.product});

  final AdminProduct product;

  @override
  Widget build(BuildContext context) {
    if (product.isActive && product.isAvailable) {
      return Row(
        children: <Widget>[
          Icon(Icons.check_circle_rounded,
              size: 16, color: context.tokens.textSuccess),
          const SizedBox(width: AppSpacing.xs),
          Text(
            'En catálogo y disponible',
            style: AppTextStyles.captionSmall
                .copyWith(color: context.tokens.textSuccess),
          ),
        ],
      );
    }
    if (!product.isActive) {
      return Row(
        children: <Widget>[
           Icon(Icons.archive_rounded, size: 16, color: context.tokens.textError),
          const SizedBox(width: AppSpacing.xs),
          Text(
            'Dado de baja',
            style:
                AppTextStyles.captionSmall.copyWith(color: context.tokens.textError),
          ),
        ],
      );
    }
    return Row(
      children: <Widget>[
        Icon(Icons.remove_circle_outline_rounded,
            size: 16, color: context.tokens.textWarning),
        const SizedBox(width: AppSpacing.xs),
        Text(
          'Agotado',
          style: AppTextStyles.captionSmall
              .copyWith(color: context.tokens.textWarning),
        ),
      ],
    );
  }
}

/// Abre el formulario de [product] y encadena el `PATCH`.
///
/// Vive en la tarjeta porque es la tarjeta la que sabe QUÉ producto se edita; la
/// página solo tiene la lista y tendría que recibir un callback por cada acción.
Future<void> showAdminProductEditor(
  BuildContext context,
  WidgetRef ref,
  AdminProduct product,
) async {
  final List<AdminCategory> categories =
      ref.read(adminCategoriesProvider).valueOrNull ?? const <AdminCategory>[];
  if (!context.mounted) return;

  final AdminProductDraft? draft = await AdminProductFormDialog.show(
    context,
    categories: categories,
    product: product,
  );
  if (draft == null || !context.mounted) return;

  final bool ok = await ref
      .read(adminProductProvider(product.id).notifier)
      .updateProduct(draft.body);
  if (!context.mounted) return;

  final Object? error =
      ok ? null : ref.read(adminProductProvider(product.id)).error;
  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(
      content: Text(ok
          ? '${draft.name} actualizado.'
          : error is Failure
              ? error.message
              : 'No se pudo guardar el producto.'),
      behavior: SnackBarBehavior.floating,
    ),
  );
}
