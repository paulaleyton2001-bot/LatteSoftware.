// Caché de negocio NO sensible (preferencias persistentes).
//
// Qué va aquí: la configuración del negocio cacheada, el id del negocio
// activo, flags de funcionalidad y el último filtro/orden de cada pantalla.
// Qué NO va aquí, NUNCA: access token, refresh token, contraseñas ni datos de
// pago. Eso vive en `core/storage/token_storage.dart`.
//
// Es una CACHÉ, no una fuente de verdad: si una clave falta o está corrupta se
// devuelve el valor por defecto y la siguiente lectura de red la reescribe.

import 'dart:convert';

import 'key_value_store.dart';

/// Envoltura tipada del almacén clave/valor con las claves de la app.
///
/// Trabaja contra [KeyValueStore] y no contra `SharedPreferences`: así la capa
/// de almacenamiento no depende de un platform channel y se puede probar sin
/// plataforma.
class PreferencesStorage {
  const PreferencesStorage(this._store);

  final KeyValueStore _store;

  /// Claves. Prefijadas con `lc.` para no colisionar con plugins de terceros.
  static const String kActiveBusinessId = 'lc.business.activeId';
  static const String kCachedBusiness = 'lc.business.cached';
  static const String kLastMenuFilter = 'lc.menu.lastFilter';
  static const String kLastCatalogSort = 'lc.catalog.lastSort';
  static const String kOnboardingSeen = 'lc.onboarding.seen';
  static const String kDarkMode = 'lc.ui.darkMode';
  static const String kPendingOpsCount = 'lc.offline.pendingCount';

  // -------------------------------------------------------------negocio activo
  /// `businessId` del negocio con el que se opera (sale del access token).
  int? get activeBusinessId => _store.getInt(kActiveBusinessId);

  Future<void> setActiveBusinessId(int? id) async {
    if (id == null) {
      await _store.remove(kActiveBusinessId);
      return;
    }
    await _store.setInt(kActiveBusinessId, id);
  }

  // ------------------------------------------------------------ negocio cacheado
  /// Configuración del negocio cacheada como JSON, o `null`.
  Map<String, dynamic>? get cachedBusiness => _readJson(kCachedBusiness);

  Future<void> setCachedBusiness(Map<String, dynamic> value) =>
      _writeJson(kCachedBusiness, value);

  Future<void> clearCachedBusiness() => _store.remove(kCachedBusiness);

  // -------------------------------------------------------------------- flags
  /// `true` si el usuario ya vio el onboarding (no se lo volvemos a mostrar).
  bool get onboardingSeen => _store.getBool(kOnboardingSeen) ?? false;

  Future<void> setOnboardingSeen(bool value) =>
      _store.setBool(kOnboardingSeen, value);

  /// Preferencia de tema: `null` = seguir al sistema.
  bool? get darkMode => _store.getBool(kDarkMode);

  Future<void> setDarkMode(bool? value) async {
    if (value == null) {
      await _store.remove(kDarkMode);
      return;
    }
    await _store.setBool(kDarkMode, value);
  }

  // ------------------------------------------------------- filtros y orden
  /// Último filtro de categoría del menú (para reabrir donde estaba).
  int? get lastMenuFilter => _store.getInt(kLastMenuFilter);

  Future<void> setLastMenuFilter(int? categoryId) async {
    if (categoryId == null) {
      await _store.remove(kLastMenuFilter);
      return;
    }
    await _store.setInt(kLastMenuFilter, categoryId);
  }

  /// Último criterio de orden del catálogo (`name`, `priceMinor`, ...).
  String? get lastCatalogSort => _store.getString(kLastCatalogSort);

  Future<void> setLastCatalogSort(String? sort) async {
    if (sort == null) {
      await _store.remove(kLastCatalogSort);
      return;
    }
    await _store.setString(kLastCatalogSort, sort);
  }

  // -------------------------------------------------------------- cola offline
  /// Contador de operaciones pendientes, cacheado para pintar el aviso de
  /// "N operaciones sin enviar" sin abrir el archivo de la cola.
  int get pendingOpsCount => _store.getInt(kPendingOpsCount) ?? 0;

  Future<void> setPendingOpsCount(int value) =>
      _store.setInt(kPendingOpsCount, value);

  // ------------------------------------------------------------------ Genéricos
  /// Borra TODA la caché de negocio. Se llama al cerrar sesión para no dejar
  /// datos de un negocio visibles en el dispositivo de otro usuario.
  Future<void> clearBusinessCache() async {
    await _store.remove(kCachedBusiness);
    await _store.remove(kActiveBusinessId);
    await _store.remove(kLastMenuFilter);
    await _store.remove(kLastCatalogSort);
  }

  Map<String, dynamic>? _readJson(String key) {
    final String? raw = _store.getString(key);
    if (raw == null || raw.isEmpty) return null;
    try {
      final Object? decoded = jsonDecode(raw);
      return decoded is Map<String, dynamic> ? decoded : null;
    } on FormatException {
      // Caché corrupta: se ignora y la red la reconstruye.
      return null;
    }
  }

  Future<void> _writeJson(String key, Map<String, dynamic> value) =>
      _store.setString(key, jsonEncode(value));
}
