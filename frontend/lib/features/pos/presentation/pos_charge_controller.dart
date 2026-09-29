// Cobro del mostrador: diálogo de pago y `POST /payments` con idempotencia.
//
// EL PROBLEMA QUE RESUELVE ESTE ARCHIVO
// `POST /payments` es el ÚNICO `POST` idempotente de la API y exige la cabecera
// `Idempotency-Key` (UUID v4). Sin ella responde `400 VALIDATION_ERROR` con
// `details.code = 'IDEMPOTENCY_KEY_REQUIRED'`. Además, un cobro nunca debe
// ejecutarse dos veces: si la respuesta se pierde por la red, el cajero no sabe
// si el servidor cobró o no, y reintentar a ciegas puede ser cobrar dos veces.
//
// LA ESTRATEGIA
// La clave se genera UNA VEZ cuando el cajero abre el diálogo y se CONSERVA
// mientras el mismo intento siga vivo (cambiar de método, corregir el monto,
// reintentar). Un cambio de método o de monto NO es un cobro nuevo: es el mismo
// intento, y por eso comparte clave. Solo un "nuevo pedido" genera una clave
// nueva, porque ahí sí hay otro cobro.
//
// Si el cobro se acepta, la respuesta trae `changeDueMinor` y el `balanceMinor`
// ya recalculado por el servidor; el cliente no calcula ninguno de los dos.
//
// SIN CONEXIÓN
// No hay pasarela ni cola que reenvíe sola (`NoopSyncEngine`). El POS NO inventa
// una sincronización: avisa de que está sin red y propone el cobro manual en la
// caja registradora. Perder la conexión no puede hacer perder la venta, pero
// tampoco se puede prometer que se registrará sola.

import 'dart:math';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/error/failures.dart';
import '../../../core/result/result.dart';
import '../domain/entities/pos_charge.dart';
import '../domain/repositories/pos_repository_models.dart';
import './pos_controller.dart';

/// Métodos de pago habilitados (`GET /payments/methods`).
final FutureProvider<List<PosPaymentMethodOption>> posPaymentMethodsProvider =
    FutureProvider<List<PosPaymentMethodOption>>(
  (Ref ref) async {
    final Result<List<PosPaymentMethodOption>> result =
        await ref.watch(posRepositoryProvider).paymentMethods();
    return switch (result) {
      Success<List<PosPaymentMethodOption>>(:final List<PosPaymentMethodOption> value) =>
        value,
      FailureResult<List<PosPaymentMethodOption>>(:final Failure failure) => throw failure,
    };
  },
  name: 'posPaymentMethods',
);

/// Estado del cobro en curso. Jerarquía sellada: los `switch` son exhaustivos.
sealed class PosChargeState {
  const PosChargeState();

  /// `true` mientras hay una petición en vuelo (el botón se deshabilita).
  bool get isBusy => this is PosChargeInFlight;

  /// Fallo de red del ÚLTIMO intento, si lo hubo.
  ///
  /// Un `NetworkFailure` en `POST /payments` es AMBIGUO (puede que el servidor
  /// sí lo recibiera). La UI no ofrece "reintentar con botón nuevo" sino
  /// "reintentar con la MISMA clave", que es seguro por idempotencia.
  Failure? get failure => switch (this) {
        PosChargeInFlight() || PosChargeSucceeded() => null,
        PosChargeFailed(:final Failure failure) => failure,
        PosChargeIdle() => null,
      };
}

/// El diálogo está abierto y no se ha enviado nada.
final class PosChargeIdle extends PosChargeState {
  const PosChargeIdle();
}

/// La petición está en vuelo. Guarda la clave usada, para poder reutilizarla.
final class PosChargeInFlight extends PosChargeState {
  const PosChargeInFlight(this.idempotencyKey);

  final String idempotencyKey;
}

/// El cobro se aceptó. [result] trae el cambio y el saldo, ya del servidor.
final class PosChargeSucceeded extends PosChargeState {
  const PosChargeSucceeded(this.result);

  final PosChargeResult result;
}

/// El cobro falló. [failure] explica por qué y si se puede reintentar.
final class PosChargeFailed extends PosChargeState {
  const PosChargeFailed(this.failure);

  final Failure failure;
}

/// Controlador del cobro de UNA orden.
///
/// `NotifierProvider` y no `autoDispose`: la clave de idempotencia debe SOBREVIVIR
/// a un cierre accidental del diálogo. Si el provider se destruyera al cerrarse,
/// el reintento generaría una clave nueva y el servidor trataría el reintento
/// como un segundo cobro.
final NotifierProvider<PosChargeController, PosChargeState> posChargeProvider =
    NotifierProvider<PosChargeController, PosChargeState>(PosChargeController.new);

/// Controlador del cobro. Un estado por sesión de mostrador.
class PosChargeController extends Notifier<PosChargeState> {
  String? _idempotencyKey;

  @override
  PosChargeState build() {
    ref.onDispose(() => _idempotencyKey = null);
    return const PosChargeIdle();
  }

  /// Clave de idempotencia del intento en curso.
  ///
  /// Se genera al abrir el diálogo y se reutiliza en todos los intentos del
  /// mismo cobro. [resetForNewCharge] es lo único que la regenera.
  String ensureIdempotencyKey() {
    return _idempotencyKey ??= newIdempotencyKey();
  }

  /// Prepara un cobro NUEVO (nueva orden o nuevo intento deliberado).
  void resetForNewCharge() {
    _idempotencyKey = null;
    state = const PosChargeIdle();
  }

  /// Envía `POST /payments` con la cabecera obligatoria.
  ///
  /// Devuelve `true` si el servidor aceptó (o respondió `idempotent: true`, que
  /// es el mismo resultado para el cajero).
  Future<bool> charge({
    required int orderId,
    required PosChargeRequest request,
  }) async {
    if (state.isBusy) return false;
    final String key = ensureIdempotencyKey();
    state = PosChargeInFlight(key);

    final Result<PosChargeResult> result = await ref
        .read(posRepositoryProvider)
        .charge(request: request, orderId: orderId, idempotencyKey: key);
    // Sin guarda de disposal: `posChargeProvider` no es `autoDispose`, así que el
    // notifier sobrevive al cobro.

    switch (result) {
      case Success<PosChargeResult>(:final PosChargeResult value):
        // El cobro se registró: la clave ya no sirve para nada más, y el pedido
        // y el tablero quedan desfasados.
        _idempotencyKey = null;
        ref.invalidate(posPaymentMethodsProvider);
        state = PosChargeSucceeded(value);
        return true;
      case FailureResult<PosChargeResult>(:final Failure failure):
        state = PosChargeFailed(failure);
        return false;
    }
  }

  /// Vuelve a `idle` después de que la UI haya mostrado el resultado.
  void acknowledge() => state = const PosChargeIdle();
}

/// Genera un UUID v4 sin dependencias externas.
///
/// `dart:math` da el azar y `DateTime.now()` da el reloj: la combinación es
/// suficiente para una clave de idempotencia, cuyo único requisito es que dos
/// intentos de cobro distintos NO compartan clave. No es criptográfico, y no
/// hace falta que lo sea: la clave viaja en la cabecera de una petición ya
/// autenticada y no protege ningún secreto.
///
/// (Añadir el paquete `uuid` sería la opción canónica, pero no se pueden meter
/// dependencias nuevas en `pubspec.yaml` en esta fase.)
String newIdempotencyKey() {
  final Random random = Random.secure();
  final List<int> bytes = List<int>.generate(16, (int _) => random.nextInt(256));
  // Versión 4 (byte 6: 0x40) y variante RFC 4122 (byte 8: 0x80..0xBF).
  bytes[6] = (bytes[6] & 0x0F) | 0x40;
  bytes[8] = (bytes[8] & 0x3F) | 0x80;
  String hex(int start, int end) => bytes
      .sublist(start, end)
      .map((int b) => b.toRadixString(16).padLeft(2, '0'))
      .join();
  return '${hex(0, 4)}-${hex(4, 6)}-${hex(6, 8)}-${hex(8, 10)}-${hex(10, 16)}';
}


