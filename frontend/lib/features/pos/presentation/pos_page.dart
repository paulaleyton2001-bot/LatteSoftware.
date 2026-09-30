// Pantalla principal del punto de venta.
//
// QUÉ HACE ESTE ARCHIVO Y QUÉ NO
// Solo lo que necesita estado de PANTALLA: el `FocusNode` del buscador, la
// pestaña activa en móvil y la orquestación del cobro (crear pedido → cobrar →
// limpiar). El layout está en `pos_workspace.dart` y el cobro en
// `widgets/pos_payment_dialog.dart`.
//
// EL COBRO, PASO A PASO
//   1. `Enter` o el botón grande abren `PosChargeFlow.run`.
//   2. Si el pedido es nuevo, `POST /orders` con las líneas del carrito, el tipo y
//      la silla. El servidor devuelve los totales REALES.
//   3. Se abre el diálogo con ESE saldo. El cajero anota efectivo o tarjeta.
//   4. `POST /payments` con la cabecera `Idempotency-Key` obligatoria.
//   5. Se muestra el resultado con el cambio que calculó el servidor, se vacía el
//      carrito y se refresca el mapa de sillas.
//
// SI FALLA EL PASO 2
// El pedido NO se ha creado, así que no hay nada que limpiar ni que anular: el
// carrito sigue intacto y el cajero puede corregir y reintentar. Un `422
// PRODUCT_UNAVAILABLE` (agotado) o un `409 CHAIR_OCCUPIED` (la silla se ocupó
// entre medias) se muestran con el mensaje del backend, que ya dice qué pasó.
//
// SI FALLA EL PASO 4
// El pedido YA existe en el servidor. El diálogo se queda abierto con el error y
// la MISMA clave de idempotencia, de modo que reintentar no cobra dos veces.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../app/responsive/pos_breakpoints.dart';
import '../../../app/routes.dart';
import '../../../shared/constants/app_strings.dart';
import './pos_cart_controller.dart';
import './pos_charge_controller.dart';
import './pos_controller.dart';
import './pos_mobile_tab.dart';
import './pos_shortcuts.dart';
import './pos_workspace.dart';
import './widgets/pos_charge_flow.dart';
import './widgets/pos_top_bar.dart';

/// Punto de venta del cajero.
class PosPage extends ConsumerStatefulWidget {
  const PosPage({super.key});

  @override
  ConsumerState<PosPage> createState() => _PosPageState();
}

class _PosPageState extends ConsumerState<PosPage> {
  final FocusNode _searchFocus = FocusNode(debugLabel: 'pos-search');
  PosMobileTab _tab = PosMobileTab.catalog;
  bool _charging = false;

  @override
  void initState() {
    super.initState();
    // El buscador arranca con el foco, que es lo que espera un cajero: escribe y
    // da Enter, sin tocar el ratón.
    //
    // Va en un post-frame y no en `initState` a propósito: en `initState` el nodo
    // todavía NO está montado en ningún `Focus`, y `requestFocus()` sobre un nodo
    // sin `FocusScopeNode` no hace nada (en debug, además avisa). Un
    // `Focus(autofocus: true)` alrededor tampoco bastaba: el `autofocus` es del
    // `Focus` intermedio, no del `TextField` que lleva el nodo, así que el teclado
    // no abría nunca.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _searchFocus.requestFocus();
    });
  }

  @override
  void dispose() {
    // `FocusNode` propio: si no se libera, el árbol conserva el nodo y Flutter
    // avisa por consola.
    _searchFocus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final PosLayout layout = context.posLayout;
    final bool locked = _charging;
    final bool hasLines = ref.watch(posLinesProvider).isNotEmpty;
    // El borrador va aparte de las líneas a propósito: un alquiler no tiene
    // líneas, y perder el borrador en silencio dejaba la silla ocupada y el
    // alquiler sin cobrar. Ver `PosDraft.hasPendingWork`.
    final bool hasDraft = ref.watch(posDraftProvider).hasPendingWork;
    final bool hasWork = hasLines || hasDraft;

    return PopScope(
      // El POS no se cierra con el botón atrás de Android perdiendo el pedido: se
      // avisa y, si el cajero confirma, se descarta explícitamente.
      //
      // «Hay pedido en curso» NO es «el carrito tiene líneas». Un alquiler no
      // lleva líneas (BR-ORDER-012) y su carrito está siempre vacío, así que
      // mirar solo la lista hacía que el POS se cerrara sin aviso con un alquiler
      // abierto en el servidor — silla `OCCUPIED` y sin cobrar—. Por eso se
      // consulta también el borrador.
      canPop: !hasWork,
      onPopInvokedWithResult: (bool didPop, Object? _) {
        if (!didPop) confirmDiscardPosOrder(context, ref);
      },
      child: Scaffold(
        body: SafeArea(
          child: LayoutBuilder(
            builder: (BuildContext context, BoxConstraints constraints) {
              // El ancho REAL, no el de la ventana: con la sidebar abierta
              // quedan 240-264 dp menos.
              final PosLayout effective = posLayoutForWidth(constraints.maxWidth);
              return PosKeyboardShortcuts(
                actions: PosShortcutActions(
                  focusSearch: _focusSearch,
                  charge: () => _runChargeFlow(effective),
                  newOrder: locked ? () {} : _newOrder,
                ),
                child: Column(
                  children: <Widget>[
                    PosTopBar(
                      layout: effective,
                      onShowOrders: () =>
                          context.pushNamed(RouteNames.posOrdersBoard),
                      onShowShortcuts: () => showPosShortcutsDialog(context),
                    ),
                    const Divider(height: 1),
                    Expanded(
                      child: Focus(
                        // `autofocus` del nodo: `F1` lo enfoca explícitamente
                        // después, así que el foco inicial solo sirve para el
                        // primer frame, que es justo cuando el cajero empieza.
                        autofocus: true,
                        child: PosWorkspace(
                          searchFocusNode: _searchFocus,
                          layout: effective,
                          onCharge: () => _runChargeFlow(effective),
                          onNewOrder: _newOrder,
                          mobileTab: _tab,
                          onMobileTabChanged: (PosMobileTab tab) =>
                              setState(() => _tab = tab),
                        ),
                      ),
                    ),
                  ],
                ),
              );
            },
          ),
        ),
        floatingActionButton: context.posShowsShortcuts
            ? FloatingActionButton.extended(
                onPressed: () => _runChargeFlow(layout),
                icon: const Icon(Icons.payments_rounded),
                label: Text(AppStrings.chargeButton),
                tooltip: '${AppStrings.shortcutCharge}: cobrar el pedido',
              )
            : null,
      ),
    );
  }

  /// Lanza el flujo de cobro (ver [PosChargeFlow]).
  ///
  /// El estado "cobrando" vive AQUÍ y no en el controlador porque es estado de
  /// PANTALLA: bloquea los botones de esta pantalla y nada más. El estado del cobro
  /// en sí (la clave de idempotencia y el resultado) vive en `posChargeProvider`.
  ///
  /// POR QUÉ NO HAY UN `if (lines.isEmpty) return;` AQUÍ (el corte que mataba el
  /// alquiler): este era UNO de los dos sitios donde el botón «Cobrar alquiler»
  /// se quedaba muerto. Ese corte es correcto para consumo y falso para
  /// alquiler, que por definición no lleva líneas. Ahora la pantalla no decide
  /// nada: delega en [PosChargeFlow], que consulta el veredicto compartido y, si
  /// no se puede cobrar, explica por qué en vez de volver en silencio.
  Future<void> _runChargeFlow(PosLayout layout) async {
    if (_charging || !mounted) return;
    setState(() => _charging = true);
    try {
      final bool charged = await PosChargeFlow(ref, context).run();
      if (charged && mounted) _focusSearch();
    } finally {
      if (mounted) setState(() => _charging = false);
    }
  }

  /// "Nuevo pedido" (`F2`): avisa si hay algo en el carrito antes de descartarlo.
  void _newOrder() {
    // Mismo criterio que el `PopScope` y por el mismo motivo: un alquiler no
    // tiene líneas, así que mirar solo el carrito descartaba en silencio un
    // alquiler ya abierto. Se delega el criterio a una función para que los dos
    // caminos no puedan separarse otra vez.
    if (!_hasPendingWork()) {
      ref.read(posDraftProvider.notifier).reset();
      ref.read(posChargeProvider.notifier).resetForNewCharge();
      _focusSearch();
      return;
    }
    confirmDiscardPosOrder(context, ref);
  }

  /// `true` si hay productos en el carrito O trabajo a medio montar en el borrador.
  bool _hasPendingWork() =>
      ref.read(posLinesProvider).isNotEmpty ||
      ref.read(posDraftProvider).hasPendingWork;

  void _focusSearch() {
    if (!mounted) return;
    setState(() => _tab = PosMobileTab.catalog);
    _searchFocus.requestFocus();
  }

  /// Barra superior del POS: marca, acceso al tablero y pista de atajos.
}
