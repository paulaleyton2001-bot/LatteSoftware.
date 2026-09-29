// Puente entre `DioException` (el mundo de `dio`) y `Failure` (el mundo de la UI).
//
// Existe UNA sola taxonomía de errores: `core/error/failures.dart`. Este archivo
// no crea fallos nuevos ni reescribe mensajes: solo desenvuelve la excepción,
// saca el cuerpo JSON de la respuesta y se la entrega a `ErrorMapper`, que es
// el ÚNICO lugar que conoce los códigos de `docs/API.md` §4.
//
// Uso típico en un repositorio:
// ```dart
// try {
//   final response = await datasource.login(email: email);
//   return Success(response.data!);
// } on DioException catch (error) {
//   return FailureResult(ApiException.toFailure(error));
// } on Object catch (error) {
//   return FailureResult(ApiException.toUnknown(error));
// }
// ```
//
// `DioException` es la ÚNICA excepción que la capa de datos deja pasar; todo lo
// demás se normaliza aquí.


import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart' show kDebugMode;

import '../error/error_mapper.dart';
import '../error/failures.dart';

/// Adaptador `dio` → dominio. Sin estado y sin dependencias de Flutter.
abstract final class ApiException {
  const ApiException._();

  /// Traduce cualquier excepción de red a un [Failure] presentable.
  ///
  /// Es `catch (Object)` a propósito: una excepción inesperada dentro de un
  /// interceptor (bug de cliente) no debe dejar la pantalla en blanco, debe
  /// terminar en `UnknownFailure` con detalle técnico en debug.
  static Failure toFailure(Object error) => switch (error) {
        final DioException dio => ErrorMapper.fromDioException(dio),
        final Failure failure => failure,
        _ => ErrorMapper.fromException(error),
      };

  /// Fallo genérico con traza técnica, para excepciones que no son de red.
  static Failure toUnknown(Object error) => UnknownFailure(
        details: kDebugMode ? error.toString() : null,
      );

  /// `true` si [error] es una excepción de `dio` (no un `Failure` ya mapeado).
  static bool isDioError(Object error) => error is DioException;
}
