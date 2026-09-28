// Notificador que conecta el estado de sesión con la navegación.
//
// `go_router` reevalúa sus `redirect` cuando su `refreshListenable` notifica.
// Sin esto, el usuario inicia sesión y la URL no cambia sola: tendría que
// reiniciar la app para salir del login.
//
// Es un `ChangeNotifier` y no un provider de Riverpod porque `go_router` espera
// un `Listenable`. La conexión con la sesión se hace en `app/router.dart`.

import 'package:flutter/foundation.dart';

/// Emite una notificación cuando el estado de autenticación cambia.
class RouterRefreshNotifier extends ChangeNotifier {
  /// Notifica a `go_router` que debe reevaluar los `redirect`.
  void refresh() {
    if (_disposed) return;
    notifyListeners();
  }

  bool _disposed = false;

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}
