// Orquestación del cobro del mostrador. MÓDULO `pos/presentation/widgets`.
//
// EL COBRO, PASO A PASO
//   1. `Enter` o el botón grande abren el flujo.
//   2. Se consulta [posChargeGateProvider]: si el veredicto es «no se puede
//      cobrar», se DICE POR QUÉ y se para. No es un detalle: un corte silencioso
//      es indistinguible de un botón roto.
//   3. Si el pedido es nuevo, `POST /orders` con las líneas del carrito, el tipo y
//      la silla. El servidor devuelve los totales REALES.
//   4. Se abre el diálogo con ESE saldo. El cajero anota efectivo o tarjeta.
//   5. `POST /payments` con la cabecera `Idempotency-Key` obligatoria.
//   6. Se muestra el resultado con el cambio que calculó el servidor, se vacía el
//      carrito y se refresca el mapa de sillas.
//
// POR QUÉ EL VEREDICTO NO ES `lines.isEmpty`
// Un pedido de alquiler NO lleva líneas: el backend PROHÍBE mezclarlas (`422
// MIXED_ORDER_TYPE_NOT_ALLOWED`, BR-ORDER-012). El corte por carrito vacío que
// había aquí era correcto para el consumo y falso para el alquiler, así que
// mataba exactamente el flujo que debía funcionar. El veredicto vive en
// `pos_charge_gate.dart` y lo comparten el panel, la pantalla y este flujo, para
// que no puedan discrepar.
//
// POR QUÉ ESTÁ FUERA DE `pos_page.dart`
// Son cuatro métodos asíncronos con diálogo, confirmación y snackbars. Pegados a
// la pantalla el archivo pasaba de 400 líneas y la parte que decide si el cobro se
// perdió (el caso de red) quedaba enterrada bajo el layout.
//
// CASOS DE FALLO, QUE SON DISTINTOS
//   - Falla `POST /orders`: NO se creó nada. El carrito sigue intacto y el cajero
//     corrige y reintenta. Un `422 PRODUCT_UNAVAILABLE` o un `409
//     CHAIR_OCCUPIED` se muestran con el mensaje del backend, que ya dice qué pasó.
//   - Falla `POST /payments`: el pedido YA existe. El diálogo se queda abierto con
//     el error y la MISMA clave de idempotencia, de modo que reintentar no cobra
//     dos veces.
//   - El cajero cierra el diálogo: el pedido existe y queda PENDIENTE. No se borra
//     nada y se ofrece el tablero para cobrarlo después.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../../app/routes.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../core/customer/cart_providers.dart';
import '../../../../core/customer/cart_state.dart';
import '../../../../core/customer/venue_providers.dart';
import '../../../../core/error/failures.dart';
import '../../../../core/result/result.dart';
import '../../../../core/utils/currency_formatter.dart';
import '../../../../shared/constants/app_strings.dart';
import '../../../../shared/widgets/ui/confirm_dialog.dart';
import '../../domain/entities/pos_charge.dart';
import '../../domain/entities/pos_draft.dart';
import '../../domain/repositories/pos_repository.dart';
import '../../domain/repositories/pos_repository_models.dart';
import '../pos_cart_controller.dart';
import '../pos_charge_controller.dart';
import '../pos_charge_gate.dart';
import '../pos_controller.dart';
import '../pos_orders_controller.dart';
import './pos_order_type_selector.dart';
import './pos_payment_dialog.dart';
import './pos_receipt_sheet.dart';

/// Ejecuta el flujo completo. Devuelve `true` si el cobro quedó registrado.
///
/// Se separa de [PosPage] para que la pantalla no tenga estado de negocio: esto
/// es la lógica del cobro y cambia cuando cambia el contrato de `POST /payments`,
/// no cuando cambia el layout.
class PosChargeFlow {
  const PosChargeFlow(this.ref, this.context);

  final WidgetRef ref;
  final BuildContext context;

  /// Cobro completo. `true` si el servidor aceptó el pago.
  Future<bool> run() async {
    // ¿SE PUEDE COBRAR? Lo decide [posChargeGateProvider], el MISMO veredicto
    // que apaga el botón del panel, y no un `lines.isEmpty` propio.
    //
    // POR QUÉ ESTO CAMBIÓ (el corte que mataba el alquiler)
    // Aquí había `if (lines.isEmpty) return false;`. Para un pedido de consumo
    // es correcto, pero un alquiler NO lleva líneas —el backend lo prohíbe
    // mezclar: `422 MIXED_ORDER_TYPE_NOT_ALLOWED`, BR-ORDER-012— así que el
    // flujo correcto de alquiler SIEMPRE tiene el carrito vacío y el corte lo
    // mataba justo en el único caso en que debía pasar. El botón se veía
    // habilitado (el panel no tenía ese corte) y no pasaba nada.
    //
    // Ahora, si el veredicto es «no», se DICE POR QUÉ en vez de voltar en
    // silencio. Un `return false` mudo es indistinguible de un botón roto, que
    // es exactamente lo que reportó el cajero.
    final PosChargeGate gate = ref.read(posChargeGateProvider);
    if (gate case PosChargeBlocked(:final String reason)) {
      await _showBlocked(reason);
      return false;
    }
    final bool isRental = gate is PosChargeAllowed && gate.isRental;

    final PosOrderResult? order = await _createOrder(isRental: isRental);
    if (order == null || !context.mounted) return false;

    final bool? paid = await PosPaymentDialog.show(
      context,
      orderId: order.orderId,
      orderNumber: order.orderNumber,
      balanceMinor: order.balanceMinor,
    );
    if (!context.mounted) return false;
    if (paid == true) {
      await _afterCharge(order);
      return true;
    }
    await _notifyPending(order);
    return false;
  }

  /// El veredicto fue «no se puede cobrar». Se explica, no se vuelve en silencio.
  Future<void> _showBlocked(String reason) async {
    if (!context.mounted) return;
    await showDialog<void>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        icon: Icon(Icons.info_outline_rounded, color: context.tokens.textInfo),
        title: const Text('Todavía no se puede cobrar'),
        content: Text(reason),
        actions: <Widget>[
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('Entendido'),
          ),
        ],
      ),
    );
  }

  Future<PosOrderResult?> _createOrder({required bool isRental}) async {
    // `draft`, no `posdraft`: el nombre en minúsculas no es una convención de Dart
    // y se lee como un descuido.
    final PosDraft draft = ref.read(posDraftProvider);
    // Un pedido de alquiler NO lleva líneas de producto: el backend lo rechaza
    // con `422 MIXED_ORDER_TYPE_NOT_ALLOWED` (BR-ORDER-012, «Un pedido de
    // alquiler no lleva líneas de producto»). Comprobado contra el backend: no
    // es una sugerencia del contrato, es un rechazo real. Por eso aquí las
    // líneas se vacían; el consumo del carrito se cobra en su propio pedido, y el
    // panel de cobro avisa de ello antes de que llegue aquí.
    final List<CartLine> lines = ref.read(posLinesProvider);
    final List<PosOrderLineRequest> items = isRental
        ? const <PosOrderLineRequest>[]
        : <PosOrderLineRequest>[
            for (final CartLine line in lines)
              PosOrderLineRequest(
                productId: line.productId,
                quantity: line.quantity.toDouble(),
                variantId: line.variantId,
                notes: line.notes.isEmpty ? null : line.notes,
              ),
          ];

    final Result<PosOrderResult> result = await ref
        .read(posRepositoryProvider)
        .createOrder(PosOrderDraftRequest(
          type: draft.type.apiValue,
          chairId: draft.chairId,
          reservationId: draft.reservationId,
          rentalId: draft.rentalId,
          tableLabel: draft.tableLabel.isEmpty ? null : draft.tableLabel,
          notes: draft.notes.isEmpty ? null : draft.notes,
          couponCode: draft.couponCode,
          items: items,
        ));
    if (!context.mounted) return null;
    if (result case FailureResult<PosOrderResult>(:final Failure failure)) {
      await _showFailure(failure, isRental: isRental);
      return null;
    }
    return (result as Success<PosOrderResult>).value;
  }

  /// Tras cobrar bien: se informa del cambio, se limpia y se refresca el plano.
  Future<void> _afterCharge(PosOrderResult order) async {
    final PosChargeState state = ref.read(posChargeProvider);
    if (!context.mounted) return;
    // El carrito se vacía SOLO si el pedido cobrado llevaba sus productos. En un
    // alquiler el pedido va sin líneas (BR-ORDER-012), así que vaciarlo tiraría
    // productos que el cajero todavía no ha cobrado y que perdería de la vista.
    final bool wasRental = ref.read(posDraftProvider).isChairRental;
    if (!wasRental) {
      ref.read(cartStoreProvider).clear();
    }
    ref.read(posDraftProvider.notifier).reset();
    ref.read(posChargeProvider.notifier).resetForNewCharge();
    // El mapa de sillas y el tablero quedan desfasados tras crear y cobrar.
    // `invalidateVenueMap` espera un `Ref` de provider y aquí hay un `WidgetRef`,
    // así que se invalida el provider directamente (es lo que hace el helper).
    ref.invalidate(venueMapProvider);
    ref.invalidate(posOrdersProvider);

    if (state case PosChargeSucceeded(:final PosChargeResult result)) {
      await showModalBottomSheet<void>(
        context: context,
        showDragHandle: true,
        builder: (BuildContext sheetContext) => PosReceiptSheet(
          orderNumber: order.orderNumber,
          totalMinor: result.amountMinor,
          changeDueMinor: result.changeDueMinor,
          balanceMinor: result.balanceMinor,
          formatMoney: CurrencyFormatter.formatMinor,
        ),
      );
    }
  }

  /// El cajero cerró el diálogo: el pedido EXISTE y queda pendiente de cobro.
  Future<void> _notifyPending(PosOrderResult order) async {
    if (!context.mounted) return;
    await showDialog<void>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: const Text('Pedido pendiente de cobro'),
        content: Text(
          'El pedido ${order.orderNumber} quedó registrado por '
          '${CurrencyFormatter.formatMinor(order.balanceMinor)} y NO se cobró. '
          'Puedes cobrarlo desde el tablero de pedidos.',
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('Entendido'),
          ),
          FilledButton(
            onPressed: () {
              Navigator.of(dialogContext).pop();
              context.pushNamed(RouteNames.posOrdersBoard);
            },
            child: const Text('Ir al tablero'),
          ),
        ],
      ),
    );
  }

  /// Aviso de fallo con el mensaje del backend y el tono que corresponde.
  ///
  /// Los `422` de alquiler NO se muestran crudos. El enunciado de esos errores
  /// («Un pedido de alquiler necesita la reserva asociada») es técnica, y el
  /// cajero no puede actuar sobre él: tiene que elegir una reserva. Se traducen
  /// a la acción concreta, que además es la que el panel de cobro ofrece.
  Future<void> _showFailure(Failure failure, {required bool isRental}) async {
    if (!context.mounted) return;
    final bool rule = failure is ConflictFailure || failure is BusinessRuleFailure;
    final String? hint = isRental ? _rentalHint(failure) : null;
    await showDialog<void>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        icon: Icon(
          rule ? Icons.warning_amber_rounded : Icons.error_outline_rounded,
          color: rule ? context.tokens.textWarning : context.tokens.textError,
        ),
        title: Text(
          isRental
              ? 'No se pudo registrar el alquiler'
              : 'No se pudo registrar el pedido',
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(failure.message),
            if (hint != null) ...<Widget>[
              const SizedBox(height: AppSpacing.md),
              PosInlineNotice(icon: Icons.lightbulb_outline_rounded, text: hint),
            ],
          ],
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('Entendido'),
          ),
        ],
      ),
    );
  }

  /// Traduce un `422` de alquiler a la acción que lo resuelve.
  ///
  /// Los códigos vienen en `failure.code`; los tres que aparecen en este flujo
  /// son los de `docs/API.md` §7.9/§7.12. Un `422` desconocido devuelve `null` y
  /// se muestra el mensaje del backend tal cual, que para un caso raro es mejor
  /// que inventar una explicación.
  static String? _rentalHint(Failure failure) {
    final String code = failure.code ?? '';
    if (code == 'RENTAL_REQUIRES_CHAIR_AND_RESERVATION' ||
        code == 'RESERVATION_NOT_ACTIVE') {
      return 'Vuelve a elegir la reserva de esta silla en el panel de cobro. Si el '
          'cliente no tenía reserva, abre un alquiler sin reserva.';
    }
    if (code == 'CHAIR_OCCUPIED' || code == 'CHAIR_IN_USE') {
      return 'La silla se ocupó mientras tanto. Elige otra del plano y repite.';
    }
    if (code == 'MIXED_ORDER_TYPE_NOT_ALLOWED') {
      return 'Un alquiler no lleva productos: cobra antes el consumo y luego el '
          'alquiler, o cambia el tipo a «En el local».';
    }
    return null;
  }
}

/// Borra el pedido en curso con confirmación.
///
/// Se expone aparte porque la usan DOS sitios: el botón "Nuevo pedido" (que pide
/// `F2`) y el `PopScope` de Android, que salta al pulsar atrás. Compartirlo evita que
/// los dos caminos se comporten distinto: uno vacía y el otro no, y el cajero
/// pierde el pedido sin avisar.
///
/// EL MENSAJE HABLA DEL ALQUILER, NO SOLO DE LOS PRODUCTOS
/// El texto anterior era «Se borran los productos que llevas…», y en un alquiler
/// no hay ninguno: el cajero leía un aviso sobre un carrito vacío mientras
/// descartaba un alquiler con la silla ya `OCCUPIED` en el servidor. Ahora el
/// mensaje nombra lo que se va a perder de verdad, que en un alquiler incluye la
/// silla y el tiempo.
Future<void> confirmDiscardPosOrder(BuildContext context, WidgetRef ref) async {
  final bool isRental = ref.read(posDraftProvider).isChairRental;
  final DialogAction action = await ConfirmDialog.show(
    context,
    title: '¿Descartar el pedido en curso?',
    message: isRental
        ? 'Se suelta la silla y el alquiler NO se cobra: el tiempo rented se '
            'pierde y el pedido no se registra en el servidor. Si el cliente se '
            'queda, vuelve a elegir la silla y cobra antes de descartar.'
        : 'Se borran los productos que llevas y el pedido NO se registra en el '
            'servidor. No se cobra nada.',
    confirmLabel: 'Descartar',
    action: DialogAction.cancel,
    icon: Icons.delete_sweep_outlined,
  );
  if (action != DialogAction.confirm || !context.mounted) return;
  ref.read(cartStoreProvider).clear();
  ref.read(posDraftProvider.notifier).reset();
  ref.read(posChargeProvider.notifier).resetForNewCharge();
}

/// Aviso de atajos, para el botón de la barra superior.
Future<void> showPosShortcutsDialog(BuildContext context) => showDialog<void>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: const Text('Atajos de teclado'),
        content: const Text(AppStrings.shortcutsHint),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('Cerrar'),
          ),
        ],
      ),
    );
