// Panel de cobro del mostrador: totales, silla y botón grande de cobro.
//
// ESTE ES EL PANEL QUE HACE QUE EL POS SEA "RÁPIDO"
// El botón de cobrar ocupa 56 dp de alto y el ancho completo: es el control que
// el cajero tiene que acertar con dos dedos y sin mirar. Todo lo demás cabe
// alrededor.
//
// EL TOTAL QUE SE MUESTRA ES EL DEL SERVIDOR
// Al cobrar se llama primero a `POST /orders`, que devuelve `totalMinor` y
// `balanceMinor` REALES (con impuestos, descuentos y cupón). El subtotal que se
// ve mientras se arma el pedido es solo una previsualización (BR-PRICE-008), y
// se rotula como tal para que nadie lo confunda con lo que se va a cobrar.
//
// EL COBRO NO ES UNA PASARELA
// El botón abre un diálogo de pago MANUAL (efectivo con cambio, o tarjeta con la
// referencia que anota el cajero). No hay redirección, no hay iframe y no se
// guarda ningún dato de tarjeta.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../core/customer/cart_state.dart';
import '../../../../core/customer/chair_map.dart';
import '../../../../core/customer/venue_providers.dart';
import '../../../../shared/constants/app_strings.dart';
import '../../../../shared/widgets/ui/app_button.dart';
import '../../../../shared/widgets/ui/price_display.dart';
import '../../domain/entities/pos_draft.dart';
import '../pos_cart_controller.dart';
import '../pos_charge_gate.dart';
import '../pos_controller.dart';
import './pos_chair_picker.dart';
import './pos_order_type_selector.dart';
import './pos_reservation_picker.dart';
import './pos_shortcut_hints.dart';
import './pos_walkin_rental_dialog.dart';

/// Panel derecho del POS: selector de tipo, silla, totales y cobro.
class PosCheckoutPanel extends ConsumerWidget {
  const PosCheckoutPanel({
    required this.onCharge,
    required this.onNewOrder,
    this.showShortcutHints = true,
    super.key,
  });

  /// Abre el diálogo de cobro. `Enter` en desktop lo dispara.
  final VoidCallback onCharge;

  /// Vacia el pedido y el borrador (`F2`).
  final VoidCallback onNewOrder;

  /// `true` en desktop, donde hay sitio para la fila de atajos.
  final bool showShortcutHints;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final PosDraft draft = ref.watch(posDraftProvider);
    final List<CartLine> lines = ref.watch(posLinesProvider);
    final int subtotal = ref.watch(posSubtotalMinorProvider);
    final bool empty = lines.isEmpty;
    // UN SOLO VEREDICTO PARA EL BOTÓN, LA PANTALLA Y EL FLUJO
    // Antes este widget decidía por su cuenta (`nothingToCharge`) y el flujo
    // decidía por la suya (`lines.isEmpty`). Los dos no coincidían y de ahí el
    // botón muerto: el panel lo pintaba habilitado para un alquiler con el carrito
    // vacío y el flujo se cortaba sin hacer nada. Ahora los tres leen
    // [posChargeGateProvider], así que o los tres dicen que sí o los tres dicen
    // que no. Ver `pos_charge_gate.dart` para el porqué de cada regla.
    final PosChargeGate gate = ref.watch(posChargeGateProvider);
    final bool blocked = gate is PosChargeBlocked;
    final bool isRental = draft.isChairRental;
    // Líneas del carrito que NO entran en este pedido: un alquiler no lleva
    // productos (BR-ORDER-012), así que si el cajero dejó algo en el carrito hay
    // que decírselo antes de que lo descubra al cobrar.
    final bool productsPending = !empty && isRental;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        const SizedBox(height: AppSpacing.md),
        const PosOrderTypeSelector(),
        const SizedBox(height: AppSpacing.md),
        if (draft.type.requiresChair)
          Expanded(child: _ChairSection(draft: draft))
        else
          const Expanded(child: SizedBox.shrink()),
        if (draft.type.requiresChair) ...<Widget>[
          // `PosOrderTypeHint` SE SUSTITUYE POR EL AVISO DEL VEREDICTO (abajo).
          // Los dos pintaban `draft.blockingReason`, así que el mismo texto salía
          // dos veces seguidas: era un aviso que se veía en el dispositivo y no
          // añadía información. Ahora hay UN aviso, y su texto es el del veredicto
          // que apaga el botón, de modo que no pueden contradecirse.
          if (draft.chairId != null) ...<Widget>[
            const _WalkInRentalAction(),
            const SizedBox(height: AppSpacing.sm),
          ],
          if (productsPending)
            // Líneas del carrito, no productos distintos: dos cafés iguales
            // son UNA línea, y el texto cuenta líneas para no mentir.
            PosRentalProductsNotice(lineCount: lines.length),
        ],
        _Totals(
          subtotalMinor: subtotal,
          isRental: isRental,
          rentalStarted: draft.hasStartedRental,
        ),
        // EL PORQUÉ DEL BOTÓN APAGADO, SIEMPRE VISIBLE
        // Un botón apagado sin explicación es indistinguible de uno roto, que es
        // lo que se reportó. El motivo viene del mismo veredicto que apaga el
        // botón, así que no puede decir una cosa el botón y otra el aviso.
        //
        // Se pinta para CUALQUIER bloqueo, no solo para el alquiler: el caso del
        // consumo sin productos también necesita su «por qué» al lado, o el
        // botón apagado parece un fallo.
        if (blocked) ...<Widget>[
          const SizedBox(height: AppSpacing.sm),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
            child: PosInlineNotice(
              icon: Icons.info_outline_rounded,
              text: (gate as PosChargeBlocked).reason,
            ),
          ),
        ],
        const SizedBox(height: AppSpacing.md),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
          child: AppButton(
            // LA ETIQUETA DICE QUÉ SE VA A COBRAR
            // Un botón que sirve para los dos caminos («Cobrar») no le dice al
            // cajero si va a pasar por caja el alquiler o el consumo, y con el
            // pulgar lleno y la caja llena esa duda es cara. Cada caso tiene su
            // texto: cobro de alquiler, cobro de consumo, y el de «todavía no».
            label: isRental
                ? 'Cobrar alquiler'
                : empty
                    ? 'Añade productos'
                    : AppStrings.chargeButton,
            icon: isRental
                ? Icons.event_seat_rounded
                : empty
                    ? Icons.shopping_basket_outlined
                    : Icons.payments_rounded,
            variant: AppButtonVariant.espresso,
            size: AppButtonSize.large,
            isFullWidth: true,
            onPressed: blocked ? null : onCharge,
            semanticLabel: blocked
                ? 'No se puede cobrar todavía: ${(gate as PosChargeBlocked).reason}'
                : isRental
                    ? 'Cobrar el alquiler de silla en curso'
                    : '${AppStrings.chargeButton} el pedido en curso',
            tooltip: blocked ? (gate as PosChargeBlocked).reason : '${AppStrings.shortcutCharge}: cobrar',
          ),
        ),
        const SizedBox(height: AppSpacing.sm),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
          child: AppButton(
            label: 'Nuevo pedido',
            icon: Icons.add_rounded,
            variant: AppButtonVariant.secondary,
            size: AppButtonSize.medium,
            isFullWidth: true,
            onPressed: onNewOrder,
            tooltip: '${AppStrings.shortcutNewOrder}: empezar un pedido vacío',
          ),
        ),
        if (showShortcutHints) ...<Widget>[
          const SizedBox(height: AppSpacing.md),
          const PosShortcutHintRow(),
        ],
        const SizedBox(height: AppSpacing.md),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
          child: Text(
            AppStrings.posNoGateway,
            textAlign: TextAlign.center,
            style: AppTextStyles.captionSmall
                .copyWith(color: context.tokens.textTertiary),
          ),
        ),
        const SizedBox(height: AppSpacing.md),
      ],
    );
  }
}

/// Acción de alquiler sin reserva, visible cuando ya hay silla elegida.
///
/// POR QUÉ SON TRES LLAMADAS Y NO UNA
/// `POST /rentals` a secas NO sirve: abre el alquiler, pero no crea el pedido
/// (se comprobó contra el backend, contra lo que dice `docs/API.md` §7.9), así
/// que el alquiler quedaría abierto, la silla `OCCUPIED` y sin nada que cobrar.
/// Encima `POST /orders` con `type = CHAIR_RENTAL` exige `reservationId`
/// (`422 RENTAL_REQUIRES_CHAIR_AND_RESERVATION`), o sea que un alquiler sin
/// reserva es incobrable por construcción. El camino real es crear la reserva,
/// confirmarla y arrancar el alquiler sobre ella; el `POST /orders` y el cobro
/// los hace después el flujo normal, en el mismo clic del botón grande.
///
/// LO QUE ESTE BOTÓN NO HACE
/// No cobra. Cobrar es el botón grande de abajo, que crea el pedido y registra
/// el pago. Aquí solo se deja el borrador con la reserva y el alquiler listos.
class _WalkInRentalAction extends ConsumerWidget {
  const _WalkInRentalAction();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final PosDraft draft = ref.watch(posDraftProvider);
    final AsyncValue<PosWalkInResult?> walkIn = ref.watch(posWalkInProvider);
    final int? chairId = draft.chairId;
    // Con el alquiler YA abierto el botón se oculta: pulsarlo otra vez abriría
    // una segunda reserva y un segundo alquiler sobre la misma silla, y el
    // backend respondería `409 CHAIR_OCCUPIED`. El cajero no tiene por qué
    // poder provocar ese error desde un botón que dice «abrir».
    if (chairId == null || draft.hasStartedRental) return const SizedBox.shrink();

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          AppButton(
            label: 'Abrir alquiler sin reserva',
            icon: Icons.meeting_room_rounded,
            variant: AppButtonVariant.secondary,
            size: AppButtonSize.small,
            isFullWidth: true,
            isLoading: walkIn.isLoading,
            onPressed: walkIn.isLoading
                ? null
                : () => _open(context, ref, chairId),
            tooltip: 'Abre la reserva y el alquiler para cobrarlo en un paso',
          ),
          // Estado de resultado y de error visibles junto al botón, sin cerrar
          // el panel: el cajero tiene que ver qué se creó y qué falta.
          if (walkIn.hasValue && walkIn.value != null)
            Padding(
              padding: const EdgeInsets.only(top: AppSpacing.xs),
              child: PosInlineNotice(
                icon: Icons.check_circle_outline_rounded,
                tone: PosNoticeTone.success,
                text: 'Alquiler ${walkIn.value!.summary} abierto. Ya puedes '
                    'cobrarlo.',
              ),
            ),
          if (walkIn.hasError)
            Padding(
              padding: const EdgeInsets.only(top: AppSpacing.xs),
              child: PosInlineNotice(
                icon: Icons.error_outline_rounded,
                tone: PosNoticeTone.error,
                text: posRentalFailureMessage(walkIn.error),
              ),
            ),
        ],
      ),
    );
  }

  Future<void> _open(BuildContext context, WidgetRef ref, int chairId) async {
    final AsyncValue<ChairMap> map = ref.read(venueMapProvider);
    final ChairInfo? chair = map.valueOrNull?.byId(chairId);
    if (chair == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('No se encontró la silla. Recarga el plano.'),
          behavior: SnackBarBehavior.floating,
        ),
      );
      return;
    }
    final int? minutes = await PosWalkInRentalDialog.show(context, chair);
    if (minutes == null || !context.mounted) return;
    final PosWalkInResult? rental = await ref
        .read(posWalkInProvider.notifier)
        .open(chairId: chairId, plannedMinutes: minutes);
    if (!context.mounted) return;
    if (rental == null) {
      // El error NO se limpia aquí. Este método se llama justo después de que
      // `PosWalkInController.open` lo dejara en `AsyncError`, así que
      // `acknowledge()` en este punto borraba el aviso rojo que se pinta junto al
      // botón: tras un `409 CHAIR_ALREADY_RESERVED` el cajero pulsaba «Abrir
      // alquiler», no veía NADA y el panel quedaba igual que antes, con la
      // impresión de que el botón no hace nada. Se limpia al cambiar de silla
      // (`PosDraftController.assignChair`), que es cuando el error deja de
      // aplicar, o al abrir un alquiler nuevo, que lo sobrescribe.
      final Object? error = ref.read(posWalkInProvider).error;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(posRentalFailureMessage(error)),
          behavior: SnackBarBehavior.floating,
          duration: const Duration(seconds: 6),
        ),
      );
    }
  }
}

/// Bloque de selección de silla y de su reserva, visible en `CHAIR_RENTAL`.
class _ChairSection extends ConsumerWidget {
  const _ChairSection({required this.draft});

  final PosDraft draft;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
          child: PosChairSummary(
            onClear: () => ref.read(posDraftProvider.notifier).clearChair(),
          ),
        ),
        // UN SOLO ÁREA DESPLAZABLE, no dos `Expanded` apilados
        // El plano tiene cinco zonas y no cabe en el hueco que sobra: con la
        // rejilla en su propio `Expanded` salía «BOTTOM OVERFLOWED BY 139
        // PIXELS», la franja amarilla tapaba el aviso y el selector de reservas
        // quedaba debajo de la pantalla. Un único scroll con mapa + reservas
        // dentro no puede desbordar (`Expanded` recorta lo que le sobra) y deja
        // las dos cosas alcanzables con el pulgar.
        Expanded(
          child: SingleChildScrollView(
            padding: const EdgeInsets.only(top: AppSpacing.sm),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                // EL ARREGLO BLOQUEANTE: `onPicked` NO ES OPCIONAL EN EL USO REAL
                // Antes esta línea era `const PosChairPicker()`, sin `onPicked`.
                // Con `onPicked == null`, `PosChairPicker` pasa `onSelect: null`
                // a `ChairMapGrid`, cuya documentación es literal: «`null` = el
                // mapa es de SOLO LECTURA (mirar no es elegir)». El plano se
                // pintaba perfecto y no aceptaba ni un toque: el cajero no podía
                // elegir silla, `assignChair` no llegaba a llamarse y todo el
                // flujo de alquiler quedaba muerto antes de empezar.
                PosChairPicker(onPicked: (_) {}),
                // Las reservas solo aparecen con silla: sin ella no hay nada
                // que reservar, y un provider con `chairId = 0` sería una
                // petición absurda al backend.
                if (draft.chairId case final int chairId) ...<Widget>[
                  const SizedBox(height: AppSpacing.md),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                    child: Text('Reserva del cliente', style: AppTextStyles.titleSmall),
                  ),
                  const SizedBox(height: AppSpacing.xs),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                    child: PosReservationPicker(chairId: chairId),
                  ),
                ],
              ],
            ),
          ),
        ),
      ],
    );
  }
}

/// Totales del pedido en curso.
///
/// El subtotal es una ESTIMACIÓN y se rotula así. El total real aparece después
/// de `POST /orders`, en el resumen que se muestra tras cobrar.
///
/// En un ALQUILER el subtotal del carrito no es lo que se cobra: el importe lo
/// calcula el servidor a partir del precio congelado de la silla y de los
/// minutos. Mostrar "$11.000" arriba del botón «Cobrar alquiler» haría pensar al
/// cajero que eso es lo que va a pasar por caja, así que aquí se dice otra cosa.
class _Totals extends StatelessWidget {
  const _Totals({
    required this.subtotalMinor,
    required this.isRental,
    required this.rentalStarted,
  });

  final int subtotalMinor;
  final bool isRental;

  /// `true` si el alquiler ya arrancó (`POST /rentals` hecho).
  final bool rentalStarted;

  @override
  Widget build(BuildContext context) {
    if (isRental) {
      return Padding(
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
        child: Text(
          rentalStarted
              ? 'El importe del alquiler lo calcula el servidor al cobrar.'
              : 'Abre el alquiler para que el servidor calcule su importe.',
          style: AppTextStyles.bodySmall
              .copyWith(color: context.tokens.textSecondary),
        ),
      );
    }
    if (subtotalMinor <= 0) {
      // Sin `const`: `TextStyle.copyWith` es una llamada a método y no puede ir
      // en una expresión constante. El `const` va en lo que sí lo es.
      return Padding(
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
        child: Text(
          'El total aparece al cobrar',
          style: AppTextStyles.bodySmall
              .copyWith(color: context.tokens.textSecondary),
        ),
      );
    }
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
      child: Row(
        children: <Widget>[
          Expanded(
            child: Text(
              'Subtotal estimado',
              style: AppTextStyles.bodyMedium
                  .copyWith(color: context.tokens.textSecondary),
            ),
          ),
          PriceDisplay(currentMinor: subtotalMinor, variant: PriceVariant.large),
        ],
      ),
    );
  }
}
