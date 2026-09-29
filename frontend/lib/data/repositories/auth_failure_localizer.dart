// Traducción de códigos de auth a mensajes del vocabulario de la app.
//
// `docs/API.md` §7.1 obliga al backend a responder con mensajes GENÉRICOS en
// login (`INVALID_CREDENTIALS`, exista o no el correo) y a no revelar existencia
// en `forgot-password`. Este archivo traduce esos códigos a frases que la app
// puede mostrar sin filtrar información y sin dejar el texto técnico del
// servidor a la vista.
//
// Solo interviene cuando el mensaje del backend es insuficiente; si el backend
// ya dio un mensaje útil (es lo normal), se conserva.
import '../../core/error/failures.dart';


/// Aplica el vocabulario de la app a un fallo de autenticación.
Failure localizeAuthFailure(Failure failure) {
  return switch (failure) {
    // 401 en login: el backend no dice si el correo existe. Tampoco la app.
    UnauthorizedFailure(code: 'AUTHENTICATION_ERROR')
        when failure.message.contains('credencial') =>
      UnauthorizedFailure(
        message: 'El correo o la contraseña no son correctos.',
        code: 'INVALID_CREDENTIALS',
        requestId: failure.requestId,
      ),

    // 409 `EMAIL_TAKEN` al registrarse: es la única forma segura de ofrecer
    // "inicia sesión" en lugar de un error seco.
    ConflictFailure(code: final String? code) when code == 'EMAIL_TAKEN' =>
      ConflictFailure(
        message: 'Ese correo ya tiene una cuenta. Inicia sesión o recupera tu '
            'contraseña.',
        code: code,
        requestId: failure.requestId,
      ),

    // 400 `INVALID_RESET_TOKEN`: el enlace caducó o ya se usó.
    ValidationFailure(code: final String? code) when code == 'INVALID_RESET_TOKEN' =>
      ValidationFailure(
        message: 'El enlace no es válido o ya expiró. Pide uno nuevo.',
        code: code,
        fieldErrors: failure.fieldErrors,
        requestId: failure.requestId,
      ),

    // 400 `PASSWORD_TOO_WEAK` y familia: la política la define el backend.
    ValidationFailure(code: final String? code)
        when code != null && code.startsWith('PASSWORD') =>
      ValidationFailure(
        message: 'La contraseña no cumple la política: entre 8 y 72 caracteres, '
            'con al menos una letra y un número.',
        code: code,
        fieldErrors: failure.fieldErrors,
        requestId: failure.requestId,
      ),

    // 422 `PASSWORD_SAME_AS_CURRENT`.
    BusinessRuleFailure(code: final String? code)
        when code == 'PASSWORD_SAME_AS_CURRENT' =>
      BusinessRuleFailure(
        message: 'La nueva contraseña debe ser distinta de la actual.',
        code: code,
        fieldErrors: failure.fieldErrors,
        requestId: failure.requestId,
      ),

    // El resto pasa intacto: el mensaje del backend ya es apto para el usuario.
    _ => failure,
  };
}
