// Objetos de entrada de autenticación (los "body" de `docs/API.md` §7.1).
//
// Son inmutables y solo contienen lo que la API acepta. La validación de
// formato vive en `core/utils/validators.dart` (feedback inmediato) y la de
// verdad es la del backend (`400 VALIDATION_ERROR`), que siempre gana.
//
// REGLA: si un campo aparece en `API.md` con un nombre, ese nombre es el del
// JSON. No se traducen claves: el mapeo por nombre es responsibility del
// datasource, no del dominio.

import 'package:flutter/foundation.dart';

/// Body de `POST /auth/register`.
@immutable
class RegisterRequest {
  const RegisterRequest({
    required this.email,
    required this.password,
    required this.fullName,
    this.phone,
  });

  /// Formato email, max 254. El backend lo normaliza a minúsculas.
  final String email;

  /// Min 8, max 72 (límite de bcrypt), al menos una letra y un número.
  final String password;

  /// Min 2, max 120.
  final String fullName;

  /// Opcional. Regex E.164 `^\+[1-9]\d{7,14}$`.
  final String? phone;

  Map<String, dynamic> toJson() => <String, dynamic>{
        'email': email,
        'password': password,
        'fullName': fullName,
        if (phone != null && phone!.isNotEmpty) 'phone': phone,
      };
}

/// Body de `POST /auth/login`.
@immutable
class LoginRequest {
  const LoginRequest({required this.email, required this.password});

  final String email;
  final String password;

  Map<String, dynamic> toJson() => <String, dynamic>{
        'email': email,
        'password': password,
      };
}

/// Body de `POST /auth/forgot-password`.
@immutable
class ForgotPasswordRequest {
  const ForgotPasswordRequest({required this.email});

  final String email;

  Map<String, dynamic> toJson() => <String, dynamic>{'email': email};
}

/// Body de `POST /auth/reset-password`.
///
/// `confirmPassword` SÍ viaja: `API.md` §7.1 lo exige, a diferencia de
/// `register`, donde la coincidencia es solo responsabilidad del cliente.
@immutable
class ResetPasswordRequest {
  const ResetPasswordRequest({
    required this.token,
    required this.password,
    required this.confirmPassword,
  });

  /// Token opaco de un solo uso, min 32, max 128.
  final String token;

  final String password;
  final String confirmPassword;

  Map<String, dynamic> toJson() => <String, dynamic>{
        'token': token,
        'password': password,
        'confirmPassword': confirmPassword,
      };
}

/// Body de `POST /auth/change-password`.
@immutable
class ChangePasswordRequest {
  const ChangePasswordRequest({
    required this.currentPassword,
    required this.newPassword,
    required this.confirmPassword,
    this.keepCurrentSession = true,
  });

  final String currentPassword;
  final String newPassword;
  final String confirmPassword;

  /// `true` (default del backend) conserva la sesión actual.
  final bool keepCurrentSession;

  Map<String, dynamic> toJson() => <String, dynamic>{
        'currentPassword': currentPassword,
        'newPassword': newPassword,
        'confirmPassword': confirmPassword,
        'keepCurrentSession': keepCurrentSession,
      };
}

/// Body de `PATCH /auth/me`. Al menos un campo (esquema `.strict()` del backend).
@immutable
class UpdateProfileRequest {
  const UpdateProfileRequest({
    this.fullName,
    this.phone,
    this.photoUrl,
  });

  final String? fullName;
  final String? phone;
  final String? photoUrl;

  /// `true` si no hay nada que enviar: llamar al endpoint así da `400`.
  bool get isEmpty =>
      (fullName == null || fullName!.isEmpty) &&
      (phone == null || phone!.isEmpty) &&
      (photoUrl == null || photoUrl!.isEmpty);

  Map<String, dynamic> toJson() => <String, dynamic>{
        if (fullName != null && fullName!.isNotEmpty) 'fullName': fullName,
        if (phone != null && phone!.isNotEmpty) 'phone': phone,
        if (photoUrl != null && photoUrl!.isNotEmpty) 'photoUrl': photoUrl,
      };
}
