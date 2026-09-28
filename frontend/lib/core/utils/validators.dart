// Validadores de entrada reutilizables.
//
// Son COMODIDAD, nunca seguridad: la validación de verdad es la del backend
// (esquemas zod `.strict()`, API.md §1). Sirven para no enviar un viaje de ida
// y vuelta por un `@` mal escrito y para dar feedback inmediato, pero la app
// jamás da por válido un campo solo porque el cliente lo aprobó.
//
// Todos devuelven `String?`: `null` = válido. El mensaje va en español y está
// redactado para el usuario final.

/// Expresión regular de email deliberadamente pragmática.
///
/// No implementa RFC 5322: el backend es la autoridad y un email technically
/// válido pero raro (localhost, IDN sin punycode) se rechaza mejor allí. Aquí
/// solo se atrapan los typos evidentes: falta de arroba, falta de dominio,
// espacios, doble arroba.
final RegExp _emailPattern = RegExp(
  r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9](?:[A-Za-z0-9\-]*[A-Za-z0-9])?"
  r"(?:\.[A-Za-z0-9](?:[A-Za-z0-9\-]*[A-Za-z0-9])?)+$",
);

/// Teléfono E.164: `+573001234567` (API.md §7.1).
final RegExp _phonePattern = RegExp(r'^\+[1-9]\d{7,14}$');

/// Catálogo de validaciones de formulario.
abstract final class Validators {
  const Validators._();

  /// Campo obligatorio (no solo espacios).
  static String? required(String? value, {String field = 'Este campo'}) {
    if (value == null || value.trim().isEmpty) return '$field es obligatorio.';
    return null;
  }

  /// Email con formato plausible. `null` si parece válido.
  static String? email(String? value, {bool required = true}) {
    final String trimmed = value?.trim() ?? '';
    if (trimmed.isEmpty) {
      return required ? 'Escribe tu correo electrónico.' : null;
    }
    if (trimmed.length > 254) return 'El correo es demasiado largo.';
    if (!_emailPattern.hasMatch(trimmed)) return 'Ese correo no parece válido.';
    return null;
  }

  /// Política de contraseña de `API.md` §7.1: 8–72 caracteres, al menos una
  /// letra y un número.
  ///
  /// 72 es el límite de bcrypt: es el backend el que trunca, y avisar aquí
  /// evita una contraseña que "se pierde un carácter" al guardarse.
  static String? password(String? value) {
    final String raw = value ?? '';
    if (raw.isEmpty) return 'Escribe tu contraseña.';
    if (raw.length < 8) {
      return 'La contraseña necesita al menos 8 caracteres.';
    }
    if (raw.length > 72) return 'La contraseña no puede superar 72 caracteres.';
    final bool hasLetter = RegExp('[A-Za-z]').hasMatch(raw);
    final bool hasDigit = RegExp('[0-9]').hasMatch(raw);
    if (!hasLetter || !hasDigit) {
      return 'La contraseña necesita al menos una letra y un número.';
    }
    return null;
  }

  /// Confirmación de contraseña. Solo compara: la política la evalúa
  /// [password] sobre el campo original.
  static String? passwordConfirmation(String? value, String original) {
    if (value == null || value.isEmpty) return 'Repite tu contraseña.';
    if (value != original) return 'Las contraseñas no coinciden.';
    return null;
  }

  /// Teléfono E.164. Opcional: con [required] en `false`, vacío es válido.
  static String? phoneE164(String? value, {bool required = false}) {
    final String trimmed = value?.trim() ?? '';
    if (trimmed.isEmpty) {
      return required ? 'Escribe tu teléfono.' : null;
    }
    if (!_phonePattern.hasMatch(trimmed)) {
      return 'Usa formato internacional, por ejemplo +573001234567.';
    }
    return null;
  }

  /// Longitud mínima genérica (nombre, razón, notas).
  static String? minLength(
    String? value, {
    required int min,
    String field = 'Este campo',
  }) {
    final String trimmed = value?.trim() ?? '';
    if (trimmed.isEmpty) return '$field es obligatorio.';
    if (trimmed.length < min) {
      return '$field necesita al menos $min caracteres.';
    }
    return null;
  }

  /// Contraseña actual obligatoria (cambio de contraseña).
  static String? currentPassword(String? value) =>
      required(value, field: 'La contraseña actual');
}
