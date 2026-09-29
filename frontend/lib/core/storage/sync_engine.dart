// Motor de sincronización de la cola offline.
//
// Contrato que implementará la feature de POS: recorrer la cola en orden FIFO,
// enviar cada operación, quitar la que tuvo éxito y marcar o descartar la que
// falló definitivamente. Vive aparte de `OfflineQueue` (persistencia) para que
// la ESTRATEGIA de reintento no se mezcle con el ALMACÉN.


/// Resultado de una pasada de sincronización.
class SyncReport {
  const SyncReport({this.sent = 0, this.failed = 0, this.discarded = 0});

  /// Operaciones que el backend aceptó.
  final int sent;

  /// Operaciones que fallaron y quedan en cola para el siguiente intento.
  final int failed;

  /// Operaciones descartadas (idempotencia rota o caducadas sin reintento).
  final int discarded;

  @override
  String toString() =>
      'SyncReport(sent: $sent, failed: $failed, discarded: $discarded)';
}

/// Motor de sincronización. Nunca lanza: reporta.
abstract interface class SyncEngine {
  /// Envía las operaciones pendientes y devuelve el parte.
  Future<SyncReport> synchronize();

  /// `true` si hay una sincronización en curso (evita doble ejecución).
  bool get isRunning;
}

/// Motor explícitamente inerte.
///
/// Hoy la app todavía NO reintenta nada por su cuenta: la cola se llena y se
/// muestra el aviso de `OfflineState(pendingCount: n)`, pero el envío lo decide
/// el flujo de la feature de POS. Devolver un reporte vacío —y no "éxito con N
/// enviados"— deja el contrato explícito y evita que una UI prometa una
/// sincronización que no existe.
class NoopSyncEngine implements SyncEngine {
  const NoopSyncEngine();

  @override
  bool get isRunning => false;

  @override
  Future<SyncReport> synchronize() async => const SyncReport();
}
