// Almacén clave/valor mínimo, detrás de una interfaz.

import 'package:shared_preferences/shared_preferences.dart';
//
// POR QUÉ NO `SharedPreferences` DIRECTAMENTE
// `SharedPreferences.getInstance()` necesita un platform channel y puede fallar
// (permisos, perfil corrupto, entorno restringido). Si eso ocurre y la capa de
// almacenamiento depende de la clase concreta, la app no arranca. Con esta
// interfaz hay dos implementaciones:
//
//   - `SharedPreferencesStore` — disco real (móvil) / `localStorage` (web).
//   - `InMemoryKeyValueStore`  — volátil, para cuando no hay almacenamiento.
//
// Beneficio extra: `PreferencesStorage` y la cola offline se prueban sin
// plataforma y sin `TestWidgetsFlutterBinding`.
//
// REGLA: aquí NO se guardan secretos. Los tokens van a `TokenStorage`
// (`flutter_secure_storage`), que sí es un almacén de credenciales.


/// Lector/escritor de preferencias. Solo tipos que la app usa de verdad.
abstract interface class KeyValueStore {
  String? getString(String key);
  Future<void> setString(String key, String value);
  bool? getBool(String key);
  Future<void> setBool(String key, {required bool value});
  int? getInt(String key);
  Future<void> setInt(String key, int value);
  Future<void> remove(String key);
}

/// Implementación real sobre `SharedPreferences`.
class SharedPreferencesStore implements KeyValueStore {
  const SharedPreferencesStore(this._prefs);

  final SharedPreferences _prefs;

  @override
  String? getString(String key) => _prefs.getString(key);

  @override
  Future<void> setString(String key, String value) =>
      _prefs.setString(key, value);

  @override
  bool? getBool(String key) => _prefs.getBool(key);

  @override
  Future<void> setBool(String key, {required bool value}) =>
      _prefs.setBool(key, value);

  @override
  int? getInt(String key) => _prefs.getInt(key);

  @override
  Future<void> setInt(String key, int value) => _prefs.setInt(key, value);

  @override
  Future<void> remove(String key) => _prefs.remove(key);
}

/// Implementación en memoria. Se pierde al cerrar la app, y está bien: sirve
/// para que la app arranque y funcione (sin caché) cuando no hay almacenamiento.
class InMemoryKeyValueStore implements KeyValueStore {
  InMemoryKeyValueStore([Map<String, Object>? initial])
      : _values = <String, Object>{...?initial};

  final Map<String, Object> _values;

  @override
  String? getString(String key) {
    final Object? value = _values[key];
    return value is String ? value : null;
  }

  @override
  Future<void> setString(String key, String value) async {
    _values[key] = value;
  }

  @override
  bool? getBool(String key) {
    final Object? value = _values[key];
    return value is bool ? value : null;
  }

  @override
  Future<void> setBool(String key, {required bool value}) async {
    _values[key] = value;
  }

  @override
  int? getInt(String key) {
    final Object? value = _values[key];
    return value is int ? value : null;
  }

  @override
  Future<void> setInt(String key, int value) async {
    _values[key] = value;
  }

  @override
  Future<void> remove(String key) async {
    _values.remove(key);
  }
}
