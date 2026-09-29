// Punto de entrada de la app Latte Coffee.
//
// Hace cuatro cosas y ninguna más:
//   1. `WidgetsFlutterBinding.ensureInitialized()` (los plugins lo necesitan).
//   2. Inicializa el almacén clave/valor. `SharedPreferences` es asíncrono y
//      puede fallar, así que si falla se entra con el almacén EN MEMORIA: la app
//      arranca y funciona, solo pierde la caché. El almacenamiento SEGURO de
//      tokens no se inicializa aquí: `TokenStorage` lo resuelve solo.
//   3. Inicializa los datos de locale de `intl`
//      (`initializeDateFormatting(AppConfig.locale)`). Es OBLIGATORIO y va antes
//      de `runApp`: sin él, el primer `DateFormat(..., 'es_CO')` de
//      `core/utils/date_formatter.dart` lanza
//      `LocaleDataException: Locale data has not been initialized`.
//   4. Monta el `ProviderScope` con ese almacén ya resuelto y arranca.
//
// Ni una llamada de red: el `bootstrap` de la sesión lo dispara `AuthController`
// cuando el primer widget lee su provider, y así la app muestra su estado de
// carga en lugar de una pantalla en blanco.
//
// Para empaquetar:
//   flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000/api/v1
//   flutter build web --dart-define=API_BASE_URL=https://api.lattecoffee.co/api/v1

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:shared_preferences/shared_preferences.dart';

import './app/app.dart';
import './core/config/app_config.dart';
import './core/di/providers.dart';
import './core/storage/key_value_store.dart';

Future<void> main() async {
  // Antes de cualquier platform channel: sin binding no hay
  // `SharedPreferences`, y sin él la app ni siquiera puede leer su caché.
  WidgetsFlutterBinding.ensureInitialized();

  // Datos de locale de `intl` (nombres de meses/días y patrones de es-CO).
  //
  // Por qué ANTES de `runApp`: `DateFormatter` (core/utils/date_formatter.dart)
  // construye sus `DateFormat` en `static final`. Dart inicializa los `static`
  // de forma perezosa, en el PRIMER uso, así que esos constructores se ejecutan
  // ya con los datos cargados y no hay forma de inicializarlos después sin que
  // Home reviente con `LocaleDataException`.
  //
  // Por qué `intl` lo exige: la fecha de una reserva, de un pedido o de un
  // temporizador de silla se pinta en la Home, y esa es la primera pantalla que
  // se construye tras el login.
  //
  // `NumberFormat` (core/utils/currency_formatter.dart) NO necesita esto: los
  // símbolos numéricos vienen en un mapa estático que `intl` importa siempre
  // (`number_symbols_data.dart`).
  await initializeDateFormatting(AppConfig.locale);

  runApp(
    ProviderScope(
      // Se inyecta el almacén YA resuelto en vez de dejar que el provider lo
      // construya: `getInstance()` es asíncrono y bloquear `runApp` por ello
      // deja la primera pantalla en blanco en móvil.
      overrides: <Override>[
        keyValueStoreProvider.overrideWithValue(await _buildStore()),
      ],
      child: const LatteCoffeeApp(),
    ),
  );
}

/// Almacén persistente, o volátil si `SharedPreferences` no responde.
///
/// Un fallo de almacenamiento NO es motivo para no abrir la app: lo que se
/// pierde es el negocio cacheado, los flags y el último filtro, todo
/// reconstruible desde la red.
Future<KeyValueStore> _buildStore() async {
  try {
    final SharedPreferences prefs = await SharedPreferences.getInstance();
    return SharedPreferencesStore(prefs);
  } on Object catch (error) {
    if (kDebugMode) {
      debugPrint('[main] sin almacenamiento persistente: $error');
    }
    return InMemoryKeyValueStore();
  }
}
