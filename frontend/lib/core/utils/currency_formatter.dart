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
//
// ─────────────────────────────────────────────────────────────────────────────
// POR QUÉ NO SE USA EL PATRÓN DE `intl` PARA MONEDA
// ─────────────────────────────────────────────────────────────────────────────
// El síntoma era `5.500 $` —símbolo detrás y punto de miles— cuando el contrato
// exige `$5.500`. La causa no era el widget: era que `intl` 0.19 NO tiene datos de
// `es_CO`, así que `Intl.verifiedLocale` cae a `es`, y el patrón de moneda de `es`
// es `#,##0.00 ¤` (símbolo al final). El locale correcto, `es_419`, sí pone el
// símbolo delante pero usa COMA de miles (`$5,500`), que en Colombia está mal.
//
// La salida no puede depender de qué datos traiga la versión de `intl` del
// momento, así que aquí el patrón se escribe EXPLÍCITO (`¤#,##0`) y solo se le
// pide a `intl` el separador de miles y el decimal, que sí son los de es-CO:
// punto para agrupar, coma para decimales. Así `$5.500` es el resultado en este
// móvil y en el próximo, suba o baje `intl`.
//
// `test/currency_formatter_test.dart` fija el contrato exacto, incluido el
// símbolo delante, para que un cambio de `intl` no lo rompa en silencio.

import 'package:intl/intl.dart';
import '../config/app_config.dart';

/// Formateador de moneda COP.
abstract final class CurrencyFormatter {
  /// Símbolo vigente. Lo publica `GET /business` (`currencySymbol`), así que
  /// puede ser `$`, `COP`, `US$`… según cómo tenga configurado el local el
  /// negocio. Solo cambia cuando llega la configuración; ver [setSymbol].
  static String _symbol = AppConfig.defaultCurrencySymbol;

  /// Símbolo con el que se presenta el dinero ahora mismo.
  static String get symbol => _symbol;

  /// Fija el símbolo desde la configuración del negocio.
  ///
  /// Se llama desde `businessStatusProvider` (y desde su copia cacheada) igual
  /// que se llama a `DateFormatter.timeZoneOverride`: la fuente de verdad es
  /// `GET /business`, no una constante del código.
  ///
  /// Un `null`, un vacío o un espacio se ignoran: si el backend no manda símbolo
  /// se queda el del contrato (`$`), porque un precio sin símbolo es peor que un
  /// precio con el símbolo por defecto.
  static void setSymbol(String? value) {
    final String next = (value ?? '').trim();
    if (next.isEmpty || next == _symbol) return;
    _symbol = next;
    // Los `NumberFormat` son INMUTABLES y no admiten cambiar el patrón: se
    // invalidan y se reconstruyen perezosamente en el siguiente formateo.
    _plain = null;
    _withDecimals = null;
    _digits = null;
    _digitsWithDecimals = null;
    _compact = null;
  }

  static NumberFormat? _plain;
  static NumberFormat? _withDecimals;
  static NumberFormat? _digits;
  static NumberFormat? _digitsWithDecimals;
  static NumberFormat? _compact;

  /// Un entero escrito en es-CO con puntos de miles: `5.000`, `1.234.567`.
  ///
  /// Exige que el primer grupo tenga de uno a tres dígitos y que TODOS los puntos
  /// separen exactamente tres. Es lo que distingue "cinco mil pesos" de "cinco
  /// pesos con noventa y nueve", que es la ambigüedad real de escribir un precio a
  /// mano.
  static final RegExp _thousandsPattern = RegExp(r'^\d{1,3}(\.\d{3})+$');

  /// Prefijo que se pinta delante del importe: el símbolo y, si hace falta, un
  /// espacio duro (U+00A0).
  ///
  /// El espacio se añade solo cuando el símbolo es ALFABÉTICO (`COP`, `USD`):
  /// `COP5.500` se lee como un número pegado a un código, mientras que `$5.500` y
  /// `US$5.500` llevan el signo pegado al número, que es como lo pide el
  /// contrato. El espacio es duro para que el símbolo nunca se quede solo al
  /// final de una línea.
  static String get _prefix {
    if (_symbol.isEmpty) return '';
    final bool isWordLike = RegExp(r'^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 ]+$').hasMatch(_symbol);
    return isWordLike ? '$_symbol\u00A0' : _symbol;
  }

  /// Formato principal: `$5.500`.
  static NumberFormat get _formatPlain =>
      _plain ??= _currency(decimalDigits: 0, pattern: r'#,##0');

  /// Formato de recibo con decimales: `$5.500,00`.
  static NumberFormat get _formatWithDecimals =>
      _withDecimals ??= _currency(decimalDigits: 2, pattern: r'#,##0.00');

  /// Importe SIN símbolo: `5.500`. Es lo que devuelven [split] y
  /// [formatNumberMinor], para no tener que recortar el símbolo del texto ya
  /// formateado (recortar a mano se rompe en cuanto el signo de menos va delante).
  static NumberFormat get _formatDigits =>
      _digits ??= NumberFormat.decimalPattern(AppConfig.locale)
        ..maximumFractionDigits = 0;

  /// Importe sin símbolo y con decimales: `5.500,00`.
  static NumberFormat get _formatDigitsWithDecimals =>
      _digitsWithDecimals ??= NumberFormat.decimalPattern(AppConfig.locale)
        ..minimumFractionDigits = 2
        ..maximumFractionDigits = 2;

  /// Versión compacta para KPIs: `$1,23 M`. NO usar en montos que el usuario debe
  /// pagar: redondea y puede inducir a error.
  static NumberFormat get _formatCompact =>
      _compact ??= NumberFormat.compact(locale: AppConfig.locale);

  /// Construye un formato de moneda con el patrón escrito a mano.
  ///
  /// El locale solo aporta los SEPARADORES (punto de miles, coma decimal). Si
  /// `intl` no conoce `es_CO` y cae a `es`, esos separadores siguen siendo los
  /// correctos, que es justo lo que se necesita del locale.
  static NumberFormat _currency({
    required int decimalDigits,
    required String pattern,
  }) {
    // El prefijo va LITERAL en el patrón en vez de por el parámetro `symbol`:
    // `NumberFormat.currency` coloca `symbol` donde diga el patrón de su locale,
    // que es justo lo que se está esquivando. Con el prefijo en el patrón, su
    // posición no depende de los datos de `intl`.
    return NumberFormat.currency(
      locale: AppConfig.locale,
      decimalDigits: decimalDigits,
      customPattern: '$_prefix$pattern',
    );
  }

  /// Convierte centavos a texto: `formatMinor(550000) == '$5.500'`.
  static String formatMinor(int minor, {bool withDecimals = false}) {
    final major = minor / 100;
    return (withDecimals ? _formatWithDecimals : _formatPlain).format(major);
  }

  /// Igual que [formatMinor] pero devolviendo el símbolo suelto para compone.
  /// `split(500000) == ('$', '5.000')`.
  static (String symbol, String amount) split(int minor) =>
      (_symbol, formatNumberMinor(minor));

  /// Versión compacta para dashboards: `$1,23 M`.
  static String formatCompactMinor(int minor) =>
      '$_prefix${_formatCompact.format(minor / 100)}';

  /// Sólo el número sin símbolo: `5.000`.
  static String formatNumberMinor(int minor) => _formatDigits.format(minor / 100);

  /// Importe con decimales y sin símbolo: `5.500,00`.
  static String formatNumberMinorWithDecimals(int minor) =>
      _formatDigitsWithDecimals.format(minor / 100);

  /// Convierte lo que el usuario escribió a centavos.
  ///
  /// Acepta `$5.000`, `5.000`, `5000`, `5,000` y espacios. Devuelve `null` si
  /// no hay un número interpretable (el caller muestra el error de validación).
  ///
  /// PUNTO O COMA: CUAL ES EL DECIMAL
  /// Antes se tomaba como decimal SIEMPRE el último separador, así que `5.000`
  /// —que en es-CO son cinco mil pesos— se leía como cinco pesos con céntimos y
  /// el diálogo de reembolso del panel cobraba 500 en vez de 500000. La regla que
  /// se aplica ahora es la de es-CO:
  ///
  ///   · hay coma → la coma es el decimal (`5.000,50` → 500050);
  ///   · no hay coma y el texto encaja en grupos de tres separados por punto
  ///     (`5.000`, `1.234.567`) → el punto es de miles (`5.000` → 500000);
  ///   · en cualquier otro caso el último separador es el decimal (`12.99` → 1299).
  ///
  /// Regla de redondeo: los centavos se truncan (no se redondea) para no cobrar
  /// de más; el backend es la autoridad final del total.
  static int? parseMinor(String input) {
    final cleaned = input.replaceAll(RegExp(r'[^0-9,.\-]'), '');
    if (cleaned.isEmpty) return null;

    final lastComma = cleaned.lastIndexOf(',');
    final lastDot = cleaned.lastIndexOf('.');
    // Grupos de tres separados por punto y sin coma: es un número con punto de
    // miles, no con decimales (`1.234.567`). La expresión regular exige que TODOS
    // los puntos separen tres dígitos, así que "12.99" sigue siendo un decimal.
    final bool dotIsThousands = lastComma < 0 &&
        _thousandsPattern.hasMatch(cleaned);
    final int decimalIndex =
        dotIsThousands ? -1 : (lastComma > lastDot ? lastComma : lastDot);

    final whole = (decimalIndex >= 0 ? cleaned.substring(0, decimalIndex) : cleaned)
        .replaceAll(RegExp(r'[^0-9]'), '');
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
