// Modo de tema de la app: Sistema / Claro / Oscuro.
//
// POR QUÉ EXISTE
// El usuario pidió no depender del interruptor del sistema: la app se abre en el
// modo que él eligió la última vez. `MaterialApp.router` observaba
// `ThemeMode.system` fijo, así que el ajuste tenía que vivir FUERA del sistema
// operativo y dentro de la app.
//
// LOS TRES ESTADOS Y POR QUÉ "SISTEMA" SIGUE SIENDO EL DEFECTO
// `ThemeMode` de Material ya trae los tres. El valor por defecto es
// `ThemeMode.system` para no cambiar el comportamiento de golpe: quien no toca
// el ajuste sigue viendo exactamente lo que veía, que es lo que decide su
// sistema. "Sistema" no es un cuarto caso ni un valor vacío: es un estado
// seleccionable que se GUARDA y se vuelve a leer.
//
// DÓNDE SE PERSISTE
// `PreferencesStorage` (`core/storage/`), que es la caché de negocio NO sensible
// y ya está cableada al `KeyValueStore` que `main()` inyecta con
// `keyValueStoreProvider.overrideWithValue(...)`. Por eso este controlador NO
// crea su propio `SharedPreferences`: hereda el mismo almacén, y si ese
// almacenamiento falla y `main()` cae al almacén en memoria, el tema se comporta
// igual (dura lo que la sesión) en vez de romper.
//
// La escritura es "optimista": `state` cambia ANTES de escribir en disco. La
// pantalla se repinta en el mismo frame y la persistencia va detrás; si el
// `SharedPreferences` fallara, lo vería el usuario en el siguiente arranque, y
// perder una preferencia de tema es preferible a congelar la UI.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/di/providers.dart';
import '../../core/storage/preferences_storage.dart';

/// Modo de tema efectivo de la app. Lo observa `LatteCoffeeApp`.
///
/// No es `autoDispose`: es una preferencia global, no un estado de pantalla. Que
/// sobreviva al cambio de pestaña es justo lo que se quiere.
final NotifierProvider<ThemeModeController, ThemeMode> themeModeProvider =
    NotifierProvider<ThemeModeController, ThemeMode>(
  ThemeModeController.new,
  name: 'themeMode',
);

/// Controlador del modo de tema. Una sola fuente de verdad: la UI llama a
/// [select] y lee [themeModeProvider].
class ThemeModeController extends Notifier<ThemeMode> {
  @override
  ThemeMode build() {
    // `watch`, no `read`: si el almacén cambia (de `SharedPreferences` a memoria
    // en un arranque futuro) el tema se vuelve a leer en vez de quedarse con el
    // valor del almacén viejo.
    final PreferencesStorage prefs = ref.watch(preferencesStorageProvider);
    return themeModeFromName(prefs.themeModeName);
  }

  /// Fija el modo y lo persiste. Idempotente: si ya estaba en [mode] no escribe.
  ///
  /// "Sistema" se persiste como AUSENCIA de preferencia (se borra la clave), no
  /// como la cadena `'system'`: así, si alguien vuelve a una versión anterior que
  /// solo sabía leer `lc.ui.darkMode`, su preferencia explícita no se pisa con un
  /// "sigue al sistema" que nunca eligió.
  Future<void> select(ThemeMode mode) async {
    if (state == mode) return;
    state = mode;
    await ref.read(preferencesStorageProvider).setThemeModeName(
          mode == ThemeMode.system ? null : themeModeName(mode),
        );
  }

  /// Atajo para un botón que solo tiene dos salidas ("cambiar el tema").
  ///
  /// Desde [ThemeMode.system] se va a [ThemeMode.dark]: es el gesto que espera
  /// quien pulsa un botón de luna sobre un tema que el sistema tiene en claro.
  /// Desde un modo explícito se alterna claro/oscuro. "Sistema" sigue siendo
  /// alcanzable en el selector de Perfil, que sí ofrece las tres opciones.
  Future<void> toggleLightDark() {
    final ThemeMode next = switch (state) {
      ThemeMode.dark => ThemeMode.light,
      ThemeMode.light || ThemeMode.system => ThemeMode.dark,
    };
    return select(next);
  }
}

/// `ThemeMode` → nombre estable para `PreferencesStorage`.
///
/// Se guarda el NOMBRE y no el índice del enum: reordenar el enum no puede
/// cambiar lo que significa lo que hay escrito en el dispositivo del usuario.
String themeModeName(ThemeMode mode) => switch (mode) {
      ThemeMode.system => 'system',
      ThemeMode.light => 'light',
      ThemeMode.dark => 'dark',
    };

/// Nombre guardado → `ThemeMode`. Cualquier valor desconocido cae en `system`.
///
/// Un dispositivo con una clave corrupta (o de una versión futura) NO debe dejar
/// la app sin tema: "seguir al sistema" siempre es una respuesta válida.
ThemeMode themeModeFromName(String? name) => switch (name) {
      'light' => ThemeMode.light,
      'dark' => ThemeMode.dark,
      _ => ThemeMode.system,
    };
