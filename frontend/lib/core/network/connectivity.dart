// Detección de conectividad sin dependencias extra.
//
// `connectivity_plus` (y similares) se descartan a propósito: añaden un
// plugin nativo por plataforma para resolver una pregunta que ya podemos
// responder con dos fuentes que ya tenemos:
//
//   1. `InternetAddress.lookup` (DNS) — barato, sin paquete nativo.
//   2. El propio error de red de `dio` — la fuente de verdad: el backend puede
//      estar caído aunque haya DNS.
//
// Regla de uso: la conectividad es una PISTA, no una verdad. Un `true` no
// garantiza que la API responda; un `false` solo sirve para no intentar una
// lectura que va a fallar y para clasificar el error como `OfflineFailure`.

import 'dart:io';

import 'package:flutter/foundation.dart';

/// Sonda de conectividad.
class Connectivity {
  const Connectivity();

  /// Host usado para la resolución DNS. No se consulta nada: solo se resuelve.
  static const String _probeHost = 'example.com';

  /// Tiempo máximo de la sonda. Corto a propósito: si el DNS tarda más que
  /// eso, el usuario ya está esperando demasiado.
  static const Duration _probeTimeout = Duration(seconds: 4);

  /// `true` si el dispositivo resuelve nombres de dominio ahora mismo.
  ///
  /// En web no hay DNS desde Dart: `InternetAddress` lanza `UnsupportedError`.
  /// Ahí se devuelve `true` y deja que el error real de la petición decida
  /// (degradación elegante en vez de un falso "estás sin conexión").
  Future<bool> isOnline() async {
    if (kIsWeb) return true;
    try {
      final List<InternetAddress> result = await InternetAddress
          .lookup(_probeHost)
          .timeout(_probeTimeout);
      return result.isNotEmpty;
    } on Object {
      return false;
    }
  }

  /// `true` si la sonda dice que no hay red. Complemento de [isOnline] para
  /// escribir las condiciones en positivo/negativo según convenga.
  Future<bool> isOffline() async => !(await isOnline());
}
