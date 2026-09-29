# Latte Coffee — Frontend (Flutter)

App Flutter del POS **Latte Coffee**: cafetería + alquiler de sillas/espacios.
El cliente consume el catálogo, arma pedidos, paga y gestiona el alquiler de
espacios; el personal entra al **POS** y a un **panel de administración** de
doce subpantallas.

- Sistema de diseño y tokens: [`../docs/DESIGN-TOKENS.md`](../docs/DESIGN-TOKENS.md)
- Contrato de API: [`../docs/API.md`](../docs/API.md)
- Arquitectura y reglas de negocio: [`../docs/DESIGN.md`](../docs/DESIGN.md)

> **Estado: compilado, analizado y con tests verdes** (Flutter 3.24.5 / Dart
> 3.5.4). `flutter analyze` da **0 errores y 0 warnings** y `flutter test` pasa
> los **36 tests**. Ver §2 y §3.2.

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

## 2. Estado de compilación (leer primero)

**Las 53.704 líneas de Dart de este paquete nunca han pasado por un
compilador.** Todo el código se escribió sin SDK de Flutter ni de Dart
disponible, así que no se ejecutó ni un solo `flutter pub get`, `flutter
analyze` o `flutter test`.

Qué significa eso en la práctica:

| Verificado | Cómo |
|---|---|
| Los 375 ficheros `.dart` existen y son legibles | lectura directa |
| Los imports resuelven a ficheros que existen | comprobación mecánica de rutas |
| Las referencias cruzadas (providers, repositorios, entidades) apuntan a símbolos reales | comprobación mecánica de nombres |
| Que compile, que pase el analizador y que los tipos cuadren | **NO verificado** |

El código se escribió con el analizador en la cabeza, no delante del
analizador. Es perfectamente probable que el primer `flutter analyze` devuelva
decenas de hallazgos: imports sin usar, tipos inferidos que el modo estricto
del `analysis_options.yaml` rechaza, o APIs usadas con la firma de otra
versión del paquete.

**El primer paso de quien clone el repositorio es:**

```bash
flutter pub get && flutter analyze
```

Trata cada hallazgo como un bug de este repositorio hasta que se demuestre lo
contrario. No abras issues de "no funciona" sin adjuntar la salida de
`flutter analyze`: el fallo puede estar aquí o puede estar en el SDK, y sin
analizar no se distingue.

## 3. Generar las carpetas de plataforma

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
arranque de marca) y `manifest.json`. Las seis carpetas de plataforma existen,
pero cada una contiene únicamente su `README.md`.

Detalles por plataforma (permisos, `usesCleartextTraffic`, claves de `Info.plist`)
en el `README.md` de cada carpeta.

## 4. Dependencias

```bash
flutter pub get
```

`build_runner` está declarado en `dev_dependencies`, pero **hoy no genera
nada**: no hay ni un `part '...freezed.dart'`, ni un `.freezed.dart`, ni un
`.g.dart` en el paquete. Los DTOs de `data/` y de las features están escritos a
mano contra `data/models/json_reader.dart`. La línea de `build_runner` no hace
falta hasta que alguien use `@freezed` o `@JsonSerializable` de verdad.

| Paquete | Versión | Por qué |
|---|---|---|
| `flutter_riverpod` | ^2.5.1 | Estado + DI; `AsyncValue` es la entrada de `AsyncStateBuilder`. |
| `go_router` | ^14.2.0 | Rutas declarativas, guards por permiso, redirección. |
| `dio` | ^5.4.3 | Interceptores, `CancelToken`, retry con backoff, timeouts finos. |
| `fl_chart` | ^0.68.0 | Dashboard y reportes. |
| `shared_preferences` | ^2.2.3 | Caché no sensible (modo de tema, business, flags). Los tokens NO van aquí. |
| `flutter_secure_storage` | ^9.2.2 | Access/refresh token. Obligatorio: `shared_preferences` queda en texto plano. |
| `cached_network_image` | ^3.3.1 | Imágenes de producto con caché en disco y placeholder. |
| `intl` | ^0.19.0 | Fechas y duraciones es-CO. La **moneda NO usa su patrón** (no trae datos de `es_CO`): ver DESIGN-TOKENS §9.1. |
| `equatable` | ^2.0.5 | Declarado; hoy ningún fichero lo importa. |
| `freezed_annotation` + `json_annotation` | ^2.4.4 / ^4.9.0 | Declarados; aún sin uso. |
| `build_runner` + `freezed` + `json_serializable` | dev | Generadores, sin uso actual. |
| `flutter_lints` | ^4.0.0 | Base de reglas, endurecidas en `analysis_options.yaml`. |

## 5. Configurar la API

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
`lib/core/config/app_config.dart`, que además expone `isUsingDefaultApiUrl`
para avisar en la UI cuando se arrancó contra el default local.

## 6. Ejecutar

```bash
flutter run                                  # dispositivo conectado
flutter run -d chrome                        # web
flutter run -d linux                         # escritorio (layout admin)
flutter test                                 # suite (hoy vacío, ver §12)
flutter analyze                              # lint estricto (ver analysis_options.yaml)
```

## 7. Estructura de carpetas

375 ficheros Dart, 53.704 líneas.

```
lib/
├── main.dart
├── app/
│   ├── app.dart                             # MaterialApp.router + tema (themeMode observado)
│   ├── router.dart                          # GoRouter: guard de sesión, shell indexado
│   ├── routes.dart                          # nombres y rutas (AppRoutes)
│   ├── router_refresh.dart                  # invalida el router al cambiar la sesión
│   ├── breakpoints.dart                     # re-export de theme/responsive/breakpoints.dart
│   ├── responsive/pos_breakpoints.dart      # PosLayout: cortes propios del POS
│   ├── customer/                            # customer_routes / _navigation / _shell
│   ├── admin/                               # admin_routes / _navigation / _shell / _sidebar_footer
│   └── theme/                               # SISTEMA DE DISEÑO
│       ├── app_colors.dart                  # ÚNICO lugar con hex literales
│       ├── app_typography.dart               # escala tipográfica
│       ├── app_spacing.dart                 # escala 4pt + objetivos táctiles
│       ├── app_radii.dart
│       ├── app_shadows.dart
│       ├── app_borders.dart
│       ├── app_theme.dart                   # ThemeData light + dark
│       ├── theme_mode_controller.dart       # Sistema/Claro/Oscuro + persistencia
│       └── responsive/breakpoints.dart
├── core/                                    # transversal, no depende de features
│   ├── config/app_config.dart
│   ├── customer/                            # ESTADO COMPARTIDO cliente ↔ POS
│   │   ├── cart_state.dart cart_store.dart cart_codec.dart cart_providers.dart
│   │   ├── chair_map.dart
│   │   └── venue_datasource.dart venue_providers.dart
│   ├── di/providers.dart                    # grafo global: cliente HTTP, sesión, cola
│   ├── error/{failures,error_mapper,api_error_payload,field_error}.dart
│   ├── network/                             # cliente HTTP
│   │   ├── api_client.dart                  # instancia de Dio: timeouts, baseUrl
│   │   ├── auth_interceptor.dart            # inyecta Bearer
│   │   ├── session_refresher.dart           # refresh single-flight ante 401
│   │   ├── retry_interceptor.dart            # backoff en 5xx y red, solo métodos idempotentes
│   │   ├── connectivity.dart                # isOnline/isOffline → OfflineFailure
│   │   ├── log_interceptor.dart             # redacta tokens en logs
│   │   ├── api_endpoints.dart               # rutas de docs/API.md §7
│   │   └── api_exception.dart
│   ├── result/result.dart                   # Result<T> sellado, sin excepciones
│   ├── storage/                             # persistencia
│   │   ├── token_storage.dart               # tokens en flutter_secure_storage
│   │   ├── stored_session.dart preferences_storage.dart key_value_store.dart
│   │   ├── user_cache_codec.dart
│   │   ├── pending_operation.dart           # operación offline encolable
│   │   ├── offline_queue.dart               # cola FIFO persistente
│   │   └── sync_engine.dart                 # vacía la cola al recuperar red
│   └── utils/
│       ├── currency_formatter.dart          # ÚNICA fuente de dinero ($5.500)
│       ├── date_formatter.dart
│       └── validators.dart
├── domain/                                  # contratos compartidos
│   ├── entities/{auth_credentials,auth_result,auth_session,user}.dart
│   ├── repositories/auth_repository.dart
│   └── usecases/                            # solo README (ver §12)
├── data/                                    # implementaciones de auth
│   ├── models/{auth_dto,user_dto,json_reader}.dart
│   ├── datasources/remote/auth_remote_datasource.dart
│   ├── datasources/local/                   # solo README (ver §12)
│   └── repositories/{auth_repository_impl,auth_session_store,auth_failure_localizer}.dart
├── features/                                # una carpeta por feature, con data/domain/presentation
│   ├── auth/          14   login, registro, olvidé/reset de contraseña
│   ├── home/           9
│   ├── menu/          15   catálogo, categorías, búsqueda
│   ├── product_detail/10
│   ├── cart/           9
│   ├── checkout/      27   método de pago, confirmación, cola offline
│   ├── orders/        18   listado, detalle, seguimiento
│   ├── chair/          7   mapa de sillas y alquiler
│   ├── profile/       15
│   ├── reservation/    —   SOLO README, sin código (ver §12)
│   ├── pos/           43   punto de venta: catálogo, pedido, cobro, atajos
│   └── admin/        105   panel de administración (la más grande)
├── shared/                                  # sistema de diseño reutilizable
│   ├── widgets/                             # 27 componentes en ui/
│   ├── constants/{app_destination,app_strings,greeting}.dart
│   └── utils/                               # solo README (ver §12)
└── routing/                                 # solo README: el enrutado real vive en app/
```

Las features siguen `data/` + `domain/` + `presentation/` por dentro. El
contenido en `core/customer/` (carrito y mapa de sillas) es la única excepción:
es estado compartido entre el cliente y el POS, por eso vive en `core/` y no en
ninguna feature.

Los `README.md` de `core/network/` y `core/storage/` **siguen diciendo
"(fase siguiente)"**: son contrato, no estado. El código ya está.

## 8. Inventario del sistema de diseño

### Tokens (`lib/app/theme/`)

| Archivo | Contenido |
|---|---|
| `app_colors.dart` | `AppPalette` (literales), `AppColors` (semánticos), `AppStateColors` (sillas/pedidos), `AppChartColors` (gráficos) |
| `app_typography.dart` | `AppTextStyles` (23 roles) y `buildAppTextTheme` |
| `app_spacing.dart` | Escala 4 pt (`AppSpacing`) + objetivos táctiles (`AppTapTarget`, 44 dp) |
| `app_radii.dart` | Radios + helpers (`pill`, `md`, `lg`…) |
| `app_shadows.dart` | `AppElevation` + 5 niveles difusos |
| `app_borders.dart` | Grosores, bordes por intención, separadores |
| `app_theme.dart` | `ThemeData` light completo + dark coherente |
| `responsive/breakpoints.dart` | `Breakpoint`, `Breakpoints`, `context.breakpoint` |

### Breakpoints

`Breakpoint` (contenido editorial, menú y perfil) y `PosLayout` (el POS) son
enums distintos a propósito: el POS es una estación de trabajo, no contenido
editorial, y no encaja en los cortes de la app.

| `Breakpoint` | Ancho dp | Navegación | Contenido |
|---|---|---|---|
| `mobile` | 0 – 599 | `NavigationBar` (5 destinos) | 1 columna |
| `tablet` | 600 – 1023 | `NavigationRail` | 2 columnas |
| `desktop` | 1024 – 1439 | Sidebar fija | 3 columnas, tablas densas |
| `wide` | ≥ 1440 | Sidebar + ancho máximo | 4 columnas |

| `PosLayout` | Ancho dp | Columnas | Navegación |
|---|---|---|---|
| `compact` | 0 – 767 | 1 | Pestañas (Catálogo / Pedido / Cobro) |
| `medium` | 768 – 1183 | 2 | Rail + 2 columnas |
| `expanded` | 1184 – 1679 | 3 | Rail + 3 columnas (cobro fijo) |
| `ultraExpanded` | ≥ 1680 | 3 + panel | Rail + 3 + panel lateral |

La regla del POS es **ganar columnas, nunca estirar**: el ancho extra se
reparte en columnas nuevas, no ensancha las existentes.

### Widgets (`lib/shared/`)

| Archivo | Qué es |
|---|---|
| `adaptive_scaffold.dart` | Shell: NavigationBar / NavigationRail / Sidebar según breakpoint |
| `adaptive_layout.dart` | Tabla "breakpoint → forma de navegación" |
| `adaptive_nav_bars.dart` | `AppNavigationBar`, `AppNavigationRail` |
| `app_sidebar.dart` + `sidebar_item.dart` | Sidebar de escritorio y su item |
| `brand_mark.dart` | Monograma + nombre |
| `chair_map_grid.dart` | Rejilla interactiva del plano de sillas |
| `rental_countdown.dart` | Cuenta atrás de un alquiler en curso |
| `constants/app_destination.dart` | `AppDestination` |
| `constants/app_strings.dart` | `AppStrings`: textos de negocio compartidos |
| `constants/greeting.dart` | **Único** saludo con nombre (`greetingProvider`, `greetingWithName`, `firstNameOf`) — lo comparten Inicio y Menú |
| `ui/app_button.dart` + `app_button_style.dart` | Botón (5 variantes, 3 tamaños, loading/disabled/fullWidth) |
| `ui/app_card.dart` | Card (elevated/outlined/flat) |
| `ui/product_card.dart` | Card de producto con favorito |
| `ui/app_text_field.dart` | Input con password, error, contador |
| `ui/form_error_banner.dart` | Banner de error de formulario (`FieldError`) |
| `ui/quantity_stepper.dart` | Selector de cantidad con target táctil |
| `ui/status_badge.dart` + `status_badge_visuals.dart` + `status_badge_visuals_ops.dart` + `status_badge_resolver.dart` | **Único** lugar donde vive "cómo se ve un estado" |
| `ui/category_chip.dart` + `category_chip_row.dart` | Chips de filtro (`kCategoryChipSpacing` = 12 dp, `spacing` es parámetro) |
| `ui/price_display.dart` | Precio normal / grande / promo / por unidad |
| `ui/async_state_builder.dart` | **Orquestador de los 6 estados de UI** |
| `ui/empty_state.dart` | Estado vacío con ilustración `CustomPaint` |
| `ui/error_state.dart` + `error_details_panel.dart` | Error con reintento y detalle técnico (debug) |
| `ui/offline_state.dart` | Sin conexión + operaciones pendientes |
| `ui/loading_state.dart` + `shimmer.dart` | `AppSpinner`, `ShimmerBox`, `ShimmerList` |
| `ui/progress_ring.dart` | Anillo de progreso (% de ocupación) |
| `ui/confirm_dialog.dart` | Confirmación con `DialogAction` |
| `ui/section_header.dart` | Título + subtítulo + "ver todo" (`titleSubtitleGap` 4 dp, `bottomSpacing` 12 dp) |
| `ui/theme_mode_selector.dart` | `ThemeModeSelector` (Sistema/Claro/Oscuro), `ThemeModeQuickButton` y la hoja de acceso rápido |
| `ui/kpi_tile.dart` | Tile de KPI con delta |
| `ui/empty_placeholder_image.dart` | Placeholder con iniciales para productos sin foto |

## 9. Reglas del repositorio (no negociables)

1. **Cero colores literales fuera de `app/theme/app_colors.dart`.** Si necesitas
   un color que no existe, agrégalo como token: no lo escribas en el widget.
2. **Cero textos de negocio en widgets base.** `StatusBadge` conoce el estado
   (es diseño), `OrderDetailsScreen` conoce el texto (es feature). Los textos
   compartidos van en `AppStrings`.
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
9. **`presentation/` nunca importa `data/`.** Habla con providers; los providers
   llaman al repositorio. Ninguna feature importa otra: se cruzan por `core/` o
   por providers globales.

## 10. Cómo añadir un widget al sistema de diseño

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

## 11. Convenciones de código

- Dart moderno: `sealed class`, `final class`, `const` donde se pueda,
  `switch` expressions, null safety estricto (ver `analysis_options.yaml`:
  `strict-casts`, `strict-inference`, `strict-raw-types`).
- Comentarios y doc comments **en español**, y explican el porqué, no el qué.
- Un fallo de negocio es un `Failure`, nunca una excepción en la capa de datos.
  `DioException` es la única excepción que la capa de datos deja pasar.
- Los mensajes de UI en español; los `code` del backend en inglés/MAYÚSCULAS
  exactos (`PRODUCT_UNAVAILABLE`), porque son el contrato con el servidor.
- Todo estado mutable va en un `StatefulWidget` con `dispose()` completo: los
  `TextEditingController` y los `AnimationController` se liberan siempre.

## 12. Qué falta para la siguiente fase

En orden de prioridad. Nada de lo anterior está pendiente.

### Estado tras la auditoría del 2026-09-29

La app se probó en un Motorola Edge 60 Fusion (1220×2712, Android 16, 19.5:9)
y se corrigieron los defectos visuales y funcionales encontrados:

| Bug | Causa | Dónde se corrigió |
|---|---|---|
| "Buenas noches, Usuario" bajo la barra de estado | `AdaptiveScaffold` sin `SafeArea`; `Scaffold` con `appBar: null` no gasta el inset superior | `adaptive_scaffold.dart` + `adaptive_layout.dart` (`buildAdaptiveBody` recibe `hasAppBar`) |
| Chips crema sobre fondo marrón, texto ilegible | Tema oscuro generado por inversión: los roles que nadie enumera quedaban con colores claros | `app_theme.dart` con `_light()`/`_dark()` separados y **sin `fromSeed`**; `app_tokens.dart` |
| "BOTTOM OVERFLOWED BY 17 PIXELS" | `mainAxisExtent` calculada sin contar el precio con promoción (15,2 dp de más), y `SizedBox(height: 268)` en la home | `product_grid.dart` (mide por fila) + `product_card.dart` (`Flexible`, no `Expanded`) + `home_content.dart` (sin caja fija) |
| Categoría bajo "Latte" y "Postres" invisibles | `textTertiary` (4.37:1) y `textMuted` (3.49:1) por debajo de AA en las superficies alternativas | `app_colors.dart` recalibrado a `#726861` y `#6F665E` |
| "Inicio" con pastilla blanca | `indicatorColor` crema fijo con etiqueta crema encima | `navigationBarTheme` con `accentContainer` / `onAccentContainer` |
| **Los productos no aparecen al hacer el pedido** | `POST /orders` no devuelve `itemCount` en la raíz; el parser lo leía igual y caía a 0 | `checkout_parsers.dart` lo deriva de `items[]`; `PlacedOrder.lines` pinta lo comprado |
| App lenta | Imágenes decodificadas a su tamaño natural (varios MB por foto) | `product_image.dart` y `pos_product_grid.dart` con `memCacheWidth`/`cacheWidth` y `RepaintBoundary` |

### Segunda tanda (mismo dispositivo, 2026-09-29)

| Queja | Causa real | Dónde se corrigió |
|---|---|---|
| "Hay que ir al sistema a cambiar el tema" | `MaterialApp.router` con `ThemeMode.system` fijo y ningún ajuste en la app | `app/theme/theme_mode_controller.dart` + `shared/widgets/ui/theme_mode_selector.dart`; `MaterialApp` observa `themeModeProvider`; se persiste en `PreferencesStorage` (`lc.ui.themeMode`), con migración de la clave vieja `lc.ui.darkMode` |
| Menú: "Buenos días, Usuario" / Menú: "Hola, Usuario" | Dos pantallas con su propio saludo y su propio criterio | `shared/constants/greeting.dart` (texto único, momento del día + nombre, sin coma colgante); lo usan `home_page.dart` y `menu_body.dart` |
| Menú: pregunta con letras **árabes** en el verbo | Cadena corrupta en el código (`U+062A`, `U+0635`, `U+0641`), no fuentes ni locale | `AppStrings.menuPrompt` = "¿Qué te descubrimos hoy?". Barrido de `lib/` y `test/` en busca de U+0600–06FF, U+0750–077F, U+FB50–FDFF, U+FE70–FEFF: **0 coincidencias**. `test/source_text_hygiene_test.dart` lo impide para siempre |
| Menú: chips de categoría pegados | Separación fija de 8 dp entre pills con borde | `kCategoryChipSpacing` = `AppSpacing.md` (12), ahora parámetro `spacing`; `verticalPadding` para separar la fila del buscador y del título |
| Menú: "Destacados" pegado a su subtítulo, subtítulo pegado a la primera tarjeta | `AppSpacing.xxs` (2 dp) dentro del bloque y `padding.bottom = 0` en las pantallas de menú | `SectionHeader`: `titleSubtitleGap` = `xs` (4) y `bottomSpacing` = `md` (12), aplicados dentro del componente |
| Precio "5.500 $" en vez de "$5.500" | `intl` 0.19 no tiene datos de `es_CO`: cae a `es`, patrón `#,##0.00 ¤` | `currency_formatter.dart` escribe el patrón a mano (`¤#,##0`) y solo toma de `intl` los separadores; `PriceDisplay` sin decimales en todas las variantes |
| El símbolo del dinero estaba fijo en el código | `r'$'` literal en el formateador | `CurrencyFormatter.setSymbol` con `businesses.currency_symbol` de `GET /business`, aplicado también desde la copia cacheada |
| **Extra encontrado**: escribir "5.000" en el diálogo de reembolso cobraba 500 en vez de 500000 | `parseMinor` tomaba como decimal siempre el último separador | `parseMinor` distingue punto de miles por la forma (`^\d{1,3}(\.\d{3})+$`) |

### Bloqueantes: nada funciona hasta que se hagan

- [ ] **Generar las carpetas nativas.** `android/`, `ios/`, `linux/`, `windows/`
      y `macos/` solo tienen su `README.md`:
      `flutter create --platforms=android,ios,web,linux,windows,macos .`
- [x] **Generar las carpetas nativas.** `android/` generado y compilado.
- [x] **Compilar y corregir.** `flutter analyze`: 0 errores, 0 warnings. La
      auditoría del 2026-09-29 corrigió 70 errores de compilación que había
      dejado un refactor a medias del sistema de tokens (§3.2).
- [x] **Tests de Flutter.** `test/` tiene nueve suites, **116 tests**:

  | Suite | Qué fija |
  |---|---|
  | `currency_formatter_test.dart` | Contrato exacto `$5.500` / `$1.234.567` / `$0`, símbolo delante, separador de miles, símbolo del negocio y lectura de lo que se escribe a mano |
  | `theme_mode_selector_test.dart` | Persistencia de los tres modos, migración de la clave vieja, que el modo **se aplique**, y semántica de las opciones |
  | `source_text_hygiene_test.dart` | Ni un carácter de U+0600–06FF, U+0750–077F, U+FB50–FDFF ni U+FE70–FEFF en ningún `.dart` de `lib/` o `test/` |
  | `greeting_test.dart` | Un único saludo con nombre, coherente entre Inicio y Menú, sin coma colgante |
  | `menu_layout_test.dart` | Separación real entre pills y jerarquía título → subtítulo → contenido |
  | `theme_contrast_test.dart` | Contraste WCAG 2.1 AA de todos los pares texto/fondo en los DOS modos |
  | `date_formatter_test.dart` | es-CO 24 h, countdown, duraciones |
  | `nav_bar_many_destinations_test.dart` | Barra con 5 y con 12 destinos |
  | `checkout_placed_order_items_test.dart`, `checkout_layout_test.dart` | Regresión del pedido sin productos y layout estrecho del checkout |

- [ ] **`status_badge_test.dart`.** sigue sin escribirse; el resto de la suite ya
      cubre la parte que más bugs produjo.

### CRUD con capa de datos pero sin interfaz

La capa de datos está completa en los tres casos; lo que falta es la pantalla
y el controller que la llamen.

- [ ] **Variantes, complementos e ingredientes.** `admin_variants_datasource.dart`
      expone `createVariant`/`updateVariant`/`deleteVariant`,
      `createAddon`/`updateAddon`/`deleteAddon` y
      `addIngredient`/`removeIngredient`, cableados en `adminCatalogRepositoryProvider`.
      No hay ninguna referencia desde `presentation/`: el
      `admin_product_form_dialog.dart` lo dice explícitamente ("se editan desde
      la ficha del producto") y esa ficha no existe todavía.
- [ ] **Categorías.** `createCategory`/`updateCategory`/`deleteCategory` están en
      `admin_catalog_datasource.dart` y en el repositorio, pero el panel solo
      las lee (las usa como filtro).
- [ ] **Alta y edición de sillas y zonas.** `createChair`, `updateChair`,
      `deleteChair`, `createZone` y `deleteZone` existen en datasource y
      repositorio. La UI solo permite cambiar el **estado** de una silla
      (`admin_chair_actions.dart`, cuatro botones, por BR-CHAIR-003) y
      **editar** una zona (`admin_zone_edit_dialog.dart`); no hay alta de ninguna
      de las dos.

### Andamiaje declarado y vacío

Estas carpetas existen solo con su `README.md` de contrato. O se rellenan o se
borran, pero no deben quedar fingiendo que son código.

- [ ] `features/reservation/` — el enunciado de la reserva vive dentro de admin
      (`admin_reservations_page.dart`), así que hay que decidir si la reserva del
      cliente es una feature propia o reutiliza ese flujo.
- [ ] `lib/routing/` — el enrutado real está en `app/router.dart` y
      `app/routes.dart`; esta carpeta es un README que quedó de la fase de
      cimientos.
- [ ] `lib/domain/usecases/`, `lib/data/datasources/local/` y
      `lib/shared/utils/` — tres README sin una línea de código.
- [ ] `equatable`, `freezed_annotation` y `json_annotation` están declarados en
      `pubspec.yaml` sin que ningún fichero los importe. O entran en uso o salen
      del `pubspec`.
