# macOS (escritorio)

Esta carpeta está **intencionalmente vacía de código nativo**: los archivos
binarios y de proyecto los genera el SDK de Flutter, no se escriben a mano.

## Cómo generarla

Desde la raíz de `frontend/`:

```bash
# regenerar solo esta plataforma
flutter create --platforms=macos .

# regenerar todas (equivalente a la sección "Prerrequisitos" del README raíz)
flutter create --platforms=android,ios,web,linux,windows,macos .
```

`flutter create` no pisa `lib/`, `pubspec.yaml`, `analysis_options.yaml` ni
`web/index.html` / `web/manifest.json` (esos ya están escritos a mano).

Genera `macos/` (Xcode + CocoaPods). Requiere `pod install` y firma de desarrollo para ejecutar.

## Por qué no se versiona

Los archivos nativos (Gradle wrappers, `xcodeproj`, `CMakeCache.txt`, binarios)
son específicos de la versión del SDK y de la máquina. Versionarlos genera
conflictos constantes sin aportar nada al sistema de diseño.

**Importante:** esta carpeta no fue generada en el equipo que creó el código
porque el SDK de Flutter no está instalado allí. Hay que correr el comando
antes de intentar `flutter build` o `flutter run`.
