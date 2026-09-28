// Formateo de moneda.
//
// CONTRATO CON EL BACKEND (docs/API.md §6.1 y `/meta/enums -> formats`):
//   - El dinero viaja como ENTERO en centavos (`*Minor`). 500000 = $5.000 COP.
//   - La presentación es `$5.000`: símbolo `$`, separador de miles `.`, sin
//     decimales, thousandSeparator escalonado (a partir de 5 dígitos).
//   - Locale `es_CO`, moneda `COP`.
//
// Este archivo es la ÚNICA fuente de formato de dinero de la app. Ningún widget
// escribe `'$${(price / 100).toStringAsFixed(0)}'`: eso rompe con separadores.
//
// BR-PRICE-008: el frontend puede previsualizar un subtotal, pero el único total
// válido es el que devuelve el servidor. Aquí solo se formatea.

import 'package:intl/intl.dart';

import '../config/app_config.dart';

/// Formateador de moneda COP.
abstract final class CurrencyFormatter {
  /// Formato principal: `$5.000`.
  static final NumberFormat _cop = NumberFormat.currency(
    locale: AppConfig.locale,
    symbol: r'$',
    decimalDigits: 0,
  );

  /// Formato de recibo con decimales: `$5.000,00`.
  static final NumberFormat _copWithDecimals = NumberFormat.currency(
    locale: AppConfig.locale,
    symbol: r'$',
    decimalDigits: 2,
  );

  /// Formato compacto para KPIs: `$1,2 M`. NO usar en montos que el usuario
  /// debe pagar: redondea y puede inducir a error.
  static final NumberFormat _copCompact = NumberFormat.compactCurrency(
    locale: AppConfig.locale,
    symbol: r'$',
    decimalDigits: 1,
  );

  /// Convierte centavos a texto: `formatMinor(500000) == '$5.000'`.
  static String formatMinor(int minor, {bool withDecimals = false}) {
    final major = minor / 100;
    return (withDecimals ? _copWithDecimals : _cop).format(major);
  }

  /// Igual que [formatMinor] pero devolviendo el símbolo suelto para compone.
  /// `formatWithPrefix(500000) == ('$', '5.000')`.
  static (String symbol, String amount) split(int minor) {
    final formatted = _cop.format(minor / 100);
    return (r'$', formatted.replaceFirst(r'$', ''));
  }

  /// Versión compacta para dashboards: `$1,2 M`.
  static String formatCompactMinor(int minor) => _copCompact.format(minor / 100);

  /// Sólo el número sin símbolo: `5.000`.
  static String formatNumberMinor(int minor) =>
      _cop.format(minor / 100).replaceFirst(r'$', '');

  /// Convierte lo que el usuario escribió a centavos.
  ///
  /// Acepta `$5.000`, `5.000`, `5000`, `5,000` y espacios. Devuelve `null` si
  /// no hay un número interpretable (el caller muestra el error de validación).
  ///
  /// Regla de redondeo: los centavos se truncan (no se redondea) para no cobrar
  /// de más; el backend es la autoridad final del total.
  static int? parseMinor(String input) {
    final cleaned = input.replaceAll(RegExp(r'[^0-9,.\-]'), '');
    if (cleaned.isEmpty) return null;

    // Normaliza: si hay coma y punto, el último separador es el decimal.
    final lastComma = cleaned.lastIndexOf(',');
    final lastDot = cleaned.lastIndexOf('.');
    final decimalIndex = lastComma > lastDot ? lastComma : lastDot;

    final whole = decimalIndex >= 0
        ? cleaned.substring(0, decimalIndex).replaceAll(RegExp(r'[^0-9]'), '')
        : cleaned;
    final decimals = decimalIndex >= 0
        ? cleaned.substring(decimalIndex + 1).replaceAll(RegExp(r'[^0-9]'), '')
        : '';

    if (whole.isEmpty && decimals.isEmpty) return null;
    final wholeValue = int.tryParse(whole.isEmpty ? '0' : whole) ?? 0;
    final decimalValue = int.tryParse(decimals.isEmpty ? '0' : decimals) ?? 0;
    return wholeValue * 100 + (decimalValue > 99 ? 99 : decimalValue);
  }

  /// Suma una lista de centavos sin pasar por `double` (sin error de coma flotante).
  static int sumMinor(Iterable<int> values) =>
      values.fold<int>(0, (int acc, int value) => acc + value);
}
