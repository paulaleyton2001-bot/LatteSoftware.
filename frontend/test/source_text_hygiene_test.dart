// HIGIENE DEL TEXTO EN EL CÓDIGO: ni una letra de otro alfabeto.
//
// ─────────────────────────────────────────────────────────────────────────────
// EL BUG QUE ESTE ARCHIVO HACE IMPOSIBLE QUE VUELVA
// ─────────────────────────────────────────────────────────────────────────────
// En la pantalla de Menú se leía una pregunta cuyo verbo traía TRES caracteres
// ARABES intercalados dentro de la palabra (`U+062A`, `U+0635`, `U+0641`).
// No era un problema de fuentes ni de locale —el resto de la pantalla se veía
// bien—: era una cadena corrupta en el código.
// (La cadena exacta NO se copia aquí: si estuviera escrita en este comentario,
// el test la encontraría en sí mismo. Se rearma con `String.fromCharCode`, más
// abajo.)
//
// Ese tipo de fallo es el peor posible para un sistema de revisión:
//   · el código COMPILA (son caracteres válidos en un literal de Dart),
//   · `flutter analyze` no dice nada,
//   · los tests que había pasan,
//   · y solo se ve cuando alguien abre la app.
//
// Un lint no lo pilla porque no sabe qué alfabetos queremos. Lo que sí lo pilla es
// un test que recorre el código y falla con el fichero, la línea y el carácter
// exacto. Este es ese test.
//
// ─────────────────────────────────────────────────────────────────────────────
// POR QUÉ ESTE ARCHIVO NO CONTIENE NI UN SOLO CARÁCTER PROHIBIDO
// ─────────────────────────────────────────────────────────────────────────────
// Si la muestra se escribiera a mano, el test se detectaría a sí mismo fallando
// sobre su propio código. Por eso la muestra se CONSTRUYE con `String.fromCharCode`
// y los rangos se escriben en hexadecimal: en este fichero no hay ni una letra
// árabe, y aun así comprueba que las encuentra. Es el mismo truco que usan las
// pruebas de inyección de caracteres en SQL: el patrón se arma, no se copia.
//
// QUÉ BUSCA
// Los cuatro rangos Unicode de escritura árabe y hebreo, que es donde caen las
// transliteraciones y los copiados desde otro teclado:
//
//   U+0600–U+06FF   árabe
//   U+0750–U+077F   árabe suplementario
//   U+FB50–U+FDFF   formas presentacionales de árabe (¡con espacio!)
//   U+FE70–U+FEFF   formas presentacionales de árabe B
//
// Un literal español legítimo («¿», «ñ», «·», «—») no está en ninguno de ellos.

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// Rangos que no pueden aparecer en el texto de la app.
const List<(int from, int to, String name)> _forbiddenRanges =
    <(int from, int to, String name)>[
  (0x0600, 0x06FF, 'árabe'),
  (0x0750, 0x077F, 'árabe suplementario'),
  (0xFB50, 0xFDFF, 'formas presentacionales de árabe'),
  (0xFE70, 0xFEFF, 'formas presentacionales de árabe B'),
];

/// Carpetas que se revisan. `lib/` es el producto; `test/` entra también, porque
/// una cadena corrupta en un test acaba copiada en la app en la siguiente
/// iteración.
const List<String> _roots = <String>['lib', 'test'];

/// Nombre del rango prohibido al que pertenece [codePoint], o `null`.
String? _forbiddenRangeName(int codePoint) {
  for (final (int from, int to, String name) in _forbiddenRanges) {
    if (codePoint >= from && codePoint <= to) return name;
  }
  return null;
}

/// Devuelve los caracteres prohibidos de [source] con su línea (1-indexada) y el
/// rango al que pertenecen.
List<String> _findForbidden(String source) {
  final List<String> hits = <String>[];
  final List<String> lines = source.split('\n');
  for (int i = 0; i < lines.length; i++) {
    // Se recorre por CÓDIGO PUNTO (`runes`), no por unidad de código: un carácter
    // UTF-16 suelto daría media pareja y el rango no coincidiría, que es
    // precisamente el tipo de fallo que hides un carácter «raro».
    for (final int rune in lines[i].runes) {
      final String? range = _forbiddenRangeName(rune);
      if (range == null) continue;
      final String hex =
          'U+${rune.toRadixString(16).toUpperCase().padLeft(4, '0')}';
      hits.add('línea ${i + 1}: $hex ($range)  ${lines[i].trim()}');
    }
  }
  return hits;
}

/// Ficheros `.dart` de [root], recursivamente y en orden estable.
List<File> _dartFiles(Directory root) {
  final List<File> found = <File>[];
  if (!root.existsSync()) return found;
  for (final FileSystemEntity entity in root.listSync(recursive: true)) {
    if (entity is File && entity.path.endsWith('.dart')) found.add(entity);
  }
  found.sort((File a, File b) => a.path.compareTo(b.path));
  return found;
}

/// Los TRES caracteres que tenía la frase rota del menú, armados por código.
String _corruptSample() => <String>[
      'T',
      'e',
      'x',
      't',
      '(',
      '\'', // ¿
      'Qu',
      'é',
      ' t',
      String.fromCharCode(0x062A),
      's',
      String.fromCharCode(0x0635),
      'a',
      String.fromCharCode(0x0641),
      ' h',
      'o',
      'y',
      '?',
      '\')',
    ].join();

void main() {
  group('Higiene del texto del código', () {
    test('ningún `.dart` de lib/ ni test/ tiene caracteres de otro alfabeto', () {
      final List<String> offences = <String>[];
      final List<File> scanned = <File>[];

      for (final String rootPath in _roots) {
        final Directory root = Directory(rootPath);
        expect(
          root.existsSync(),
          isTrue,
          reason:
              'Los tests se ejecutan con el paquete como directorio de trabajo; '
              'si "$rootPath" no existe, este test no está comprobando nada.',
        );
        for (final File file in _dartFiles(root)) {
          scanned.add(file);
          for (final String hit in _findForbidden(file.readAsStringSync())) {
            offences.add('${file.path} → $hit');
          }
        }
      }

      // Que el recorrido no sea un no-op: si `lib/` se moviera, el test tiene que
      // fallar por eso y no pasar en verde sin haber mirado nada.
      expect(scanned.length, greaterThan(100));

      expect(
        offences,
        isEmpty,
        reason: 'Caracteres fuera del alfabeto esperado en el código '
            '(${scanned.length} ficheros revisados):\n'
            '${offences.join('\n')}\n'
            'Copia el texto desde una fuente que sea español, o escríbelo a mano.',
      );
    });

    test('la herramienta detecta lo que tiene que detectar', () {
      // Si el filtro no encontrara nada nunca, el test de arriba pasaría siempre.
      // Se le pasan los TRES caracteres del bug original y tiene que marcarlos.
      final List<String> hits = _findForbidden(_corruptSample());
      expect(hits, hasLength(3));
      expect(hits.first, contains('U+062A'));
      expect(hits.last, contains('U+0641'));
      expect(hits.first, contains('línea 1'));
    });

    test('el texto español legítimo NO salta la alarma', () {
      // Si estos saltaran, el control sería inútil: habría que desactivarlo.
      const String legitimo =
          '¿Qué te descubrimos hoy? · Ñandú, ratón, ¡hola! — «guillemets» '
          '€5.500 £1.000 °C ½ 2026 © ÁÉÍÓÚÜ ¿¡';
      expect(_findForbidden(legitimo), isEmpty);
    });
  });

  group('La cadena concreta que se vio rota', () {
    test('la frase del menú es español y no está adulterada', () {
      // La comprobación de arriba es general; esta fija además QUE el texto que
      // se vio roto en el móvil es el correcto, y no uno "parecido".
      final File file = File('lib/shared/constants/app_strings.dart');
      expect(file.existsSync(), isTrue);
      final String source = file.readAsStringSync();
      expect(
        source.contains(r"menuPrompt = '¿Qué te descubrimos hoy?'"),
        isTrue,
        reason: 'La frase bajo el saludo del menú debe ser esta, sin adulterar.',
      );
      expect(_findForbidden(source), isEmpty);
    });
  });
}
