// Detalle de un pedido (`GET /orders/:id`).
//
// PÁGINA COMPLETA, FUERA DEL SHELL
// Es una tarea concentrada (leer, comprobar la silla, ver el comprobante) y en
// móvil una pantalla con barra de pestañas solo competiría por el pulgar
// (docs/DESIGN-TOKENS §5). Se abre con `push` desde la lista, así que el botón
// «atrás» vuelve a donde la persona estaba.
//
// ESTADOS
//   carga / sin red / error → `AsyncStateBuilder` con reintento (botón de
//     "Reintentar" incluido, que es el caso que la tarea pide explícitamente:
//     sin conexión hay que poder reintentar sin cerrar la pantalla)
//   éxito                   → la ficha
//
// EL TEMPORIZADOR
// Si el pedido tiene un alquiler VIVO (`ACTIVE` o `EXTENDED`), `RentalPanel` pinta
// `RentalCountdown`, que se actualiza con `clockProvider`: un `Stream` de un
// segundo COMPARTIDO con la home y la pestaña «Silla» (`shared/widgets/
// rental_countdown.dart`). Tres `Timer.periodic` independientes derivarían uno
// del otro y las tres pantallas mostrarían cifras distintas.
//
// EL BOTÓN DE EXTENDER
// Solo se pinta si el usuario tiene el permiso `rentals:extend`. Un `CUSTOMER`
// NO lo tiene (DESIGN.md §9.3), así que para el cliente normal el botón no
// aparece y hay una frase que explica que se pide en el mostrador. Comprobar el
// permiso ANTES de pintar es la diferencia entre una app que no ofrece lo
// imposible y una que promete y luego se excusa con un `403`.


import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../app/breakpoints.dart';
import '../../../app/theme/app_spacing.dart';
import '../../../shared/widgets/ui/async_state_builder.dart';
import '../domain/entities/order_detail.dart';
import './orders_controller.dart';
import './widgets/order_actions.dart';
import './widgets/order_blocks.dart';
import './widgets/order_items_card.dart';
import './widgets/order_totals_and_actions.dart';

/// Detalle de un pedido.
class OrderDetailPage extends ConsumerWidget {
  const OrderDetailPage({required this.orderId, super.key});

  final int orderId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<OrderDetail> order = ref.watch(orderDetailProvider(orderId));
    final double padding = context.breakpoint.screenPadding;

    return Scaffold(
      appBar: AppBar(title: const Text('Tu pedido')),
      body: SafeArea(
        child: AsyncStateBuilder<OrderDetail>(
          value: order,
          loadingMessage: 'Cargando el pedido…',
          onRetry: () async => ref.invalidate(orderDetailProvider(orderId)),
          builder: (BuildContext context, OrderDetail data) => ListView(
            padding: EdgeInsets.fromLTRB(
              padding,
              AppSpacing.lg,
              padding,
              AppSpacing.xxl,
            ),
            children: <Widget>[
              OrderHeaderCard(order: data),
              if (data.hasLiveRental) ...<Widget>[
                const SizedBox(height: AppSpacing.lg),
                RentalPanel(order: data),
              ],
              const SizedBox(height: AppSpacing.lg),
              OrderItemsCard(order: data),
              const SizedBox(height: AppSpacing.lg),
              OrderTotalsCard(order: data),
              if (data.payments.isNotEmpty) ...<Widget>[
                const SizedBox(height: AppSpacing.lg),
                OrderPaymentsCard(order: data),
              ],
              const SizedBox(height: AppSpacing.lg),
              OrderActions(order: data),
            ],
          ),
        ),
      ),
    );
  }
}
