// Contrato de presentación del dinero. `formatMinor(550000) == '$5.500'`.
//
// ─────────────────────────────────────────────────────────────────────────────
// POR QUÉ ESTE ARCHIVO ES UN TEST Y NO UNA COMPROBACIÓN MANUAL
// ─────────────────────────────────────────────────────────────────────────────
// El bug que reportó el usuario fue `5.500 $` en el móvil: símbolo DETRÁS. La
// causa era `intl` 0.19, que no tiene datos de `es_CO`; `Intl.verifiedLocale`
// cae a `es`, cuyo patrón de moneda es `#,##0.00 ¤` — símbolo al final. Nadie lo
// vio en el código porque el formateador se leía bien: `NumberFormat.currency(
// locale: 'es_CO', symbol: r'$')` NO lanza, simplemente cae al `es` que le sea.
//
// Un fallo que depende de los datos de una librería, no del código, es
// exactamente el que hay que fijar con una prueba: si algún día sube `intl` (o
// cambia `AppConfig.locale`), el test dice "$5.500, no 5.500 $" y en el móvil no
// hace falta.
//
// Cubre también el símbolo: `businesses.currency_symbol` llega de `GET /business`
// y se aplica con `setSymbol`, así que un local con otra moneda no tiene que
// esperar a que alguien edite el código.

import 'package:flutter_test/flutter_test.dart';
import 'package:latte_coffee/core/config/app_config.dart';
import 'package:latte_coffee/core/utils/currency_formatter.dart';

void main() {
  // El formateador es estático y el símbolo es global: se restaura al del
  // contrato al terminar cada prueba para que no se filtren entre grupos.
  tearDown(() => CurrencyFormatter.setSymbol(AppConfig.defaultCurrencySymbol));

  group('Contrato exacto de presentación', () {
    test('el símbolo va DELANTE y no hay decimales', () {
      // Los tres casos que fijan el contrato de docs/DESIGN-TOKENS.md §9.1.
      expect(CurrencyFormatter.formatMinor(550000), r'$5.500');
      expect(CurrencyFormatter.formatMinor(123456700), r'$1.234.567');
      expect(CurrencyFormatter.formatMinor(0), r'$0');
    });

    test('el símbolo NUNCA va detrás, ni con decimales', () {
      // La regresión concreta: el patrón de `es` pone `¤` al final.
      for (final int minor in <int>[1, 999, 1000, 550000, 123456700, 999999999]) {
        final String plain = CurrencyFormatter.formatMinor(minor);
        expect(
          plain.startsWith(r'$'),
          isTrue,
          reason: '$minor se pintó como "$plain": el símbolo debe ir delante.',
        );
        expect(
          plain.contains(RegExp(r'[.,]\d{2}$')),
          isFalse,
          reason: '$minor se pintó como "$plain": un precio no lleva decimales.',
        );
      }
    });

    test('el separador de miles es el PUNTO, no la coma', () {
      expect(CurrencyFormatter.formatMinor(100000), r'$1.000');
      expect(CurrencyFormatter.formatMinor(5500000), r'$55.000');
      // Por debajo de los mil no hay nada que separar.
      expect(CurrencyFormatter.formatMinor(99900), r'$999');
      // Y por encima de un millón el grupo sigue siendo de tres en tres.
      expect(CurrencyFormatter.formatMinor(123456700000), r'$1.234.567.000');
    });

    test('no hay espacios invisibles pegados al símbolo', () {
      // `NumberFormat.currency` con el patrón de `es` mete un espacio duro entre
      // importe y `¤`; con el patrón escrito a mano no debe quedar ninguno.
      expect(CurrencyFormatter.formatMinor(550000).runes.length, 6); // $ 5 . 5 0 0
      expect(CurrencyFormatter.formatMinor(550000), isNot(contains(' ')));
      expect(CurrencyFormatter.formatMinor(550000), isNot(contains('\u00A0')));
    });
  });

  group('Variantes', () {
    test('el recibo con decimales usa la coma decimal', () {
      expect(CurrencyFormatter.formatMinor(550000, withDecimals: true), r'$5.500,00');
      expect(CurrencyFormatter.formatMinor(0, withDecimals: true), r'$0,00');
    });

    test('los negativos van con el signo delante del símbolo', () {
      expect(CurrencyFormatter.formatMinor(-100000), r'-$1.000');
    });

    test('`split` devuelve el símbolo suelto y el importe sin él', () {
      final (String symbol, String amount) = CurrencyFormatter.split(550000);
      expect(symbol, r'$');
      expect(amount, '5.500');
      // Es lo que usan los campos de texto del panel para prefijar el símbolo.
      expect('${CurrencyFormatter.split(0).$1}500', r'$500');
    });

    test('`formatNumberMinor` da el importe pelado, con el signo dentro', () {
      expect(CurrencyFormatter.formatNumberMinor(550000), '5.500');
      expect(CurrencyFormatter.formatNumberMinor(0), '0');
      // El signo va en el importe, no en el prefijo: por eso no se recorta el
      // símbolo del texto ya formateado.
      expect(CurrencyFormatter.formatNumberMinor(-100000), '-1.000');
    });

    test('el compacto lleva el símbolo delante (KPI del panel)', () {
      expect(CurrencyFormatter.formatCompactMinor(123456700), startsWith(r'$'));
      expect(CurrencyFormatter.formatCompactMinor(123456700), contains('M'));
      expect(CurrencyFormatter.formatCompactMinor(550000), startsWith(r'$'));
    });
  });

  group('El símbolo viene de la configuración del negocio', () {
    test('`businesses.currency_symbol` sustituye al del contrato', () {
      CurrencyFormatter.setSymbol(r'US$');
      expect(CurrencyFormatter.formatMinor(550000), r'US$5.500');
      expect(CurrencyFormatter.symbol, r'US$');
    });

    test('un símbolo alfabético se separa del importe', () {
      // "COP5.500" se lee como un número pegado a un código.
      CurrencyFormatter.setSymbol('COP');
      expect(CurrencyFormatter.formatMinor(550000), 'COP\u00A05.500');
      // `split` sigue dando el símbolo SIN el espacio: quien lo compone decide
      // dónde ponerlo (los campos de texto del panel ya ponen su propio padding).
      expect(CurrencyFormatter.split(550000).$1, 'COP');
    });

    test('un símbolo vacío o nulo NO borra el del contrato', () {
      CurrencyFormatter.setSymbol(r'US$');
      CurrencyFormatter.setSymbol(null);
      CurrencyFormatter.setSymbol('');
      CurrencyFormatter.setSymbol('   ');
      expect(
        CurrencyFormatter.formatMinor(550000),
        r'US$5.500',
        reason: 'Un backend que no mande símbolo no puede dejar precios sin él.',
      );
    });

    test('volver al símbolo del contrato se hace con `AppConfig`', () {
      CurrencyFormatter.setSymbol(r'US$');
      CurrencyFormatter.setSymbol(AppConfig.defaultCurrencySymbol);
      expect(CurrencyFormatter.formatMinor(550000), r'$5.500');
    });
  });

  group('Sin coma flotante', () {
    test('`sumMinor` suma centavos enteros', () {
      expect(
        CurrencyFormatter.sumMinor(<int>[1999, 1, 3000]),
        5000,
        reason: 'Con `double`, 19.99 + 0.01 + 30.00 puede dar 50.00 - 1e-15.',
      );
      expect(CurrencyFormatter.formatMinor(CurrencyFormatter.sumMinor(<int>[1999, 1])), r'$20');
      expect(CurrencyFormatter.sumMinor(const <int>[]), 0);
    });

    test('`parseMinor` acepta lo que la persona escribe', () {
      // El punto de miles NO puede leerse como decimal: "5.000" son cinco mil
      // pesos, no cinco pesos. Los diálogos de cobro y reembolso del panel
      // dependen de esto.
      expect(CurrencyFormatter.parseMinor(r'$5.000'), 500000);
      expect(CurrencyFormatter.parseMinor('5.000'), 500000);
      expect(CurrencyFormatter.parseMinor('5000'), 500000);
      expect(CurrencyFormatter.parseMinor(r'$ 1.234.567 '), 123456700);
      // Con coma el separador ES decimal, así que "5,000" son cinco pesos.
      expect(CurrencyFormatter.parseMinor('5,000'), 500);
    });

    test('`parseMinor` con los dos separadores: la coma manda', () {
      expect(CurrencyFormatter.parseMinor('5.000,50'), 500050);
      expect(CurrencyFormatter.parseMinor('1.234.567,99'), 123456799);
    });

    test('`parseMinor` sigue leyendo decimales de verdad', () {
      // "12.99" no tiene tres dígitos detrás del punto: es un decimal.
      expect(CurrencyFormatter.parseMinor('12.99'), 1299);
      expect(CurrencyFormatter.parseMinor('12,99'), 1299);
    });

    test('`parseMinor` TRUNCA los centavos, no redondea', () {
      // Cobrar de más es peor que cobrar de menos: el backend es la autoridad.
      expect(CurrencyFormatter.parseMinor('12,999'), 1299);
      expect(CurrencyFormatter.parseMinor('12,999999999999'), 1299);
    });

    test('`parseMinor` devuelve `null` si no hay número', () {
      expect(CurrencyFormatter.parseMinor(''), isNull);
      expect(CurrencyFormatter.parseMinor(r'$'), isNull);
    });

    test('ida y vuelta: formatear y volver a leer da el mismo monto', () {
      // Sin 1 ni 2 centavos: el precio se presenta SIN decimales (el contrato),
      // así que un monto de 1 centavo no tiene ida y vuelta posible. Se prueba
      // aparte, con lo que se escribe a mano.
      for (final int minor in <int>[0, 1000, 100000, 550000, 123456700]) {
        final String text = CurrencyFormatter.formatMinor(minor);
        expect(
          CurrencyFormatter.parseMinor(text),
          minor,
          reason: '"$text" (de $minor) no se pudo volver a leer como $minor.',
        );
      }
    });
  });
}
