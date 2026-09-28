# Latte Coffee — Frontend (Flutter)

App Flutter del POS **Latte Coffee**: cafetería + alquiler de sillas/espacios.
En esta fase el repositorio contiene **solo el sistema de diseño y los cimientos
arquitectónicos**; ninguna feature de negocio está implementada.

- Sistema de diseño y tokens: [`../docs/DESIGN-TOKENS.md`](../docs/DESIGN-TOKENS.md)
- Contrato de API: [`../docs/API.md`](../docs/API.md)
- Arquitectura y reglas de negocio: [`../docs/DESIGN.md`](../docs/DESIGN.md)

> ⚠️ **El SDK de Flutter NO estaba instalado en la máquina donde se generó este
> código.** Por eso no se pudo ejecutar `flutter pub get`, `flutter analyze` ni
> `flutter test`: el código está revisado a mano, no por el analizador. La
> primera vez que clones, corre `flutter pub get && flutter analyze` y trata
> cualquier hallazgo como bug de este repositorio.

---

## 1. Prerrequisitos

| Herramienta | Versión mínima | Para qué |
|---|---|---|
| Flutter SDK | 3.22 (estable) | Build, analyze, test |
| Dart SDK | 3.4 (incluido en Flutter) | `sealed class`, `switch` expressions |
| Android Studio / Xcode / VS | con toolchains | solo para las plataformas móviles |
| Node 18+ | opcional | tooling de pruebas e2e |

```bash
flutter --version     # debe imprimir Flutter 3.22 o superior
flutter doctor -v     # valida toolchains por plataforma
```

## 2. Generar las carpetas de plataforma

Las carpetas `android/`, `ios/`, `linux/`, `windows/` y `macos/` están aquí
**sin código nativo**: lo genera el SDK, no se escribe a mano (los wrappers de
Gradle, los `.xcodeproj` y los `CMakeCache.txt` son específicos de la versión
del SDK y de la máquina; versionarlos solo genera conflictos).

```bash
cd frontend
flutter create --platforms=android,ios,web,linux,windows,macos .
```

Eso crea los archivos nativos **sin tocar** `lib/`, `pubspec.yaml`,
`analysis_options.yaml`, `web/index.html` ni `web/manifest.json`, que ya están
escritos a mano. `web/` sí tiene contenido: `index.html` (con la pantalla de
arranque de marca) y `manifest.json`.

Detalles por plataforma (permisos, `usesCleartextTraffic`, claves de `Info.plist`)
en el `README.md` de cada carpeta.

## 3. Dependencias

```bash
flutter pub get
dart run build_runner build --delete-conflicting-outputs   # cuando haya freezed/json
```

| Paquete | Versión | Por qué |
|---|---|---|
| `flutter_riverpod` | ^2.5.1 | Estado + DI; `AsyncValue` es la entrada de `AsyncStateBuilder`. |
| `go_router` | ^14.2.0 | Rutas declarativas, guards por permiso, redirección. |
| `dio` | ^5.4.3 | Interceptores, `CancelToken`, retry con backoff, timeouts finos. |
| `fl_chart` | ^0.68.0 | Dashboard y reportes. |
| `shared_preferences` | ^2.2.3 | Caché no sensible (tema, business). Los tokens NO van aquí. |
| `cached_network_image` | ^3.3.1 | Imágenes de producto con caché en disco y placeholder. |
| `intl` | ^0.19.0 | Formato es-CO de moneda, fechas y duraciones. |
| `equatable` | ^2.0.5 | Comparación por valor en entidades. |
| `freezed_annotation` + `json_annotation` | ^2.4.4 / ^4.9.0 | Generación de entidades y DTOs. |
| `build_runner` + `freezed` + `json_serializable` | dev | Generadores. |

## 4. Configurar la API

La URL del backend se inyecta en tiempo de compilación. **No hay archivos de
configuración locales.**

```bash
# Android emulador (localhost del host se ve como 10.0.2.2)
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000/api/v1

# iOS simulator / escritorio / web
flutter run --dart-define=API_BASE_URL=http://localhost:3000/api/v1

# producción
flutter build web --dart-define=API_BASE_URL=https://api.lattecoffee.co/api/v1
```

| Variable | Por defecto | Nota |
|---|---|---|
| `API_BASE_URL` | `http://localhost:3000/api/v1` | Incluye el prefijo `/api/v1`. |

Todo lo demás (paginación, timeouts, locale, zona horaria) vive en
`lib/core/config/app_config.dart`.

## 5. Ejecutar

```bash
flutter run                                  # dispositivo conectado
flutter run -d chrome                        # web
flutter run -d linux                         # escritorio (layout admin)
flutter test                                 # suite
flutter analyze                              # lint estricto (ver analysis_options.yaml)
```

## 6. Estructura de carpetas

```
lib/
├── main.dart                       # punto de entrada mínimo
├── app/
│   ├── app.dart                    # MaterialApp.router + tema
│   ├── router.dart                 # GoRouter (rutas raíz con placeholder)
│   ├── breakpoints.dart            # re-export de theme/responsive/breakpoints.dart
│   └── theme/                      # SISTEMA DE DISEÑO
│       ├── app_colors.dart         # ÚNICO lugar con hex literales
│       ├── app_typography.dart      # escala tipográfica
│       ├── app_spacing.dart        # escala 4pt + objetivos táctiles
│       ├── app_radii.dart
│       ├── app_shadows.dart
│       ├── app_borders.dart
│       ├── app_theme.dart          # ThemeData light + dark
│       └── responsive/breakpoints.dart
├── core/                           # transversal, no depende de features
│   ├── config/app_config.dart
│   ├── error/{failures,error_mapper}.dart
│   ├── network/  storage/  di/     # fase siguiente (ver README de cada uno)
│   ├── result/result.dart          # Result<T> sellado, sin excepciones
│   └── utils/{currency_formatter,date_formatter}.dart
├── domain/                         # entidades, contratos, casos de uso
│   ├── entities/ repositories/ usecases/
├── data/                           # DTOs, datasources, implementaciones
│   ├── models/ datasources/remote/ datasources/local/ repositories/
├── features/                       # una carpeta por feature, sin implementar
│   ├── auth/ menu/ product_detail/ cart/ checkout/ orders/
│   ├── chair/ reservation/ profile/ pos/ admin/
├── shared/                         # sistema de diseño reutilizable
│   ├── widgets/                    # adaptive_scaffold, app_sidebar, brand_mark
│   ├── widgets/ui/                 # componentes base
│   ├── constants/app_destination.dart
│   └── utils/
└── routing/                        # guards, nombres de ruta, shell (fase siguiente)
```

Cada carpeta de `core/`, `domain/`, `data/` y `routing/` tiene un `README.md`
con su contrato y lo que falta.

## 7. Inventario del sistema de diseño

### Tokens (`lib/app/theme/`)

| Archivo | Contenido |
|---|---|
| `app_colors.dart` | `AppPalette` (literales), `AppColors` (semánticos), `AppStateColors` (sillas/pedidos), `AppChartColors` (gráficos) |
| `app_typography.dart` | `AppTextStyles` (18 roles + 5 especiales) y `buildAppTextTheme` |
| `app_spacing.dart` | Escala 4 pt (`AppSpacing`) + objetivos táctiles (`AppTapTarget`) |
| `app_radii.dart` | Radios + helpers (`pill`, `md`, `lg`…) |
| `app_shadows.dart` | `AppElevation` + 5 niveles difusos |
| `app_borders.dart` | Grosores, bordes por intención, separadores |
| `app_theme.dart` | `ThemeData` light completo + dark coherente |
| `responsive/breakpoints.dart` | `Breakpoint`, `Breakpoints`, `context.breakpoint` |

### Widgets (`lib/shared/`)

| Archivo | Qué es |
|---|---|
| `adaptive_scaffold.dart` | Shell: NavigationBar / NavigationRail / Sidebar según breakpoint |
| `adaptive_layout.dart` | Tabla "breakpoint → forma de navegación" |
| `adaptive_nav_bars.dart` | `AppNavigationBar`, `AppNavigationRail` |
| `app_sidebar.dart` + `sidebar_item.dart` | Sidebar de escritorio y su item |
| `brand_mark.dart` | Monograma + nombre |
| `constants/app_destination.dart` | `AppDestination` |
| `ui/app_button.dart` + `app_button_style.dart` | Botón (5 variantes, 3 tamaños, loading/disabled/fullWidth) |
| `ui/app_card.dart` | Card (elevated/outlined/flat) |
| `ui/product_card.dart` | Card de producto con favorito |
| `ui/app_text_field.dart` | Input con password, error, contador |
| `ui/status_badge.dart` + `status_badge_visuals.dart` + `status_badge_visuals_ops.dart` + `status_badge_resolver.dart` | **Único** lugar donde vive "cómo se ve un estado" |
| `ui/category_chip.dart` + `category_chip_row.dart` | Chips de filtro |
| `ui/price_display.dart` | Precio normal / grande / promo / por unidad |
| `ui/async_state_builder.dart` | **Orquestador de los 6 estados de UI** |
| `ui/empty_state.dart` | Estado vacío con ilustración `CustomPaint` |
| `ui/error_state.dart` + `error_details_panel.dart` | Error con reintento y detalle técnico (debug) |
| `ui/offline_state.dart` | Sin conexión + operaciones pendientes |
| `ui/loading_state.dart` + `shimmer.dart` | `AppSpinner`, `ShimmerBox`, `ShimmerList` |
| `ui/progress_ring.dart` | Anillo de progreso (% de ocupación) |
| `ui/confirm_dialog.dart` | Confirmación con `DialogAction` |
| `ui/section_header.dart` | Título + subtítulo + "ver todo" |
| `ui/kpi_tile.dart` | Tile de KPI con delta |
| `ui/empty_placeholder_image.dart` | Placeholder con iniciales para productos sin foto |

## 8. Reglas del repositorio (no negociables)

1. **Cero colores literales fuera de `app/theme/app_colors.dart`.** Si necesitas
   un color que no existe, agrégalo como token: no lo escribas en el widget.
2. **Cero textos de negocio en widgets base.** `StatusBadge` conoce el estado
   (es diseño), `OrderDetailsScreen` conoce el texto (es feature).
3. **Cero widgets gigantes.** Un archivo, una responsabilidad, ≤ ~150 líneas.
4. **Cero spinners propios.** Todo estado asíncrono pasa por
   `AsyncStateBuilder` (loading / éxito / vacío / error / offline / no autorizado).
5. **Cero money math en la UI.** El dinero entra como `int` centavos y sale
   formateado por `PriceDisplay` / `CurrencyFormatter`. El total definitivo
   siempre lo devuelve el servidor (BR-PRICE-008).
6. **Nunca solo color.** Todo estado lleva texto + ícono. Ver §6 de DESIGN-TOKENS.
7. **Target táctil ≥ 44 dp** en cualquier control interactivo.
8. **Imports relativos** dentro de `lib/`: renombrar el paquete no debe tocar
   60 archivos (`prefer_relative_imports`). `package:` solo para dependencias.

## 9. Cómo añadir un widget al sistema de diseño

1. **Antes de escribirlo**, revisa si ya existe uno que cubra el caso
   (`ls lib/shared/widgets/ui/`). Duplicar estilos es la principal causa de
   inconsistencia visual.
2. Ubícalo en `lib/shared/widgets/ui/<nombre>.dart`. El nombre empieza por
   `App` (`AppCard`, `AppButton`, `AppTextField`) salvo que sea un estado
   (`EmptyState`, `ErrorState`).
3. Empieza con un doc comment que responda **cuándo usarlo**, no qué hace, e
   incluye un ejemplo de uso copiable.
4. **Sin lógica de negocio**: todo lo específico entra por parámetro.
5. **Inmutable**: `StatelessWidget` siempre que se pueda; `StatefulWidget` solo
   con animación/estado local real (y `dispose()` completo).
6. Accesibilidad: `Semantics` con etiqueta en todo control interactivo,
   `tooltip` en botones de solo ícono, target ≥ 44 dp.
7. Si el componente es grande, divídelo: la lógica de estilo va a un archivo
   `nombre_style.dart` del mismo módulo (ver `app_button.dart` / `app_button_style.dart`).
8. Añade una fila a `docs/DESIGN-TOKENS.md` §7 y un test widget en `test/`.

## 10. Convenciones de código

- Dart moderno: `sealed class`, `final class`, `const` donde se pueda,
  `switch` expressions, null safety estricto (ver `analysis_options.yaml`:
  `strict-casts`, `strict-inference`, `strict-raw-types`).
- Comentarios y doc comments **en español**.
- Un fallo de negocio es un `Failure`, nunca una excepción en la capa de datos.
- Los mensajes de UI en español; los `code` del backend en inglés/MAYÚSCULAS
  exactos (`PRODUCT_UNAVAILABLE`), porque son el contrato con el servidor.

## 11. Qué falta para la siguiente fase

- [ ] `core/network/` completo (dio, interceptor de auth, conectividad).
- [ ] `core/storage/` (tokens seguros, caché de negocio).
- [ ] `domain/entities/` + `data/models/` con freezed.
- [ ] Guards de navegación por sesión y permiso (BR-RBAC-005).
- [ ] Las 11 features, empezando por `auth` y `menu`.
- [ ] `flutter pub get` + `flutter analyze` (SDK no disponible al generar esto).
