// Pantalla de Productos del panel.
//
// UNA TARJETA POR PRODUCTO, CON SUS TRES ACCIONES
// Disponibilidad comercial, existencia en el catálogo y baja. Son rutas distintas
// porque son cosas distintas (BR-PRICE-006), y ofrecerlas juntas como una sola
// "visibilidad" haría que un cajero apagara el producto entero por un agotado
// puntual.
//
// EL SKU ES DE SOLO LECTURA AL EDITAR
// En v1 es inmutable: mandarlo en un `PATCH` da `400`. El formulario lo muestra
// bloqueado con la explicación en vez de dejar que el usuario lo escriba para
// perder el cambio.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../app/breakpoints.dart';
import '../../../app/theme/app_spacing.dart';
import '../../../core/error/failures.dart';
import '../../../shared/constants/app_strings.dart';
import '../../../shared/widgets/ui/async_state_builder.dart';
import '../domain/entities/admin_products.dart';
import './admin_products_controller.dart';
import './widgets/admin_detail_row.dart';
import './widgets/admin_filter_sheets.dart';
import './widgets/admin_list_and_state.dart';
import './widgets/admin_product_card.dart';
import './widgets/admin_product_form_dialog.dart';
import './widgets/admin_table_scaffold.dart';

/// Catálogo de productos.
class AdminProductsPage extends ConsumerStatefulWidget {
  const AdminProductsPage({super.key});

  @override
  ConsumerState<AdminProductsPage> createState() => _AdminProductsPageState();
}

class _AdminProductsPageState extends ConsumerState<AdminProductsPage> {
  final TextEditingController _search = TextEditingController();

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<List<AdminProduct>> products =
        ref.watch(adminProductsProvider);
    final List<AdminProduct> visible = ref.watch(adminVisibleProductsProvider);
    final List<AdminCategory> categories =
        ref.watch(adminCategoriesProvider).valueOrNull ?? const <AdminCategory>[];
    final int? category = ref.watch(adminProductCategoryProvider);
    final bool showInactive = ref.watch(adminProductShowInactiveProvider);
    final double padding = context.breakpoint.screenPadding;

    return ListView(
      padding: EdgeInsets.fromLTRB(padding, AppSpacing.xl, padding, AppSpacing.xxl),
      children: <Widget>[
        AdminPageHeader(
          title: AppStrings.navProducts,
          subtitle: 'Productos, categorías, variantes y complementos',
          actions: <Widget>[
            AdminHeaderAction(
              icon: Icons.add_rounded,
              tooltip: 'Crear producto',
              onPressed: () => _createOrEdit(context, ref),
            ),
          ],
        ),
        AdminFilterBar(
          controller: _search,
          searchHint: 'Nombre, SKU o descripción…',
          onSearch: (String value) =>
              ref.read(adminProductSearchProvider.notifier).state = value,
          filters: <AdminFilterOption>[
            if (categories.isNotEmpty)
              AdminFilterOption(
                id: 'category',
                label: category == null
                    ? 'Categoría'
                    : _categoryName(categories, category),
                icon: Icons.folder_outlined,
                isActive: category != null,
                onTap: () => showAdminCategorySheet(context, ref, categories),
              ),
            AdminFilterOption(
              id: 'inactive',
              label: 'Ver dados de baja',
              icon: Icons.visibility_off_outlined,
              isActive: showInactive,
              onTap: () => ref
                  .read(adminProductShowInactiveProvider.notifier)
                  .state = !showInactive,
            ),
          ],
        ),
        AsyncStateBuilder<List<AdminProduct>>(
          value: products,
          loadingMessage: 'Cargando el catálogo…',
          onRetry: () async => ref.invalidate(adminProductsProvider),
          isEmpty: (List<AdminProduct> data) => data.isEmpty,
          emptyIcon: Icons.local_cafe_outlined,
          emptyTitle: AppStrings.adminEmptyProducts,
          emptyMessage: 'Publica un producto para que aparezca en el menú y en '
              'el mostrador.',
          builder: (BuildContext context, List<AdminProduct> data) {
            if (visible.isEmpty) {
              return const AdminEmptyTable(
                icon: Icons.filter_alt_off_rounded,
                title: 'Ningún producto coincide',
                message: 'Cambia la búsqueda, la categoría o el filtro de '
                    'dados de baja.',
              );
            }
            return LayoutBuilder(
              builder: (BuildContext context, BoxConstraints constraints) {
                final int columns =
                    (constraints.maxWidth / 340).floor().clamp(1, 3);
                return GridView.count(
                  crossAxisCount: columns,
                  // Rejilla DENTRO de la lista de la página: sin `shrinkWrap` no
                  // tiene altura y revienta con «unbounded height». El scroll es
                  // el de la página, no el de la rejilla.
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  padding: EdgeInsets.zero,
                  mainAxisSpacing: AppSpacing.md,
                  crossAxisSpacing: AppSpacing.md,
                  childAspectRatio: 1.15,
                  children: <Widget>[
                    for (final AdminProduct product in visible)
                      AdminProductCard(product: product),
                  ],
                );
              },
            );
          },
        ),
      ],
    );
  }

  static String _categoryName(List<AdminCategory> categories, int id) {
    for (final AdminCategory category in categories) {
      if (category.id == id) return category.name;
    }
    return 'Categoría';
  }

  /// Alta o edición de un producto.
  ///
  /// El diálogo es el mismo en los dos casos: lo que cambia es el cuerpo que se
  /// manda, y ese lo decide [AdminProductFormDialog] según reciba o no un
  /// producto (el `PATCH` no admite `sku` ni disponibilidad).
  Future<void> _createOrEdit(BuildContext context, WidgetRef ref,
      [AdminProduct? product]) async {
    final List<AdminCategory> categories =
        ref.read(adminCategoriesProvider).valueOrNull ?? const <AdminCategory>[];
    if (!context.mounted) return;

    final AdminProductDraft? draft = await AdminProductFormDialog.show(
      context,
      categories: categories,
      product: product,
    );
    if (draft == null || !context.mounted) return;

    ref.read(adminProductCreateProvider.notifier).acknowledge();
    final bool ok = product == null
        ? await ref.read(adminProductCreateProvider.notifier).create(draft.body)
        : await ref
            .read(adminProductProvider(product.id).notifier)
            .updateProduct(draft.body);
    if (!context.mounted) return;

    final Object? error = ok ? null : ref.read(product == null
        ? adminProductCreateProvider
        : adminProductProvider(product.id)).error;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(ok
            ? (product == null
                ? '${draft.name} creado.'
                : '${draft.name} actualizado.')
            : error is Failure
                ? error.message
                : 'No se pudo guardar el producto.'),
        behavior: SnackBarBehavior.floating,
      ),
    );
  }
}

