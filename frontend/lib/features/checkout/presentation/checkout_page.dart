// Pantalla del checkout.
//
// EL FLUJO EXACTO QUE PIDIO EL CLIENTE
//   1. Elegir tipo de pedido  (Para llevar / Consumir aquí / Reservar silla)
//   2. Si es DINE_IN o CHAIR_RENTAL: «¿Quieres reservar una silla?» Sí/No
//   3. Si hay silla: elegir duración
//   4. Resumen con el precio real de la silla (`GET /reservations/quote`)
//   5. Confirmar → reserva (si hay silla) + `POST /orders`
//
// SE MUESTRA UN PASO A LA VEZ, CON UN INDICADOR PULSABLE
// Meter los cuatro bloques en una sola página larga obliga a hacer scroll para
// encontrar el botón de confirmar y hace imposible volver atrás sin perder lo
// elegido. `CheckoutStepBar` deja saltar a cualquier paso ya desbloqueado.
//
// RESPONSIVE (docs/DESIGN-TOKENS §5)
//   mobile / tablet → una columna; el CTA va fijo abajo
//   desktop / wide  → dos columnas: pasos a la izquierda, resumen a la derecha
//                     (fijo). Es el layout de la referencia: el total no puede
//                     estar en el borde de una pantalla de 1400 px.
//
// EL CTA ES UNO SOLO Y SIEMPRE DICE QUÉ VA A PASAR
// "Ver resumen" hasta el último paso, "Registrar pedido" en el resumen. Un botón
// que dice "Continuar" y a veces cobra es la peor de las dos opciones.
//
// EL 409 DE SILLA OCUPADA
// `CheckoutController.confirm` lo detecta por `details.code` y vuelve al paso de
// la silla con el mapa recargado; `CheckoutBottomBar` traduce ese estado en un
// aviso accionable ("elige otra") en vez de un error seco.


import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../app/breakpoints.dart';
import '../../../app/routes.dart';
import '../../../core/customer/cart_providers.dart';
import '../../../core/customer/cart_state.dart';
import '../../../shared/widgets/ui/empty_state.dart';
import '../../cart/domain/entities/coupon_quote.dart';
import '../../cart/presentation/coupon_controller.dart';
import './checkout_controller.dart';
import './checkout_state.dart';
import './widgets/checkout_bottom_bar.dart';
import './widgets/checkout_layouts.dart';
import './widgets/checkout_step_bar.dart';

/// Pantalla de checkout.
class CheckoutPage extends ConsumerWidget {
  const CheckoutPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final CartState cart = ref.watch(cartStoreProvider).state;
    final CheckoutState state = ref.watch(checkoutProvider);

    // El descuento que el cliente validó en el carrito. Se muestra como
    // PREVISUALIZACIÓN: `POST /orders` lo recalcula (BR-DISC-001) y la
    // confirmación muestra el importe real que aplicó el servidor. Si el cupón
    // dejó de ser válido, aquí no se descuenta nada en vez de enseñar un ahorro
    // que el backend no va a conceder.
    final AsyncValue<CouponQuote> coupon = ref.watch(couponProvider);
    final int discountMinor = cart.couponCode != null && coupon.hasValue
        ? coupon.requireValue.discountMinor
        : 0;

    // Carrito vacío: se llega con un clic desde el perfil o escribiendo la URL.
    if (cart.isEmpty) {
      return Scaffold(
        appBar: AppBar(title: const Text('Finalizar pedido')),
        body: const SafeArea(child: _EmptyCartNotice()),
      );
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text('Finalizar pedido'),
        leading: const _CloseButton(),
      ),
      body: SafeArea(
        child: Column(
          children: <Widget>[
            const CheckoutStepBar(),
            const Divider(height: 1),
            Expanded(
              child: context.breakpoint.usesSidebar
                  ? CheckoutWideLayout(
                      cart: cart,
                      state: state,
                      discountMinor: discountMinor,
                    )
                  : CheckoutNarrowLayout(
                      cart: cart,
                      state: state,
                      discountMinor: discountMinor,
                    ),
            ),
          ],
        ),
      ),
      bottomNavigationBar: CheckoutBottomBar(cart: cart, state: state),
    );
  }
}

/// Salir del checkout con un botón de etiqueta propia: el de Material se anuncia
/// como "atrás" y no dice a dónde vuelve.
class _CloseButton extends StatelessWidget {
  const _CloseButton();

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: 'Cerrar el checkout y volver al pedido',
      excludeSemantics: true,
      child: Tooltip(
        message: 'Volver al pedido',
        child: SizedBox.square(
          dimension: 44,
          child: IconButton(
            onPressed: () =>
                context.canPop() ? context.pop() : context.go(AppRoutes.cart),
            icon: const Icon(Icons.close_rounded),
          ),
        ),
      ),
    );
  }
}

/// Carrito vacío: nunca una pantalla en blanco.
class _EmptyCartNotice extends StatelessWidget {
  const _EmptyCartNotice();

  @override
  Widget build(BuildContext context) {
    return EmptyState(
      icon: Icons.shopping_basket_outlined,
      title: 'No hay nada que finalizar',
      message: 'Añade algo del menú y vuelve aquí para registrar tu pedido.',
      actionLabel: 'Ver el menú',
      onAction: () => context.go(AppRoutes.menu),
    );
  }
}
