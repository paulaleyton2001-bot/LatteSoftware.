// ¿Se puede cobrar ahora mismo, y si no, POR QUÉ NO?
//
// ─────────────────────────────────────────────────────────────────────────────
// EL BOTÓN QUE NO HACÍA NADA Y DE DÓNDE SALÍA EL CORTOCIRCUITO
// ─────────────────────────────────────────────────────────────────────────────
// El botón «Cobrar alquiler» del panel de cobro se HABILITABA (el carrito vacío es
// legal en un alquiler: el backend acepta `items: []` para `CHAIR_RENTAL`), y al
// pulsarlo no pasaba nada. No era un fallo de red ni de estado: el flujo se
// cortaba en dos sitios distintos, y los dos cortaban por la MISMA razón:
//
//   · `pos_page.dart::_runChargeFlow` — `if (posLines.isEmpty) return;`
//   · `pos_charge_flow.dart::run`       — `if (lines.isEmpty) return false;`
//
// Los dos cuts eran correctos para un pedido de CONSUMO (no hay nada que cobrar
// sin productos) y falsos para un pedido de ALQUILER, que por definición no
// lleva líneas: el backend PROHÍBE mezclarlas (`422 MIXED_ORDER_TYPE_NOT_ALLOWED`,
// BR-ORDER-012). Es decir, el flujo correcto de alquiler SIEMPRE tiene el carrito
// vacío, y el cortocircuito lo mataba justo en el único caso en que debía pasar.
// El panel, mientras tanto, decía que sí se podía cobrar: de ahí el botón que se
// ve habilitado y no hace nada, que es la peor forma de botón muerto.
//
// ─────────────────────────────────────────────────────────────────────────────
// POR QUÉ UN MÓDULO NUEVO Y NO UN `if` MÁS
// ─────────────────────────────────────────────────────────────────────────────
// «¿Se puede cobrar?» estaba decidido en tres sitios (el panel, la pantalla y el
// flujo) y solo uno estaba actualizado. Por eso, en cuanto uno de los tres se
// queda atrás, el botón miente. Aquí la decisión vive en UN sitio —[Provider]
// posChargeGateProvider— y los tres la LEEN, de modo que no pueden discrepar:
// si el panel pinta el botón habilitado, el flujo cobra; y si el flujo se
// negaría, el panel lo pinta apagado con el motivo al lado.
//
// El motivo (`PosChargeBlocked.reason`) es lo que hace que el botón no sea
// ambiguo: no dice «no», dice QUÉ HACE FALTA. Un botón apagado sin explicación
// es indistinguible de uno roto.
//
// QUÉ ES Y QUÉ NO ES
// Esto NO decide el resultado del cobro, ni toca la red, ni crea el pedido: solo
// traduce (borrador + carrito) a «sí se puede» o «no, y por esto». El trabajo de
// verdad —`POST /orders`, `POST /payments`, limpieza— sigue en
// `widgets/pos_charge_flow.dart`.

import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/customer/cart_state.dart';
import '../domain/entities/pos_draft.dart';
import 'pos_cart_controller.dart';
import 'pos_controller.dart';

/// Veredicto de "¿se cobra esto ahora mismo?".
///
/// Jerarquía sellada: los `switch` sobre ella son exhaustivos y no hay un tercer
/// caso que alguien pueda añadir sin que el compilador lo señale.
sealed class PosChargeGate {
  const PosChargeGate();

  /// `true` si NO se puede cobrar. Lo lee el panel para pintar el botón apagado
  /// con su motivo, y la pantalla para explicar por qué no ocurrió nada.
  bool get isBlocked => this is PosChargeBlocked;
}

/// Se puede cobrar. [isRental] distingue los dos caminos del botón.
final class PosChargeAllowed extends PosChargeGate {
  const PosChargeAllowed({required this.isRental});

  /// `true` si lo que se cobra es un alquiler de silla (pedido `CHAIR_RENTAL`
  /// con `items: []`, sin líneas de producto).
  final bool isRental;
}

/// No se puede cobrar todavía. [reason] dice QUÉ HACE FALTA, no qué falta.
final class PosChargeBlocked extends PosChargeGate {
  const PosChargeBlocked(this.reason);

  /// Explicación accionable para el cajero.
  final String reason;
}

/// La decisión, derivada del borrador y del carrito.
///
/// ES UN `Provider` Y NO UN `if` EN EL WIDGET por una razón concreta: el flujo de
/// cobro se dispara desde TRES sitios distintos —el botón grande del panel, el
/// `FAB` del móvil y el atajo `Enter`—, y cada uno necesita la misma respuesta.
/// Con el `if` duplicado, uno de los tres acaba desatrasizado y ese es
/// exactamente el botón muerto que se reportó.
///
/// El orden de las comprobaciones NO es arbitrario:
///
///   1. **Falta el montaje del borrador** (silla, reserva o alquiler sin
///      arrancar). Se comprueba primero porque es lo que produce el peor
///      resultado si se deja pasar: sin alquiler `ACTIVE`, `POST /orders` SÍ
///      acepta el pedido `CHAIR_RENTAL` pero lo crea con `totalMinor = 0`, y
///      cobrar eso es cobrar cero por una hora de silla. El motivo sale de
///      [PosDraft.blockingReason], que ya está redactado como acción.
///   2. **Consumo sin productos**. Un alquiler NO entra aquí: `items: []` es un
///      pedido de alquiler perfectamente válido, y es el caso que el
///      cortocircuito anterior mataba.
final Provider<PosChargeGate> posChargeGateProvider = Provider<PosChargeGate>(
  (Ref ref) {
    final PosDraft draft = ref.watch(posDraftProvider);
    final List<CartLine> lines = ref.watch(posLinesProvider);

    // 1. Silla / reserva / alquiler arrancado.
    final String? setup = draft.blockingReason;
    if (setup != null) return PosChargeBlocked(setup);

    // 2. Consumo sin nada que cobrar. El alquiler se queda fuera a propósito.
    if (lines.isEmpty && !draft.isChairRental) {
      return const PosChargeBlocked(
        'No hay nada que cobrar: toca un producto del catálogo o escribe su '
        'nombre en el buscador. Si lo que quieres es cobrar solo el alquiler, '
        'cambia el tipo a «Alquiler de silla».',
      );
    }

    return PosChargeAllowed(isRental: draft.isChairRental);
  },
  name: 'posChargeGate',
);
