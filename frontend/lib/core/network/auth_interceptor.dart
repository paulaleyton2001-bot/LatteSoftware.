// Interceptor de autenticación: inyecta el Bearer y resuelve el 401.
//
// QUÉ HACE
//  1. Antes de cada request: si la ruta es pública (API.md §2) no toca nada; si
//     el access token caduca dentro de `AppConfig.tokenRefreshLeeway`, delega
//     la renovación proactiva a [SessionRefresher] y continúa.
//  2. Ante un 401: delega la renovación, reintenta la petición ORIGINAL una
//     única vez y, si falla, borra la sesión y avisa a la UI.
//
// POR QUÉ NO HAY UN REFRESH AQUÍ DENTRO
// La renovación vive en [SessionRefresher], una clase aparte, por dos motivos:
// el single-flight necesita una ranura compartida comprobable en aislamiento, y
// así el interceptor no tiene que saber nada de `POST /auth/refresh`.
//
// LÍMITES DE BUCLES (esto es lo que hace que sea seguro)
//  - `extra['authRetry']`: la petición ya se reintentó. Un segundo 401 pasa
//    directo a la UI sin refrescar otra vez.
//  - `extra['authSkip']`: la petición viene de la propia renovación (o de otro
//    interceptor) y se respeta tal cual, sin Bearer y sin refresh.
//  - El reintento usa `dio.fetch`, que vuelve a pasar por toda la cadena: el
//    presupuesto de reintentos es el de esa pasada, no se acumula con el
//    anterior.

import 'package:dio/dio.dart';

import '../config/app_config.dart';
import '../storage/token_storage.dart';
import 'api_endpoints.dart';
import 'session_refresher.dart';

/// Callback invocado cuando la sesión ya no es recuperable.
typedef SessionLostCallback = void Function();

/// Interceptor de sesión. Solo inyecta dependencias; no crea ninguna.
class AuthInterceptor extends Interceptor {
  AuthInterceptor({
    required Dio dio,
    required TokenStorage storage,
    required SessionLostCallback onSessionLost,
    SessionRefresher? refresher,
  })  : _dio = dio,
        _storage = storage,
        _onSessionLost = onSessionLost,
        _refresher = refresher ?? SessionRefresher(dio: dio, storage: storage);

  /// El mismo `Dio` de la app: se usa para reintentar la petición original.
  final Dio _dio;
  final TokenStorage _storage;
  final SessionLostCallback _onSessionLost;
  final SessionRefresher _refresher;

  // ------------------------------------------------------------------ Request
  @override
  Future<void> onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) async {
    // Petición marcada: se respeta tal cual, sin Bearer ni renovación.
    if (options.extra[_kSkipAuth] == true ||
        ApiEndpoints.isPublicPath(options.path)) {
      handler.next(options);
      return;
    }

    if (await _storage.needsRefresh(AppConfig.tokenRefreshLeeway)) {
      // Proactivo (API.md §2). Si falla, se sigue adelante: un 401 posterior
      // vuelve a intentarlo por la vía reactiva y, si tampoco está, la UI recibe
      // `UnauthorizedFailure` y manda al login.
      await _refresher.refresh();
    }

    final String? token = (await _storage.read())?.accessToken;
    if (token != null && token.isNotEmpty) {
      options.headers[_kAuthorization] = 'Bearer $token';
    }
    handler.next(options);
  }

  // ------------------------------------------------------------------- Error
  @override
  Future<void> onError(
    DioException err,
    ErrorInterceptorHandler handler,
  ) async {
    final RequestOptions request = err.requestOptions;
    final bool recoverable = err.response?.statusCode == 401 &&
        request.extra[_kSkipAuth] != true &&
        request.extra[_kRetry] != true &&
        !ApiEndpoints.isPublicPath(request.path);

    if (!recoverable) {
      handler.next(err);
      return;
    }

    // Una sola vuelta por petición: a partir de aquí no hay segundo refresh.
    request.extra[_kRetry] = true;
    final StoredSession? session = await _refresher.refresh();
    if (session == null) {
      await _dropSession();
      handler.next(err);
      return;
    }

    try {
      request.headers[_kAuthorization] = 'Bearer ${session.accessToken}';
      final Response<dynamic> response = await _dio.fetch<dynamic>(request);
      handler.resolve(response);
    } on DioException catch (retryError) {
      // El reintento volvió a fallar: se entrega el error y la UI decide.
      if (retryError.response?.statusCode == 401) await _dropSession();
      handler.next(retryError);
    } on Object {
      handler.next(err);
    }
  }

  // ----------------------------------------------------------------- Privados
  /// Borra la sesión local y avisa a la UI. Idempotente.
  Future<void> _dropSession() async {
    await _storage.clear();
    _onSessionLost();
  }

  static const String _kAuthorization = 'Authorization';
  static const String _kSkipAuth = 'authSkip';
  static const String _kRetry = 'authRetry';
}
