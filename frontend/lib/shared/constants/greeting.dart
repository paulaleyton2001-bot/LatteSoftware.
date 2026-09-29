// Saludo con el nombre de la persona: UNA sola implementación para toda la app.
//
// POR QUÉ ESTE ARCHIVO EXISTE
// El síntoma era «en Inicio pone "Buenos días, Usuario" y en Menú pone "Hola,
// Usuario"»: dos pantallas de la MISMA sesión que se contradicen. No era un bug de
// datos —las dos leían `auth/me`— sino que cada pantalla se había escrito su
// propio saludo con su propio criterio. Un texto de negocio repetido se corrige
// una vez (misma regla que `AppStrings`), así que el texto y su lógica viven aquí
// y las dos pantallas solo lo pintan.
//
// EL CRITERIO ÚNICO
// Se usa el **momento del día** en las dos pantallas: "Buenos días, Ana". Es el
// saludo que ya tenía la home (que es la primera pantalla y la que marca el
// tono), mientras que "Hola" es un saludo neutro que solo tiene sentido en la
// cabecera de una pantalla secundaria. Unificar hacia "Hola" tiraría abajo la
// hora del día, que sí aporta información.
//
// LA COMA CUANDO NO HAY NOMBRE
// [firstNameOf] devuelve cadena VACÍA si no hay nombre, y [greetingWithName] en
// ese caso devuelve el saludo a secas. La versión ingenua
// `'$greeting, ${first.orEmpty}'` pintaba "Buenos días," con la coma colgando, que
// es exactamente el tipo de detalle que hace que una pantalla parezca rota.
//
// REACCIÓN AL CAMBIO DE CUENTA
// El nombre llega como parámetro desde la pantalla, que es quien observa
// `currentUserProvider`. Al cambiar de sesión ese provider cambia y las dos
// pantallas se reconstruyen con el nombre nuevo: aquí no se guarda estado, así
// que no puede quedar el usuario anterior pegado en un texto.

import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/utils/date_formatter.dart';
import '../widgets/rental_countdown.dart';

/// Momento del día a partir de un instante: "Buenos días" / "Buenas tardes" /
/// "Buenas noches".
///
/// El corte se calcula sobre la hora del NEGOCIO (`DateFormatter.toLocal`), no
/// sobre la del dispositivo: alguien con el reloj en otro huso no debe recibir
/// "Buenas noches" porque en su casa ya sea de madrugada.
String timeOfDayGreeting(DateTime now) {
  final DateTime local = DateFormatter.toLocal(now);
  final int hour = local.hour;
  if (hour < 12) return 'Buenos días';
  if (hour < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

/// Momento del día como provider.
///
/// Usa [clockProvider] de `shared/widgets/rental_countdown.dart`: es el MISMO
/// reloj de un segundo que el temporizador de silla, así que toda la app comparte
/// una sola fuente de tiempo y no puede haber dos cifras que no coincidan.
///
/// El reloj se observa solo para que la pantalla se reconstruya al cambiar el día
/// o la franja; el valor concreto sale de [timeOfDayGreeting].
final Provider<String> greetingProvider = Provider<String>((Ref ref) {
  ref.watch(clockProvider);
  return timeOfDayGreeting(DateTime.now());
}, name: 'greeting');

/// Primera palabra de un nombre completo, o cadena vacía.
///
/// Acepta el `displayName` de `User`, que ya cae al correo cuando no hay nombre:
/// para ese caso "prueba@lattecoffe.co" no debe salirse como un solo bloque, así
/// que se parte por ESPACIOS y se toma la primera palabra. Un nombre con espacios
/// de sobra ("  Ana María  ") se recorta antes de partirse.
String firstNameOf(String? displayName) {
  final String trimmed = (displayName ?? '').trim();
  if (trimmed.isEmpty) return '';
  return trimmed.split(RegExp(r'\s+')).first;
}

/// Saludo completo con el nombre: `"Buenos días, Ana"`.
///
/// Sin nombre devuelve [greeting] a secas, SIN coma: una coma colgando del final
/// de la línea se lee como un texto truncado.
String greetingWithName({required String greeting, required String? name}) {
  final String first = firstNameOf(name);
  return first.isEmpty ? greeting : '$greeting, $first';
}
