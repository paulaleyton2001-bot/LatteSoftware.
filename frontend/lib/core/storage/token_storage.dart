// Almacenamiento SEGURO de la sesión (access token, refresh token, caducidad y
// perfil cacheado).
//
// POR QUÉ `flutter_secure_storage` Y NO `shared_preferences`
// `shared_preferences` guarda en texto plano (localStorage en web, XML en
// Android). Un refresh token robado permite emitir access tokens válidos durante
// 15 minutos, así que es un secreto y va al almacén del sistema: Keychain en
// iOS/macOS, Keystore en Android, `localStorage` cifrado con WebCrypto en web.
//
// ESPEJO EN MEMORIA
// -----------------
// El interceptor de autenticación lee el token en CADA request. Leer del almacén
// del sistema en cada una cuesta un platform channel (y en web, una descifrado
// RSA), así que la sesión viva se cachea aquí: una lectura del disco al arrancar
// y de ahí en adelante una variable.

import 'dart:async';
import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import './stored_session.dart';

export 'stored_session.dart' show StoredSession;

/// Lector/escritor de la sesión en almacenamiento seguro.
class TokenStorage {
  TokenStorage({FlutterSecureStorage? storage}) : _storage = storage ?? _default();

  final FlutterSecureStorage _storage;

  /// Claves versionadas con prefijo, para poder migrar sin ambigüedad.
  static const String _kAccess = 'lc.auth.accessToken';
  static const String _kRefresh = 'lc.auth.refreshToken';
  static const String _kExpires = 'lc.auth.expiresAt';
  static const String _kUser = 'lc.auth.user';

  /// Espejo en memoria de la sesión viva.
  StoredSession? _cache;
  bool _loaded = false;
  Future<StoredSession?>? _loading;

  /// Configuración por defecto.
  ///
  /// - Android: cifrado en reposo del propio paquete (Keystore).
  /// - iOS/macOS: Keychain accesible desde el primer desbloqueo, porque el POS
  ///   puede arrancar en segundo plano con la pantalla bloqueada.
  /// - Web: `localStorage` + cifrado con WebCrypto. EXIGE que la página se
  ///   sirva por HTTPS o desde `localhost`; sin WebCrypto el plugin falla, y
  ///   este código degrada a "sin sesión persistente" en vez de romper el
  ///   arranque (ver [save] y [clear]).
  static FlutterSecureStorage _default() {
    return const FlutterSecureStorage(
      aOptions: AndroidOptions(),
      iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock),
      webOptions: WebOptions(
        dbName: 'latte_coffee',
        publicKey: 'latte_coffee_secure_v1',
      ),
    );
  }

  /// Lee la sesión. `null` si no hay nada guardado o está corrupto.
  ///
  /// Una vez cargada, la respuesta sale del ESPEJO EN MEMORIA: el interceptor de
  /// autenticación lee el token en cada request y volver al almacén del sistema
  /// cada vez costaría un platform channel (y en web, un descifrado RSA).
  ///
  /// Las llamadas concurrentes que llegan antes de la primera lectura comparten
  /// UNA: varias peticiones arrancan a la vez y no tiene sentido ir al disco N
  /// veces.
  Future<StoredSession?> read() {
    final StoredSession? cached = _cache;
    if (_loaded && cached != null) {
      return Future<StoredSession?>.value(cached);
    }
    final Future<StoredSession?>? inFlight = _loading;
    if (inFlight != null) return inFlight;
    return _loading = _readOnce().whenComplete(() => _loading = null);
  }

  /// Sobrescribe la sesión (login, registro o refresh rotativo).
  ///
  /// Nunca lanza: si el plugin no está disponible (web sin HTTPS, escritorio sin
  /// keychain), la sesión vive solo en memoria durante esta ejecución y la app
  /// sigue funcionando.
  Future<void> save(StoredSession session) async {
    _cache = session;
    _loaded = true;
    try {
      await _storage.write(key: _kAccess, value: session.accessToken);
      await _storage.write(key: _kRefresh, value: session.refreshToken);
      await _storage.write(
        key: _kExpires,
        value: session.expiresAt.toIso8601String(),
      );
      final String? user = session.userJson;
      if (user != null) {
        await _storage.write(key: _kUser, value: user);
      } else {
        await _storage.delete(key: _kUser);
      }
    } on Object {
      // Sin almacén: la sesión queda solo en memoria.
    }
  }

  /// Guarda solo el perfil cacheado, sin tocar los tokens.
  Future<void> saveUser(Map<String, dynamic> user) async {
    final StoredSession? current = await read();
    if (current == null) return;
    await save(
      StoredSession(
        accessToken: current.accessToken,
        refreshToken: current.refreshToken,
        expiresAt: current.expiresAt,
        userJson: jsonEncode(user),
      ),
    );
  }

  /// Borra la sesión (logout, refresh fallido, contraseña restablecida).
  ///
  /// Nunca lanza: limpiar dos veces no es un error, y fallar en el borrado NO
  /// puede dejar a la UI creyendo que sigue autenticada.
  Future<void> clear() async {
    _cache = null;
    _loaded = true;
    try {
      await _storage.delete(key: _kAccess);
      await _storage.delete(key: _kRefresh);
      await _storage.delete(key: _kExpires);
      await _storage.delete(key: _kUser);
    } on Object {
      return;
    }
  }

  /// `true` si el access token caduca dentro de [leeway].
  ///
  /// API.md §2: el cliente renueva cuando al token le quedan menos de 60 s.
  Future<bool> needsRefresh(Duration leeway) async {
    final StoredSession? session = await read();
    if (session == null) return false;
    return DateTime.now().toUtc().isAfter(session.expiresAt.subtract(leeway));
  }

  /// `true` si se intentó leer el almacén alguna vez. Para diagnóstico.
  bool get isLoaded => _loaded;

  // ----------------------------------------------------------------- Privados
  Future<StoredSession?> _readOnce() async {
    try {
      final Map<String, String> values = await _storage.readAll();
      final String? access = values[_kAccess];
      final String? refresh = values[_kRefresh];
      final String? expires = values[_kExpires];
      // Se escribe `_cache` en ambos caminos: también cuando no hay sesión, para
      // que un arranque sin login no vuelva a golpear el almacén en cada
      // lectura mientras la sesión siga ausente.
      _cache = null;
      if (access == null || refresh == null || expires == null) return null;
      final DateTime? expiresAt = DateTime.tryParse(expires);
      if (expiresAt == null) return null;
      return _cache = StoredSession(
        accessToken: access,
        refreshToken: refresh,
        expiresAt: expiresAt.toUtc(),
        userJson: values[_kUser],
      );
    } on Object {
      _cache = null;
      return null;
    } finally {
      _loaded = true;
    }
  }
}
