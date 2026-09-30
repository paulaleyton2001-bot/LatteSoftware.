// Pantalla del carrito.
//
// LAYOUT ADAPTATIVO (docs/DESIGN-TOKENS.md §5)
//   mobile  → una columna; el resumen y el cupón van DEBAJO de la lista.
//   desktop → dos columnas (lista | resumen fijo), que es el layout de la
//             referencia y evita que el botón de pagar quede a dos scrolls del
//             contenido que lo genera.
//
// ESTADOS
//   vacío   → `EmptyState` con salida al menú (nunca una pantalla en blanco)
//   con filas → la lista editable + cupón + resumen + CTA
//
// El carrito es SINCRÓNICO (vive en `core/customer`): no hay `AsyncStateBuilder`
// porque no hay red detrás. Esa es la diferencia con el resto de pantallas, y es
// intencionada: el carrito tiene que abrir al instante, también sin conexión.


import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../app/breakpoints.dart';
import '../../../app/routes.dart';
import '../../../app/theme/app_spacing.dart';
import '../../../core/customer/cart_state.dart';
import '../../../shared/constants/app_strings.dart';
import '../../../shared/widgets/ui/app_button.dart';
import '../../../shared/widgets/ui/app_card.dart';
import '../../../shared/widgets/ui/empty_state.dart';
import '../../../shared/widgets/ui/section_header.dart';
import '../domain/entities/coupon_quote.dart';
import './cart_controller.dart';
import './coupon_controller.dart';
import './widgets/cart_line_card.dart';
import './widgets/cart_totals_card.dart';
import './widgets/coupon_field.dart';

/// Pantalla del carrito.
class CartPage extends ConsumerWidget {
  const CartPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final CartState cart = ref.watch(cartControllerProvider);

    return Scaffold(
      appBar: AppBar(
        title: Text(
          'Tu pedido',
          style: Theme.of(context).textTheme.headlineSmall,
        ),
        actions: <Widget>[
          if (cart.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(right: AppSpacing.lg),
              child: Center(
                child: Text(
                  '${cart.totalQuantity} ${cart.totalQuantity == 1 ? 'artículo' : 'artículos'}',
                  style: Theme.of(context).textTheme.labelLarge,
                ),
              ),
            ),
        ],
      ),
      body: SafeArea(
        child: cart.isEmpty
            ? const _EmptyCart()
            : _CartBody(cart: cart),
      ),
      // El CTA es `espresso` (el CTA de alto peso del design system) y va
      // FIJO en móvil: el carrito puede ser largo y no obligar a scroll para
      // pagar es la diferencia entre convertir y abandonar.
      bottomNavigationBar: cart.isEmpty
          ? null
          : SafeArea(
              child: Padding(
                padding: EdgeInsets.fromLTRB(
                  context.breakpoint.screenPadding,
                  AppSpacing.sm,
                  context.breakpoint.screenPadding,
                  AppSpacing.md,
                ),
                child: AppButton(
                  label: 'Continuar al checkout',
                  icon: Icons.arrow_forward_rounded,
                  variant: AppButtonVariant.espresso,
                  size: AppButtonSize.large,
                  isFullWidth: true,
                  onPressed: () => context.push(AppRoutes.checkout),
                  semanticLabel: 'Continuar al checkout con '
                      '${cart.totalQuantity} artículos',
                ),
              ),
            ),
    );
  }
}

/// Cuerpo con lista + panel lateral de cupón/resumen.
class _CartBody extends ConsumerWidget {
  const _CartBody({required this.cart});

  final CartState cart;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final double padding = context.breakpoint.screenPadding;
    final bool wide = context.breakpoint.usesSidebar;
    final AsyncValue<CouponQuote> quote = ref.watch(couponProvider);
    final int discount = quote.valueOrNull?.isValid == true
        ? quote.requireValue.discountMinor
        : 0;
    final String? couponLabel = quote.valueOrNull?.code ?? cart.couponCode;

    final Widget lines = ListView.separated(
      padding: EdgeInsets.fromLTRB(padding, AppSpacing.sm, padding, AppSpacing.lg),
      itemCount: cart.lines.length,
      separatorBuilder: (BuildContext context, int index) =>
          const SizedBox(height: AppSpacing.md),
      itemBuilder: (BuildContext context, int index) {
        final CartLine line = cart.lines[index];
        return CartLineCard(
          line: line,
          onQuantityChanged: (int quantity) => ref
              .read(cartControllerProvider.notifier)
              .setQuantity(line.id, quantity),
          onRemove: () =>
              ref.read(cartControllerProvider.notifier).removeLine(line.id),
        );
      },
    );

    final Widget side = SingleChildScrollView(
      padding: EdgeInsets.fromLTRB(padding, AppSpacing.sm, padding, AppSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          const SectionHeader(title: 'Cupón', padding: EdgeInsets.zero),
          const SizedBox(height: AppSpacing.sm),
          CouponField(cart: cart),
          const SizedBox(height: AppSpacing.xl),
          CartTotalsCard(
            state: cart,
            discountMinor: discount,
            couponLabel: couponLabel,
          ),
          if (cart.estimatedPreparationMinutes > 0) ...<Widget>[
            const SizedBox(height: AppSpacing.md),
            _PreparationNotice(minutes: cart.estimatedPreparationMinutes),
          ],
        ],
      ),
    );

    if (!wide) {
      // LAS DOS PARTES SON FLEXIBLES, Y ESTO NO ES COSA MENOR
      //
      // Antes la columna era `Expanded(líneas) + Divider + side`, con `side` sin
      // envolver. En un `Column`, un hijo que no es flexible se mide con su
      // altura INTRÍNSECA y se queda con todo lo que pida; el `Expanded` de las
      // líneas se queda con lo que sobre, que puede ser cero o casi cero.
      //
      // El resultado en un móvil estrecho (393 dp, el Xiaomi) se vio en el
      // dispositivo: con dos productos, el cupón, los totales y el aviso de
      // preparación, el panel se llevaba casi toda la altura y la lista quedaba
      // con un borde de unos 250 dp, con la SEGUNDA línea de producto cortada por
      // la mitad justo en el borde. No había franjas amarillas —el `ListView`
      // recorta en vez de desbordar—, así que no lo cazaba ningún test de
      // overflow: era un recorte silencioso que hace el carrito ilegible.
      //
      // Las dos partes se reparten el alto con `flex` y las dos se desplazan por
      // separado. Además la lista recibe más proporción (3 de 5) porque es la
      // parte que el cliente está revisando, y el resumen es el que ya tiene su
      // copia en el CTA fijo de abajo.
      return Column(
        children: <Widget>[
          Expanded(flex: 3, child: lines),
          const Divider(height: 1),
          Expanded(flex: 2, child: side),
        ],
      );
    }

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Expanded(flex: 3, child: lines),
        VerticalDivider(width: 1, color: Theme.of(context).colorScheme.outlineVariant),
        Expanded(flex: 2, child: side),
      ],
    );
  }
}

/// Aviso de tiempo de preparación estimado. Es una estimación del catálogo, no
/// una promesa: por eso el texto lo dice.
class _PreparationNotice extends StatelessWidget {
  const _PreparationNotice({required this.minutes});

  final int minutes;

  @override
  Widget build(BuildContext context) {
    final TextTheme text = Theme.of(context).textTheme;
    return AppCard(
      variant: AppCardVariant.flat,
      color: Theme.of(context).colorScheme.surfaceContainerLow,
      child: Row(
        children: <Widget>[
          const Icon(Icons.schedule_rounded, size: 18),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Text(
              'Preparamos tu pedido en unos $minutes min. Te avisamos cuando '
              'esté listo.',
              style: text.bodySmall,
            ),
          ),
        ],
      ),
    );
  }
}

/// Carrito vacío: nunca una pantalla en blanco.
class _EmptyCart extends StatelessWidget {
  const _EmptyCart();

  @override
  Widget build(BuildContext context) {
    return EmptyState(
      icon: Icons.shopping_basket_outlined,
      title: 'Tu pedido está vacío',
      message: AppStrings.payAtStoreLong,
      actionLabel: 'Ver el menú',
      onAction: () => context.go(AppRoutes.menu),
    );
  }
}
