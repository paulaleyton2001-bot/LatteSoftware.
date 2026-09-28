// Resultados de operaciones de autenticación que NO devuelven un recurso.
//
// Los endpoints `forgot-password`, `reset-password`, `change-password`,
// `logout` y `logout-all` responden `data: null` (API.md §7.1). La UI necesita
// igual saber qué pasó para confirmar o reenviar, así que esos casos se
// modelan aquí en vez de con `void` + `bool`.

import 'package:flutter/foundation.dart';

/// Resultado de una acción de autenticación sin recurso de retorno.
///
/// Los errores por campo NO viven aquí: viajan en el `Failure` que produce la
/// operación fallida, y los formularios los leen con `fieldErrorsOf`. Este tipo
/// solo modela el ÉXITO (mensaje en español + qué acción se completó), que es
/// justo lo que un `data: null` del backend no devuelve.
@immutable
class AuthResult {
  const AuthResult({required this.message});

  /// Estado inicial: todavía no se hizo nada. Permite distinguir "sin ejecutar"
  /// de "ejecutado y correcto" en un `AsyncValue<AuthResult>`.
  const AuthResult.idle() : message = '';

  /// Texto en español, apto para mostrar tal cual.
  final String message;

  /// `true` si la operación terminó bien.
  bool get isSuccess => message.isNotEmpty;

  @override
  bool operator ==(Object other) =>
      identical(this, other) || other is AuthResult && other.message == message;

  @override
  int get hashCode => message.hashCode;

  @override
  String toString() => 'AuthResult($message)';
}

/// Una sesión activa del usuario según `GET /auth/sessions`.
///
/// No es lo mismo que `AuthSession`: esta es la FILA de la lista de
/// dispositivos (la sesión "actual" viene marcada con `isCurrent`), mientras que
/// `AuthSession` son los tokens de ESTA ejecución.
@immutable
class AuthDeviceSession {
  const AuthDeviceSession({
    required this.id,
    required this.isCurrent,
    this.deviceInfo,
    this.ipAddress,
    this.createdAt,
    this.expiresAt,
  });

  /// `id` de `refresh_tokens.id`. Es el `sid` del access token (API.md §11.2).
  final int id;

  /// `true` si es la sesión con la que está conectado este dispositivo.
  final bool isCurrent;

  /// Descripción del dispositivo que registró el backend.
  final String? deviceInfo;

  final String? ipAddress;
  final DateTime? createdAt;
  final DateTime? expiresAt;

  /// Etiqueta corta y legible para la lista de sesiones.
  String get label {
    final String? info = deviceInfo?.trim();
    if (info != null && info.isNotEmpty) return info;
    if (ipAddress != null && ipAddress!.isNotEmpty) {
      return 'Sesión en $ipAddress';
    }
    return 'Sesión sin dispositivo identificado';
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is AuthDeviceSession &&
          other.id == id &&
          other.isCurrent == isCurrent &&
          other.deviceInfo == deviceInfo &&
          other.ipAddress == ipAddress;

  @override
  int get hashCode => Object.hash(id, isCurrent, deviceInfo, ipAddress);

  @override
  String toString() => 'AuthDeviceSession($id, current: $isCurrent)';
}
