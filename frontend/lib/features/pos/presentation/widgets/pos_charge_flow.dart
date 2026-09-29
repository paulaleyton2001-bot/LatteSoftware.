// Orquestación del cobro del mostrador. MÓDULO `pos/presentation/widgets`.
//
// QUÉ HACE, EN ORDEN
//   1. `Enter` o el botón grande abren el flujo.
//   2. Si el pedido es nuevo, `POST /orders` con las líneas del carrito, el tipo y
//      la silla. El servidor devuelve los totales REALES.
//   3. Se abre el diálogo con ESE saldo. El cajero anota efectivo o tarjeta.
//   4. `POST /payments` con la cabecera `Idempotency-Key` obligatoria.
//   5. Se muestra el resultado con el cambio que calculó el servidor, se vacía el
//      carrito y se refresca el mapa de sillas.
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
import '../pos_controller.dart';
import '../pos_orders_controller.dart';
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
    final List<CartLine> lines = ref.read(posLinesProvider);
    if (lines.isEmpty) return false;

    final PosOrderResult? order = await _createOrder(lines);
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

  Future<PosOrderResult?> _createOrder(List<CartLine> lines) async {
    // `draft`, no `posdraft`: el nombre en minúsculas no es una convención de Dart
    // y se lee como un descuido.
    final PosDraft draft = ref.read(posDraftProvider);
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
          items: <PosOrderLineRequest>[
            for (final CartLine line in lines)
              PosOrderLineRequest(
                productId: line.productId,
                quantity: line.quantity.toDouble(),
                variantId: line.variantId,
                notes: line.notes.isEmpty ? null : line.notes,
              ),
          ],
        ));
    if (!context.mounted) return null;
    if (result case FailureResult<PosOrderResult>(:final Failure failure)) {
      await _showFailure(failure);
      return null;
    }
    return (result as Success<PosOrderResult>).value;
  }

  /// Tras cobrar bien: se informa del cambio, se limpia y se refresca el plano.
  Future<void> _afterCharge(PosOrderResult order) async {
    final PosChargeState state = ref.read(posChargeProvider);
    if (!context.mounted) return;
    ref.read(cartStoreProvider).clear();
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
  Future<void> _showFailure(Failure failure) async {
    if (!context.mounted) return;
    final bool rule = failure is ConflictFailure || failure is BusinessRuleFailure;
    await showDialog<void>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        icon: Icon(
          rule ? Icons.warning_amber_rounded : Icons.error_outline_rounded,
          color: rule ? context.tokens.textWarning : context.tokens.textError,
        ),
        title: const Text('No se pudo registrar el pedido'),
        content: Text(failure.message),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('Entendido'),
          ),
        ],
      ),
    );
  }
}

/// Borra el pedido en curso con confirmación.
///
/// Se expone aparte porque la usan DOS sitios: el botón "Nuevo pedido" (que pide
/// `F2`) y el `PopScope` de Android, que salta al pulsar atrás. Compartirlo evita que
/// los dos caminos se comporten distinto: uno vacía y el otro no, y el cajero
/// pierde el pedido sin avisar.
Future<void> confirmDiscardPosOrder(BuildContext context, WidgetRef ref) async {
  final DialogAction action = await ConfirmDialog.show(
    context,
    title: '¿Descartar el pedido en curso?',
    message: 'Se borran los productos que llevas y el pedido NO se registra en el '
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
