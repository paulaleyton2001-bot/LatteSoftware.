// Fábrica del cliente HTTP. Un único `Dio` para toda la app.
//
// La cadena de interceptores está en ORDEN DE ENTRADA, y se recorre al revés al
// volver la respuesta:
//
//   1. `LogInterceptor`      — ver el tráfico en debug (redactado).
//   2. `RetryInterceptor`    — reintenta `GET` con backoff.
//   3. `AuthInterceptor`     — inyecta el Bearer y resuelve el 401.
//
// El de autenticación va el ÚLTIMO a propósito: así es el primero en ver la
// respuesta, resuelve el 401 antes de que el reintento la vea, y su reintento
// posterior (`dio.fetch`) vuelve a pasar por toda la cadena con presupuesto
// propio. Un `5xx` en la respuesta final del POST sí lo reintenta el
// interceptor de reintento, como corresponde a la política de la API.
//
// Timeouts diferenciados desde `AppConfig`: conectar 10 s (una red móvil mala no
// debe dejar el spinner eternamente), enviar 20 s y recibir 20 s.


// `dio` también trae un `LogInterceptor`: se oculta el de `dio` para que el
// símbolo sea inequívoco y quede claro cuál de los dos se usa (el de la app,
// que redacta secretos).
import 'package:dio/dio.dart' hide LogInterceptor;
import 'package:flutter/foundation.dart' show kDebugMode;

import '../config/app_config.dart';
import '../storage/token_storage.dart';
import './auth_interceptor.dart';
import './log_interceptor.dart';
import './retry_interceptor.dart';

/// Construye el `Dio` de la app a partir de la configuración de compilación.
///
/// Se inyecta el almacenamiento y el callback de "sesión perdida" para que este
/// archivo no conozca la API ni el repositorio: la capa de red solo sabe hablar
/// HTTP. El refresco de token NO se inyecta: lo hace el propio
/// `AuthInterceptor` llamando a `POST /auth/refresh` con este mismo `Dio`
/// (inyectar el repositorio aquí crearía un ciclo
/// interceptor → repositorio → datasource → interceptor).
Dio createApiClient({
  required TokenStorage tokenStorage,
  required SessionLostCallback onSessionLost,
}) {
  final Dio dio = Dio(
    BaseOptions(
      baseUrl: AppConfig.apiBaseUrl,
      contentType: Headers.jsonContentType,
      responseType: ResponseType.json,
      connectTimeout: const Duration(seconds: AppConfig.connectTimeoutSeconds),
      sendTimeout: const Duration(seconds: AppConfig.sendTimeoutSeconds),
      receiveTimeout: const Duration(seconds: AppConfig.receiveTimeoutSeconds),
      // `validateStatus: false` es el default de dio: cualquier `4xx`/`5xx`
      // lanza `DioException` y lo traduce `core/error/error_mapper.dart`.
      headers: <String, dynamic>{
        Headers.contentTypeHeader: Headers.jsonContentType,
        Headers.acceptHeader: Headers.jsonContentType,
      },
    ),
  );

  dio.interceptors.addAll(<Interceptor>[
    if (kDebugMode) const LogInterceptor(),
    RetryInterceptor(dio: dio),
    AuthInterceptor(
      dio: dio,
      storage: tokenStorage,
      onSessionLost: onSessionLost,
    ),
  ]);

  return dio;
}

/// Desenvuelve el envoltorio `{ success, data, meta }` de `docs/API.md` §3.1.
///
/// `Dio` entrega `response.data` con esa forma y los repositorios necesitan
/// `data`. Cuando `data` es `null` (acciones sin retorno, p. ej. `logout`) se
/// devuelve el mapa vacío en vez de `null`, para que la firma pueda ser
/// `Result<T>` con `T` no nulable. Un `data` que fuera lista (error de
/// contrato) llega envuelto bajo `items` para no perder la información.
Map<String, dynamic> unwrapData(Object? responseData) {
  if (responseData is! Map<String, dynamic>) return const <String, dynamic>{};
  final Object? data = responseData['data'];
  if (data is Map<String, dynamic>) return data;
  if (data is List) return <String, dynamic>{'items': data};
  return const <String, dynamic>{};
}

/// Igual que [unwrapData] pero para colecciones: `data` viene como array.
List<Map<String, dynamic>> unwrapList(Object? responseData) {
  final Object? data =
      responseData is Map<String, dynamic> ? responseData['data'] : null;
  if (data is! List) return const <Map<String, dynamic>>[];
  return data.whereType<Map<String, dynamic>>().toList(growable: false);
}
