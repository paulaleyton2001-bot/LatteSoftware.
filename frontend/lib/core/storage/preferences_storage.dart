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

import './key_value_store.dart';

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

  /// Modo de tema guardado. El VALOR es el nombre del `ThemeMode` (`system`,
  /// `light`, `dark`), no un booleano: el ajuste tiene TRES estados y con un
  /// `bool` no se puede distinguir "claro" de "el sistema estaba en claro".
  ///
  /// SUSTITUYE a `lc.ui.darkMode`, que solo guardaba un booleano y por tanto no
  /// podía representar "Sistema". La clave vieja se lee una vez para migrar y
  /// luego se borra; no se escribe nunca más.
  static const String kThemeMode = 'lc.ui.themeMode';
  static const String kLegacyDarkMode = 'lc.ui.darkMode';

  static const String kPendingOpsCount = 'lc.offline.pendingCount';
  static const String kCart = 'lc.cart.state';

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

  Future<void> setOnboardingSeen({required bool value}) =>
      _store.setBool(kOnboardingSeen, value: value);

  // ------------------------------------------------------------- modo de tema
  /// Modo de tema guardado, o `null` si nunca se eligió uno (vale "Sistema").
  ///
  /// Si la clave nueva no está, se mira la VIEJA (`lc.ui.darkMode`) y se traduce
  /// a los tres estados: `true` → `dark`, `false` → `light`. Es una migración
  /// perezosa, sin necesidad de una versión de esquema, y la clave vieja se
  /// elimina para que no queden dos fuentes de verdad.
  String? get themeModeName {
    final String? stored = _store.getString(kThemeMode);
    if (stored != null && stored.isNotEmpty) return stored;

    final bool? legacy = _store.getBool(kLegacyDarkMode);
    return legacy == null ? null : (legacy ? 'dark' : 'light');
  }

  /// Guarda el modo de tema. `null` o vacío = "Sistema" y se borra la clave.
  ///
  /// Se BORRA en vez de guardar `'system'`: "seguir al sistema" es la ausencia de
  /// preferencia, y escribirla haría que un cambio de preferencia hecho con una
  /// versión anterior de la app no se respetase.
  Future<void> setThemeModeName(String? value) async {
    await _store.remove(kLegacyDarkMode);
    if (value == null || value.isEmpty) {
      await _store.remove(kThemeMode);
      return;
    }
    await _store.setString(kThemeMode, value);
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

  // -------------------------------------------------------------------- carrito
  /// Carrito serializado (`core/customer/cart_codec.dart`), o `null` si nunca
  /// se ha guardado. La lectura es síncrona a propósito: el badge de navegación y
  /// la pantalla del carrito tienen el número correcto en el PRIMER frame, sin
  /// parpadeo de "0 artículos" -> "3 artículos".
  String? get cartJson => _store.getString(kCart);

  Future<void> setCartJson(String payload) => _store.setString(kCart, payload);

  /// Borra el carrito. Se llama al confirmar el pedido y al cerrar sesión: en un
  /// dispositivo compartido el pedido de uno no puede quedar en el carrito de
  /// otro.
  Future<void> clearCart() => _store.remove(kCart);

  // ------------------------------------------------- Genéricos por feature
  /// Lectura cruda de una clave de caché de una feature.
  ///
  /// Existe para que las features puedan cachear su propio catálogo (menú,
  /// mapa de sillas) sin que este archivo tenga que conocer un método por
  /// recurso. La ESCRITURA la hace la feature con su propia clave namespaced
  /// (`lc.<feature>.cache.<bucket>`), así que no puede pisar ninguna clave de la
  /// app.
  String? getString(String key) => _store.getString(key);

  /// Escritura cruda de una clave de caché de una feature.
  Future<void> setString(String key, String value) =>
      _store.setString(key, value);

  // ------------------------------------------------------------------ Genéricos
  /// Borra TODA la caché de negocio. Se llama al cerrar sesión para no dejar
  /// datos de un negocio visibles en el dispositivo de otro usuario.
  Future<void> clearBusinessCache() async {
    await _store.remove(kCachedBusiness);
    await _store.remove(kActiveBusinessId);
    await _store.remove(kLastMenuFilter);
    await _store.remove(kLastCatalogSort);
    // El carrito es del USUARIO, no del negocio, pero en un dispositivo
    // compartido dejarlo puesto significaría que otra personanea vea y envíe un
    // pedido ajeno. Se borra con la caché.
    await _store.remove(kCart);
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
