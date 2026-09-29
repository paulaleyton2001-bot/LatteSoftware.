// Ficha de producto.
//
// PÁGINA COMPLETA (fuera del shell del cliente), sin barra de navegación
// inferior: en móvil, la ficha es una tarea concentrada y la barra de pestañas
// solo competiría por el espacio y por el pulgar (docs/DESIGN-TOKENS.md §5).
//
// ESTADOS
//   carga / sin red / error → `AsyncStateBuilder` con reintento
//   éxito                   → la ficha
//   producto no disponible  → se muestra igual, con el CTA apagado y el aviso
//
// LAYOUT ADAPTATIVO
//   mobile / tablet → una columna con el pie fijo abajo
//   desktop / wide  → dos columnas (ficha | precio y extras), con el pie dentro
//                     de la columna derecha. Es el layout de la referencia: en
//                     escritorio el total no debe estar en un pie de pantalla
//                     mientras el contenido está a 800 px.


import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../app/breakpoints.dart';
import '../../../app/routes.dart';
import '../../../app/theme/app_spacing.dart';
import '../../../shared/widgets/ui/async_state_builder.dart';
import '../../menu/domain/entities/menu_product.dart';
import './product_detail_controller.dart';
import './widgets/product_detail_footer.dart';
import './widgets/product_sections.dart';

/// Pantalla de ficha de producto.
class ProductDetailPage extends ConsumerWidget {
  const ProductDetailPage({required this.productId, super.key});

  final int productId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<MenuProduct> product = ref.watch(productDetailProvider(productId));

    return Scaffold(
      appBar: AppBar(
        title: const Text('Producto'),
        leading: const _BackButton(),
        actions: <Widget>[
          IconButton(
            onPressed: () => context.push(AppRoutes.cart),
            icon: const Icon(Icons.shopping_basket_outlined),
            tooltip: 'Ver el pedido',
            // `AppDestination` ya pone el badge en la navegación; aquí el botón
            // es un acceso secundario y lleva su propio nombre accesible.
          ),
        ],
      ),
      body: SafeArea(
        child: AsyncStateBuilder<MenuProduct>(
          value: product,
          loadingMessage: 'Cargando el producto…',
          onRetry: () async => ref.invalidate(productDetailProvider(productId)),
          builder: (BuildContext context, MenuProduct data) =>
              _ProductBody(product: data),
        ),
      ),
    );
  }
}

/// `BackButton` con etiqueta propia: el de Material se anuncia como "atrás", que
/// no dice a dónde vuelve.
class _BackButton extends StatelessWidget {
  const _BackButton();

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: 'Volver al menú',
      excludeSemantics: true,
      child: Tooltip(
        message: 'Volver al menú',
        child: SizedBox.square(
          dimension: 44,
          child: IconButton(
            onPressed: () => context.canPop() ? context.pop() : context.go(AppRoutes.menu),
            icon: const Icon(Icons.arrow_back_rounded),
          ),
        ),
      ),
    );
  }
}

/// Contenido de la ficha.
class _ProductBody extends ConsumerWidget {
  const _ProductBody({required this.product});

  final MenuProduct product;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final bool wide = context.breakpoint.usesSidebar;
    final double padding = context.breakpoint.screenPadding;
    final Widget info = ProductInfoSection(product: product, padding: padding);
    final Widget options = ProductOptionsSection(product: product, padding: padding);
    final Widget footer = ProductDetailFooter(
      product: product,
      onAdded: () => _confirmAdded(context, ref),
    );

    if (!wide) {
      return Column(
        children: <Widget>[
          Expanded(
            child: ListView(
              padding: EdgeInsets.only(bottom: AppSpacing.lg),
              children: <Widget>[
                info,
                const Divider(height: AppSpacing.xxl),
                options,
              ],
            ),
          ),
          footer,
        ],
      );
    }

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Expanded(flex: 3, child: ListView(children: <Widget>[info])),
        VerticalDivider(
          width: 1,
          color: Theme.of(context).colorScheme.outlineVariant,
        ),
        Expanded(
          flex: 2,
          child: Column(
            children: <Widget>[
              Expanded(
                child: ListView(children: <Widget>[options]),
              ),
              footer,
            ],
          ),
        ),
      ],
    );
  }

  /// Confirmación en `SnackBar` con acción directa al carrito: el usuario
  /// acaba de decidir algo, y el siguiente paso natural es revisar el pedido.
  void _confirmAdded(BuildContext context, WidgetRef ref) {
    final ScaffoldMessengerState messenger = ScaffoldMessenger.of(context);
    messenger.hideCurrentSnackBar();
    messenger.showSnackBar(
      SnackBar(
        content: Text('${product.name} añadido a tu pedido.'),
        action: SnackBarAction(
          label: 'Ver pedido',
          onPressed: () => context.push(AppRoutes.cart),
        ),
      ),
    );
    // La selección se reinicia para que añadir dos veces no duplique la
    // cantidad sin que el usuario lo note.
    ref.read(productSelectionProvider(product).notifier).setQuantity(1);
  }
}
