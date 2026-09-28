// Renovación del refresh token con patrón SINGLE-FLIGHT.
//
// Por qué es una clase y no una método suelto del interceptor: el
// single-flight necesita UNA sola ranura compartida entre todas las peticiones
// en vuelo, y a la vez ser comprobable en isolation. En una clase, `refresh()`
// es el punto único de entrada y `inFlight` es el estado compartido.
//
// EL PROBLEMA QUE RESUELVE
// -------------------------
// API.md §2: cada `POST /auth/refresh` rota el token y REVOCA el anterior. Si
// tres peticiones reciben un 401 a la vez (menú + negocio + sillas, lo normal en
// el arranque del POS) y cada una refresca por su cuenta, la segunda ya reutiliza
// un token revocado: el backend lo detecta como REUSE y revoca TODAS las
// sesiones del usuario. El usuario pierde el turno entero por un bug de
// concurrencia del cliente.
//
// MECANISMO (5 líneas)
// --------------------
//  1. `inFlight` guarda el `Future` de la renovación en curso.
//  2. `refresh()` lee la ranura: si hay `Future`, lo devuelve y no crea otro.
//  3. Si está libre, crea el `Future` y lo ASIGNA de forma síncrona, antes de
//     cualquier `await`: así ninguna otra llamada puede colarse.
//  4. `whenComplete` libera la ranura tanto en éxito como en error, para que un
//     fallo no deje la sesión bloqueada para siempre.
//  5. Nunca lanza: un fallo se traduce en `null` y el llamador decide.

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

import '../storage/token_storage.dart';
import 'api_endpoints.dart';

/// Ejecuta `POST /auth/refresh` como máximo una vez a la vez.
class SessionRefresher {
  SessionRefresher({required Dio dio, required TokenStorage storage})
      : _dio = dio,
        _storage = storage;

  final Dio _dio;
  final TokenStorage _storage;

  /// Renovación en curso, o `null`.
  Future<StoredSession?>? _inFlight;

  /// `true` mientras hay una renovación en vuelo. Para diagnóstico.
  bool get isRefreshing => _inFlight != null;

  /// Devuelve la sesión rotada, o `null` si no se pudo renovar.
  ///
  /// Varias llamadas concurrentes comparten UN único `Future`.
  Future<StoredSession?> refresh() {
    final Future<StoredSession?>? pending = _inFlight;
    if (pending != null) return pending;

    final Future<StoredSession?> started = _run();
    _inFlight = started;
    return started.whenComplete(() {
      if (identical(_inFlight, started)) _inFlight = null;
    });
  }

  Future<StoredSession?> _run() async {
    try {
      final StoredSession? current = await _storage.read();
      final String? refreshToken = current?.refreshToken;
      if (refreshToken == null || refreshToken.isEmpty) return null;

      final StoredSession rotated =
          await _rotate(refreshToken, previous: current!);
      await _storage.save(rotated);
      return rotated;
    } on Object catch (error, stack) {
      if (kDebugMode) {
        debugPrint('[auth] refresh falló: $error\n$stack');
      }
      return null;
    }
  }

  /// `POST /auth/refresh` con la cadena de sesión DESACTIVADA (`authSkip`), para
  /// que un 401 aquí no dispare otro refresh ni se adjunte un Bearer caducado.
  Future<StoredSession> _rotate(
    String refreshToken, {
    required StoredSession previous,
  }) async {
    final Response<dynamic> response = await _dio.post<dynamic>(
      ApiEndpoints.authRefresh,
      data: <String, dynamic>{'refreshToken': refreshToken},
      options: Options(extra: <String, dynamic>{'authSkip': true}),
    );

    final Map<String, dynamic> body = _bodyOf(response.data);
    final Object? access = body['accessToken'];
    final Object? refresh = body['refreshToken'];
    if (access is! String || refresh is! String) {
      throw const FormatException('Refresh sin tokens en la respuesta.');
    }

    return StoredSession(
      accessToken: access,
      refreshToken: refresh,
      expiresAt: DateTime.now().toUtc().add(
        Duration(seconds: _expiresInSeconds(body['expiresIn'])),
      ),
      // El refresh NO devuelve perfil: se conserva el actor ya cacheado.
      userJson: previous.userJson,
    );
  }

  /// Desenvuelve `{ success, data }` y tolera un `data` plano.
  static Map<String, dynamic> _bodyOf(Object? responseData) {
    if (responseData is! Map<String, dynamic>) return const <String, dynamic>{};
    final Object? data = responseData['data'];
    if (data is Map<String, dynamic>) return data;
    return responseData;
  }

  /// `expiresIn` en segundos; si falta se usa el TTL del contrato (900 s) para
  /// que la renovación proactiva siga siendo razonable.
  static int _expiresInSeconds(Object? raw) {
    if (raw is int && raw > 0) return raw;
    if (raw is num && raw > 0) return raw.toInt();
    return 900;
  }
}
