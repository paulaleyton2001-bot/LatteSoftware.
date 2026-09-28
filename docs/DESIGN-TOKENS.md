# Sistema de diseño — Latte Coffee

**Documento normativo.** Contrato entre el diseño, el frontend y el backend. Si
el código difiere de lo escrito aquí, el código está mal.

- Implementación Flutter: `frontend/lib/app/theme/`
- Widgets del sistema: `frontend/lib/shared/widgets/`
- Formateo de dinero/fecha: `frontend/lib/core/utils/`
- Enums que llegan del backend: `docs/API.md` §6.2

Índice: [1. Color](#1-color) · [2. Tipografía](#2-tipografía) ·
[3. Espaciado](#3-espaciado) · [4. Radios, bordes, sombras](#4-radios-bordes-y-sombras) ·
[5. Breakpoints](#5-breakpoints-responsive) · [6. Estados visuales](#6-estados-visuales) ·
[7. Componentes](#7-componentes) · [8. Accesibilidad](#8-accesibilidad) ·
[9. Formatos](#9-formatos-moneda-fecha-y-hora-crítico) · [10. Checklist](#10-checklist-de-revisión)

---

## 1. Color

### 1.1 Cómo se consume la paleta

Hay tres niveles, y **solo el primero se escribe a mano**:

| Nivel | Dónde | Ejemplo |
|---|---|---|
| Literal | `app/theme/app_colors.dart` → `AppPalette` | `Color(0xFF2F7D57)` |
| Semántico | `app/theme/app_colors.dart` → `AppColors` | `AppColors.actionPrimary` |
| Extendido | `AppStateColors`, `AppChartColors` | `AppStateColors.availableSurface` |

**Regla dura:** ningún archivo fuera de `app_colors.dart` escribe un color
literal, ni siquiera "un verde un poco más oscuro". Si hace falta un color que
no existe, se agrega como token en `AppColors` con su uso documentado.

### 1.2 Paleta base

#### Neutros cálidos (fondos)

| Token | Hex | Uso | Contraste medido |
|---|---|---|---|
| `background` | `#FAF8F4` | Fondo de la app | — |
| `surfaceMuted` | `#F7F3EC` | Chips inactivos, cabecera de tabla, skeletons | — |
| `surfaceSunken` | `#F1EADF` | Campos deshabilitados, tracks de progreso, detalles técnicos | — |
| `surface` | `#FFFFFF` | Cards, sheets, diálogos, menús | — |

#### Tinta (texto)

| Token | Hex | Uso | Sobre blanco |
|---|---|---|---|
| `textPrimary` | `#3B2C23` | Títulos, cifras, texto de cuerpo importante | **13.37:1** |
| `textStrong` | `#4A382C` | Subtítulos de alto peso, hover de la tinta | **11.09:1** |
| `textSecondary` | `#6E655D` | Texto secundario, subtitles, captions | **5.70:1** |
| `textTertiary` | `#7A7069` | Texto grande o no esencial | **4.83:1** |
| `textMuted` | `#8A8078` | Decorativo, o texto ≥ 24 px | 3.86:1 ⚠️ |
| `textDisabled` | `#A9A29A` | Deshabilitado (exento por WCAG 1.4.3) | 2.52:1 ⚠️ |
| `textOnDark` | `#F5EFE6` | Texto sobre hero/CTA espresso | **11.70:1** sobre `#3B2C23` |

> ⚠️ `textMuted` (3.86:1) **no cumple 4.5:1**: solo se permite en texto grande
> (≥ 24 px, o ≥ 18.66 px en negrita) o en elementos que también tienen otra
> señal (ícono, posición, contexto). Nunca en el cuerpo de un párrafo.

#### Marca y acciones (verdes)

| Token | Hex | Uso | Nota |
|---|---|---|---|
| `brandLight` | `#8FC9A8` | Acentos en modo oscuro, hover del hero | — |
| `brand` | `#7FBF9A` | Monograma, gráficos, ilustraciones, estados decorativos | **No usar con texto blanco encima** (2.14:1) |
| `brandDark` | `#5E9B79` | Bordes verdes, pressed de acentos, chip activo | 3.26:1 (cumple 1.4.11) |
| `actionPrimary` | `#2F7D57` | **Fondo del botón primario**, tabs activas | 5.01:1 con blanco ✅ |
| `actionPrimaryHover` | `#357F5C` | Hover del primario | — |
| `actionPrimaryPressed` | `#2A6B4A` | Pressed del primario | 6.36:1 con blanco ✅ |
| `actionPrimaryDisabled` | `#C7DCCF` | Primario deshabilitado | con `#6B7A70` → 3.14:1 |
| `surfaceGreenSubtle` | `#E4F1E9` | Chip activo, badge info, superficie de realce | — |
| `surfaceGreenMuted` | `#D3E9DD` | Realce fuerte, hover de superficie verde | — |

> **Decisión de diseño documentada:** la referencia visual usa `#7FBF9A` (salvia)
> como "verde primario". Mantenemos esa salvia como **acento de marca**, pero el
> **relleno de acciones con texto** usa el verde 700 `#2F7D57`, porque con
> blanco la salvia da 2.14:1 y sería ilegible. Visualmente la familia es la
> misma; la diferencia solo aparece en los botones.

#### Hero

| Token | Hex | Uso | Contraste |
|---|---|---|---|
| `heroPanel` | `#3B2C23` | Panel marrón espresso del hero POS | — |
| `heroOverlay` | `#6B584A` | Gradiente de la foto oscurecida | texto crema 5.89:1 ✅ |

Texto sobre hero: `textOnDark` `#F5EFE6` (11.70:1) y `#D8CCBE` (8.47:1) para
subtítulos.

#### Estados

| Token | Hex | Uso | Texto sobre su superficie |
|---|---|---|---|
| `stateError` | `#E88B8B` | Punto/indicador de error, **no texto** | — |
| `actionDanger` | `#B3261E` | Botón destructivo | 6.54:1 con blanco ✅ |
| `textError` | `#8C2F22` | Texto de error | 7.03:1 sobre `#FBE9E6` ✅ |
| `surfaceErrorSubtle` | `#FBE9E6` | Badge de error, banner | — |
| `stateWarning` | `#E8B87B` | Indicador de advertencia/ocupado | — |
| `actionWarning` | `#9A6114` | Botón de advertencia | — |
| `textWarning` | `#7A4A18` | Texto de warning | 6.63:1 sobre `#FCF0E2` ✅ |
| `surfaceWarningSubtle` | `#FCF0E2` | Badge de warning | — |
| `stateSuccess` / `textSuccess` | `#2F7D57` / `#1F5A3E` | Éxito, deltas positivos | 6.95:1 sobre `#DFF2E7` ✅ |
| `surfaceSuccessSubtle` | `#DFF2E7` | Badge de éxito | — |
| `stateInfo` / `textInfo` | `#2B4C8C` | Información, reservas | 7.07:1 sobre `#E7ECFA` ✅ |
| `surfaceInfoSubtle` | `#E7ECFA` | Badge de info | — |
| `stateCleaning` / `textCleaning` | `#5F3E8E` / `#4A3A6B` | Limpieza | 8.42:1 sobre `#F0E9FB` ✅ |
| `surfaceCleaningSubtle` | `#F0E9FB` | Badge de limpieza | — |
| `stateNeutral` / `textNeutral` | `#8A8078` / `#5B5147` | Desconocido, cerrado | 6.48:1 sobre `#F1EADF` ✅ |

#### Bordes y foco

| Token | Hex | Uso | Contraste vs superficie |
|---|---|---|---|
| `borderSubtle` | `#EDE7DE` | Separadores decorativos, tablas | 1.23:1 (decorativo) |
| `borderDefault` | `#D2C7B7` | Borde de card outlined, chip | 1.67:1 (con etiqueta visible) |
| `borderInput` | `#C2B4A0` | Borde de input en reposo | 1.84:1 (con etiqueta visible) |
| `borderStrong` | `#8A8078` | Checkbox, radio, switch (control identificable **solo** por su borde) | **3.86:1** ✅ 1.4.11 |
| `focusRing` | `#2F7D57` | Anillo de foco de inputs (2 dp) | **5.01:1** ✅ 2.4.11 |

> **Por qué hay tres bordes.** WCAG 1.4.11 exige 3:1 solo cuando el borde es el
> **único** indicador del control. Un input con etiqueta visible cumple la
> función con el label, y su borde es refuerzo (de ahí 1.84:1). Un checkbox sin
> etiqueta sí depende del borde, y por eso usa `borderStrong` (3.86:1).

#### Superficies deshabilitadas

| Par | Fondo | Texto | Contraste |
|---|---|---|---|
| Primario deshabilitado | `#C7DCCF` | `#6B7A70` | 3.14:1 |
| Danger deshabilitado | `#EFDCD8` | `#6B4A44` | 5.91:1 |
| Espresso deshabilitado | `#DED2C5` | `#3B2C23` | 9.00:1 |

### 1.3 Gráficos

| Token | Hex | Uso |
|---|---|---|
| `chart.seriesPrimary` | `#7FBF9A` | Serie principal (barras anchas, áreas) |
| `chart.seriesAlt` | `#5E9B79` | Líneas finas, leyenda, trazos finos (3.26:1 ✅) |
| `chart.seriesSecondary` | `#4A382C` | Serie de contraste |
| `chart.axisLabel` | `#8A8078` | Ejes (texto grande/pequeño decorativo) |
| `chart.gridLine` | `#EDE7DE` | Grid horizontal, mínimo |
| `chart.positive` / `negative` | `#2F7D57` / `#B3261E` | Variación |

Paleta categórica (orden fijo, índice 0 = serie principal):
`#7FBF9A`, `#5E9B79`, `#4A382C`, `#E8B87B`, `#2B4C8C`, `#5F3E8E`, `#C98A2B`, `#7C6A5C`.

Reglas de gráfico: sin grid densa, sin sombra 3D, ejes sin línea de base pesada,
etiquetas de valor solo cuando caben, y **siempre leyenda o etiqueta** si hay
más de una serie (el color solo no identifica la serie).

### 1.4 Contraste verificado (WCAG 2.1 AA)

Todas las combinaciones que la app usa de verdad, medidas con la fórmula
relativa de luminancia de WCAG 2.1:

| Texto | Fondo | Ratio | Exigido | ✓ |
|---|---|---|---|---|
| `#3B2C23` texto principal | `#FFFFFF` surface | 13.37 | 4.5 | ✅ AAA |
| `#3B2C23` texto principal | `#FAF8F4` fondo app | 12.61 | 4.5 | ✅ AAA |
| `#3B2C23` texto principal | `#F7F3EC` crema | 12.09 | 4.5 | ✅ AAA |
| `#3B2C23` texto principal | `#E4F1E9` chip activo | 11.50 | 4.5 | ✅ AAA |
| `#F5EFE6` texto hero | `#3B2C23` hero | 11.70 | 4.5 | ✅ AAA |
| `#3B2C23` | `#DED2C5` espresso disabled | 9.00 | 4.5 | ✅ AAA |
| `#4A3A6B` limpieza | `#F0E9FB` | 8.42 | 4.5 | ✅ |
| `#8C2F22` error | `#FBE9E6` | 7.03 | 4.5 | ✅ |
| `#1F5A3E` éxito/verde | `#DFF2E7` | 6.95 | 4.5 | ✅ |
| `#1F5A3E` éxito/verde | `#E4F1E9` | 6.97 | 4.5 | ✅ |
| `#7A4A18` warning | `#FCF0E2` | 6.63 | 4.5 | ✅ |
| `#2B4C8C` info | `#E7ECFA` | 7.07 | 4.5 | ✅ |
| `#5B5147` neutro | `#F1EADF` | 6.48 | 4.5 | ✅ |
| `#2A6B4A` pressed primario | `#FFFFFF` | 6.36 | 4.5 | ✅ |
| `#B3261E` danger | `#FFFFFF` | 6.54 | 4.5 | ✅ |
| `#6B7A70` disabled | `#C7DCCF` | 3.14 | 3.0 (exento 1.4.3) | ✅ |
| `#6E655D` secundario | `#FFFFFF` | 5.70 | 4.5 | ✅ |
| `#6E655D` secundario | `#FAF8F4` | 5.38 | 4.5 | ✅ |
| `#6E655D` secundario | `#F7F3EC` | 5.16 | 4.5 | ✅ |
| `#7A7069` terciario | `#FFFFFF` | 4.83 | 4.5 | ✅ |
| `#7A7069` terciario | `#FAF8F4` | 4.55 | 4.5 | ✅ (límite) |
| `#2F7D57` primario | `#FFFFFF` | 5.01 | 4.5 | ✅ |
| `#2F7D57` focus ring | `#FFFFFF` | 5.01 | 3.0 (1.4.11) | ✅ |
| `#8A8078` borde fuerte | `#FFFFFF` | 3.86 | 3.0 (1.4.11) | ✅ |
| `#5E9B79` serie alt | `#FAF8F4` | 3.07 | 3.0 (1.4.11) | ✅ |
| `#5B5147` disabled danger | `#EFDCD8` | 5.91 | 4.5 | ✅ |
| `#8A8078` texto muted | `#FFFFFF` | 3.86 | 4.5 | ❌ **solo texto grande** |
| `#A9A29A` texto disabled | `#FFFFFF` | 2.52 | — | exento (1.4.3) |
| `#FFFFFF` | `#7FBF9A` salvia | 2.14 | 4.5 | ❌ **prohibido** |

---

## 2. Tipografía

### 2.1 Familia

**Sans-serif del sistema.** No se carga ninguna fuente de red.

| Motivo | Detalle |
|---|---|
| Rendimiento | Una fuente propia son 100–300 KB extra y una petición crítica en el LCP. |
| Offline | El POS debe arrancar y funcionar sin red; una fuente remota falla abierto. |
| Nativo | Se ve como app del sistema en cada plataforma (Material en Android, SF en iOS/macOS, Segoe en Windows). |
| Accesibilidad | El motor de texto del sistema ya respeta `textScaler` y las preferencias de tamaño de fuente del usuario. |

`AppTheme` declara `fontFamily: null` (usa `Typography.material2021`) y
`AppTextStyles` define toda la escala. Si algún día se adopta una marca
tipográfica, el cambio se hace **en un solo punto**: `AppTextStyles`.

### 2.2 Escala

Todos los estilos viven en `AppTextStyles`. `lineHeight` es múltiplo (unitless).

| Rol | Size / lineHeight | Weight | LetterSpacing | Uso |
|---|---|---|---|---|
| `displayLarge` | 40 / 1.10 | 700 | −0.8 | Timer de silla en detalle, cifras gigantes |
| `displayMedium` | 32 / 1.15 | 700 | −0.5 | Total del checkout, hero |
| `displaySmall` | 28 / 1.20 | 700 | −0.4 | **Valor del KPI** |
| `headlineLarge` | 26 / 1.20 | 700 | −0.3 | Título de página grande |
| `headlineMedium` | 22 / 1.25 | 700 | −0.2 | Título de sección importante |
| `headlineSmall` | 19 / 1.30 | 700 | 0 | Título de pantalla, título de diálogo |
| `titleLarge` | 17 / 1.35 | 700 | 0 | Título de card / sección |
| `titleMedium` | 15 / 1.40 | 600 | 0 | Título de producto, item de lista |
| `titleSmall` | 13 / 1.40 | 600 | +0.1 | Label de campo, label flotante |
| `bodyLarge` | 16 / 1.50 | 400 | 0 | Texto de input, párrafos de detalle |
| `bodyMedium` | 14 / 1.50 | 400 | 0 | **Cuerpo por defecto** |
| `bodySmall` | 13 / 1.45 | 400 | 0 | Texto secundario compacto |
| `labelLarge` | 14 / 1.25 | 600 | +0.1 | Label de botón, chip, tab |
| `labelMedium` | 12 / 1.20 | 600 | +0.2 | Badge, micro-texto, tab inactivo |
| `labelSmall` | 11 / 1.20 | 600 | +0.6 | **Header de tabla en MAYÚSCULAS** |
| `captionMedium` | 12 / 1.35 | 400 | 0 | Helper de campo, timestamp |
| `captionSmall` | 11 / 1.30 | 400 | 0 | Pie, texto no esencial |

### 2.3 Estilos especiales

| Token | Qué es | Por qué |
|---|---|---|
| `timerLarge` | 34/1.10, w700, `letterSpacing 1.5`, `FontFeature.tabularFigures()` | Los dígitos del temporizador de silla **no deben bailar** al Actualizarse |
| `timerMedium` | 18/1.20, w700, tabular | Timer en cards del mapa |
| `price` | 15/1.25, w700, tabular | Precio de producto |
| `priceLarge` | 24/1.20, w700, tabular | Precio en detalle y total |
| `heroTitle` / `heroSubtitle` | 24 / 14 sobre espresso | Texto del panel hero |

### 2.4 Reglas de composición

1. **Cifras siempre tabulares** cuando pueden cambiar en vivo (precios, timers,
   contadores). Sin eso, el número "baila" en cada frame.
2. Máximo **3 niveles de jerarquía** en pantalla (título, subtítulo, cuerpo).
3. `bodyMedium` es el cuerpo por defecto; `bodyLarge` solo para input y detalle.
4. Nunca `letterSpacing` positivo en texto corrido; solo en labels cortos.
5. `textScaler` se limita a `[0.85, 1.6]` en `MaterialApp.builder` (ver
   `app.dart`): por debajo de 0.85 las tablas se rompen, por encima de 1.6 los
   cards de producto desbordan.
6. Todo texto truncado lleva `maxLines` + `TextOverflow.ellipsis` **y** su
   versión completa en `Semantics.label` o en un tooltip.

---

## 3. Espaciado

Escala base **4 pt** (`AppSpacing`). Los valores no son decorativos: forman
retícula y por eso las columnas de una tabla y de una grilla alinean.

| Token | dp | Uso típico |
|---|---|---|
| `none` | 0 | — |
| `xxs` | 2 | Gap ícono↔texto en chip, padding vertical de badge |
| `xs` | 4 | Padding de `StatusBadge` compact, separaciones mínimas |
| `sm` | 8 | Gap entre elementos de una línea, padding de chip, `SizedBox` en listas |
| `md` | 12 | Padding interno de card chica, gap de item de lista, padding horizontal de input |
| `lg` | 16 | **Padding estándar de card**, separación de secciones menores, gap de badge |
| `xl` | 24 | Gap entre grupos, padding de card grande, `columnSpacing` de tabla |
| `xxl` | 32 | Separación entre secciones de pantalla |
| `xxxl` | 40 | Padding vertical de contenido denso, alto de skeleton |
| `huge` | 48 | Ritmo vertical de hero |
| `massive` | 64 | Login card en desktop |

Reglas:
- Padding de pantalla: `16` móvil, `24` tablet, `32` desktop, `40` wide.
- Grid: `24` (móvil 1 col) · `24` (tablet 2 col) · `24` (desktop 3 col) · `24` (wide 4 col).
- Un número suelto en un `EdgeInsets` es un error de diseño, no un detalle.

---

## 4. Radios, bordes y sombras

### 4.1 Radios (`AppRadii`)

| Token | dp | Uso |
|---|---|---|
| `sm` | 8 | Thumbnail, chip de estado, caja de detalle técnico |
| `md` | 12 | **Input**, botón mediano, thumbnail de producto |
| `lg` | 16 | **Card estándar** |
| `xl` | 20 | Card destacada, diálogo |
| `xxl` | 24 | Sheet de detalle |
| `pill` | 999 | Chip, **botón**, badge, monograma |

Regla: pill solo para controles compactos; nunca una card entera.

### 4.2 Bordes (`AppBorders`)

| Token | Grosor | Uso |
|---|---|---|
| `width` | 1 dp | Borde estándar y separador |
| `widthStrong` | 2 dp | Borde de foco y de error |

Ver §1.2 para la regla de los tres niveles de color de borde.

### 4.3 Elevaciones (`AppShadows`)

Sombras **difusas y de baja opacidad**: `color` espresso con 6–15 % de alfa,
blur grande, `spreadRadius` negativo. Nunca sombra dura ni negra al 100 %.

| Nivel | Color | Blur | Y | Spread | Uso |
|---|---|---|---|---|---|
| `level0` | — | — | — | — | Chips, tiles, celdas de tabla (flat) |
| `level1` | `#0F3B2C23` (6 %) | 8 | 2 | −2 | **Card elevated por defecto** |
| `level2` | `#143B2C23` (8 %) | 16 | 4 | −4 | Menús, popovers, card destacada |
| `level3` | `#1A3B2C23` (10 %) | 24 | 8 | −6 | Sheets, dropdown, FAB |
| `level4` | `#263B2C23` (15 %) | 32 | 12 | −8 | Diálogos y modales |

Regla: **la card por defecto del catálogo es `outlined`**, no `elevated`. En
listas densas N sombras se convierten en ruido; la sombra se reserva para lo
que flota de verdad (sheet, diálogo, FAB).

---

## 5. Breakpoints responsive

Implementados en `app/theme/responsive/breakpoints.dart` (`Breakpoint`,
`context.breakpoint`). El enum **no es un simple rango de media**: cada
breakpoint cambia navegación, columnas y densidad.

| Breakpoint | Ancho dp | Navegación | Columnas de grilla | Padding | Ancho máx. de contenido | Sidebar |
|---|---|---|---|---|---|---|
| `mobile` | 0 – 599 | `NavigationBar` inferior, 5 destinos, etiqueta siempre visible | 1 | 16 | ∞ | — |
| `tablet` | 600 – 1023 | `NavigationRail` lateral (80 dp) | 2 | 24 | 840 | — |
| `desktop` | 1024 – 1439 | Sidebar fija 240 dp + `Row` | 3 | 32 | 1120 | 240 |
| `wide` | ≥ 1440 | Sidebar fija 264 dp | 4 | 40 | 1360 | 264 |

### Qué cambia en cada uno (no solo el ancho)

- **mobile**: 1 columna; filtros de categoría en `ListView` horizontal
  scrolleable; detalle de producto en página completa; footer de checkout fijo
  sobre el `safe area`; bottom bar con 5 destinos (Inicio, Menú, Pedidos,
  Silla, Perfil); `NavigationBar` con altura 68 dp.
- **tablet**:NavigationRail en vez de bottom bar (libera 68 dp de alto útil,
  crítico cuando el teclado está abierto); 2 columnas; sidebar oculta; tablas
  con 4–5 columnas visibles; diálogos centrados en vez de sheet completo.
- **desktop**: sidebar fija con logo + items + bloque de perfil; 3 columnas;
  checkout en dos columnas (carrito | resumen); mapa de sillas con panel de
  detalle fijo a la derecha en vez de sheet; ancho máximo de contenido 1120
  dp para que las líneas no superen ~90 caracteres.
- **wide**: igual que desktop + sidebar 264 dp, 4 columnas, contenido 1360 dp
  (nunca 100 % del viewport: 2500 px de ancho produce 140 caracteres por línea).

Reglas transversales:
- El ancho de sidebar/rail **no** sigue la retícula de 4 pt: son medidas de
  chrome, no de contenido.
- Ningún componente decide el layout con `MediaQuery` directo: usa
  `context.breakpoint`. Si necesitas otro criterio (por ejemplo, altura para
  decidir tablet vertical vs horizontal), se agrega como propiedad del enum.

---

## 6. Estados visuales

### 6.1 Regla de oro

> **Ningún estado se comunica solo con color.** Todo estado lleva **texto +
> ícono + color**. Es un requisito de accesibilidad (WCAG 1.4.1) y de negocio:
> en el mapa de sillas, "ocupada" y "disponible" son indistinguibles para ~8 %
> de los usuarios con daltonismo rojo/verde, y un error de lectura significa
> cobrar o no cobrar.

Implementación: `StatusBadge` es el **único** lugar donde vive esta lógica
(`status_badge.dart` + `status_badge_visuals.dart` + `status_badge_resolver.dart`).
Nadie declara un mapa de estados en una pantalla. Si falta un estado, se
agrega al catálogo y todas las pantallas lo obtienen.

### 6.2 Sillas — `ChairStatus`

| Estado | Texto | Ícono | Punto | Superficie | Texto |
|---|---|---|---|---|---|
| `AVAILABLE` | Disponible | `event_available_rounded` | `#2E7D32` | `#DFF2E7` | `#1F5A3E` (6.95:1) |
| `OCCUPIED` | Ocupada | `event_seat_rounded` | `#C0851F` | `#FCF0E2` | `#7A4A18` (6.63:1) |
| `RESERVED` | Reservada | `event_note_rounded` | `#2B4C8C` | `#E7ECFA` | `#2B4C8C` (7.07:1) |
| `BLOCKED` | Bloqueada | `block_rounded` | `#C0392B` | `#FBE9E6` | `#8C2F22` (7.03:1) |
| `MAINTENANCE` | Mantenimiento | `build_rounded` | `#8A8078` | `#F1EADF` | `#5B5147` (6.48:1) |
| `CLEANING` | Limpieza | `cleaning_services_rounded` | `#5F3E8E` | `#F0E9FB` | `#4A3A6B` (8.42:1) |

En el mapa (celda coloreada) el color de la celda es la **superficie** y la
etiqueta de la silla va dentro en el tono de texto; en tablas densas se usa
`compact: true` (punto de color + texto).

### 6.3 Pedidos — `OrderStatus`

| Estado | Texto | Ícono | Superficie/Texto |
|---|---|---|---|
| `DRAFT` | Borrador | `edit_note_rounded` | neutro `#F1EADF` / `#5B5147` |
| `PENDING` | Pendiente | `schedule_rounded` | warning `#FCF0E2` / `#7A4A18` |
| `CONFIRMED` | Confirmado | `check_circle_outline_rounded` | info `#E7ECFA` / `#2B4C8C` |
| `PREPARING` | En preparación | `local_cafe_rounded` | warning `#FCF0E2` / `#7A4A18` |
| `READY` | Listo | `room_service_rounded` | éxito `#DFF2E7` / `#1F5A3E` |
| `DELIVERING` | En camino | `delivery_dining_rounded` | info `#E7ECFA` / `#2B4C8C` |
| `COMPLETED` | Completado | `done_all_rounded` | neutro `#F1EADF` / `#5B5147` |
| `CANCELLED` | Cancelado | `cancel_rounded` | error `#FBE9E6` / `#8C2F22` |
| `REFUNDED` | Reembolsado | `undo_rounded` | error `#FBE9E6` / `#8C2F22` |

`PENDING` y `PREPARING` comparten tono a propósito (mismo significado de
"en curso") pero **nunca el mismo ícono**.

### 6.4 Pagos, reservas y alquileres

| Dominio | Estado | Texto |
|---|---|---|
| `PaymentStatus` | `PENDING` / `APPROVED` / `FAILED` / `REFUNDED` / `PARTIALLY_REFUNDED` / `CANCELLED` | Pago pendiente / Pagado / Pago fallido / Reembolsado / Reembolsado / Cancelado |
| `ReservationStatus` | `PENDING` / `CONFIRMED` / `ACTIVE` / `COMPLETED` / `CANCELLED` / `EXPIRED` | Pendiente / Próxima / En curso / Finalizado / Cancelado / Vencida |
| `RentalStatus` | `ACTIVE` / `EXTENDED` / `COMPLETED` / `CANCELLED` | En curso / Extendido / Finalizado / Cancelado |

Un estado **desconocido** (el backend agrega uno nuevo y el cliente es viejo)
cae en `AppStatusVisuals.unknown`: gris neutro + ícono de ayuda + texto
"Desconocido". Se ve el bug en vez de fallar en silencio, y nunca se rompe la
regla de accesibilidad.

### 6.5 Otros estados de UI

| Estado | Componente | Señal |
|---|---|---|
| Sin conexión | `OfflineState` | Ícono `wifi_off` + título + mensaje + "Reintentar ahora" + aviso de operaciones pendientes |
| Sin sesión | `ErrorState` (Unauthorized) | `lock_outline` + "Sesión expirada" + botón "Iniciar sesión" |
| Sin permiso | `ErrorState` (Forbidden) | `no_accounts` + "No tienes permisos" + **sin** botón de reintento |
| Sin datos | `EmptyState` | Ilustración `CustomPaint` + título + mensaje + acción opcional |
| Error | `ErrorState` | Ícono por tipo + mensaje en español + reintento + panel técnico (solo debug) |

---

## 7. Componentes

Anatomía, variantes y reglas. Todos viven en `frontend/lib/shared/widgets/`.

### 7.1 `AppButton` (`ui/app_button.dart`)

```
[ icono? ]  Label  [ icono? ]
```

| Variante | Fondo | Texto | Uso |
|---|---|---|---|
| `primary` | `#2F7D57` | blanco | Acción principal de la pantalla |
| `secondary` | transparente + borde `#C2B4A0` | verde | Acción secundaria |
| `danger` | `#B3261E` | blanco | Destructivo (eliminar, cancelar, reembolsar) |
| `ghost` | transparente | verde | Terciaria ("Ver todo", "Omitir") |
| `espresso` | `#3B2C23` | crema | **CTA de alto peso**: pie del checkout, confirmar cobro |

| Tamaño | Alto | Label | Padding horizontal |
|---|---|---|---|
| `small` | 40 | `labelMedium` | 12 |
| `medium` | 48 | `labelLarge` | 16 |
| `large` | 56 | `labelLarge` | 24 |

- Radio `pill` siempre.
- `isLoading: true` → spinner del color del texto. **Obligatorio** acompañar con
  `onPressed: null` (assert en el constructor: un botón en carga no se pulsa).
- `isFullWidth` → ocupa todo el ancho (uso típico: pie de checkout).
- `tooltip` para botones de solo ícono; `semanticLabel` cuando el texto visible
  no describe la acción.
- Solo **un** botón `primary` o `espresso` por pantalla.

### 7.2 `AppCard` (`ui/app_card.dart`)

| Variante | Estilo | Uso |
|---|---|---|
| `elevated` | Sombra `level1`, sin borde | Elemento que flota |
| `outlined` (**default**) | Borde `borderDefault` 1 dp | Listas densas, grillas |
| `flat` | Sin borde ni sombra | Agrupación dentro de otra card |

- Radio `lg` (16), padding `lg` (16) por defecto; `EdgeInsets.zero` para cards
  de imagen a sangre.
- Con `onTap` se convierte en botón: ripple, `Semantics(button: true)`,
  `InkWell` con el mismo radio.
- `semanticLabel` obligatorio si el contenido es una imagen (el lector necesita
  el nombre del producto).

`ProductCard` (`ui/product_card.dart`) es el patrón ya resuelto: imagen
cuadrada + badge de favorito (ícono, 44 dp) + título (2 líneas) + categoría
(caption) + `PriceDisplay`.

### 7.3 `AppTextField` (`ui/app_text_field.dart`)

```
Label (titleSmall, gris)          ← flotante al enfocar
┌───────────────────────────────┐
│ (icono)  texto           (ojo)│   borde 1dp #C2B4A0 → 2dp #2F7D57 al enfocar
└───────────────────────────────┘
Helper (caption) o error (rojo)   ← el error reemplaza al helper
```

- Radio `md` (12), `filled` con `surface` blanca.
- Estados de borde: reposo `#C2B4A0` → foco `#2F7D57` (2 dp) → error `#B3261E`.
- `obscureToggle: true` agrega el botón ojo con `Semantics` propio
  ("Mostrar contraseña" / "Ocultar contraseña").
- `errorText` tiene prioridad sobre `helperText` (viene de
  `ValidationFailure.fieldErrors`).
- `textInputAction` por defecto `next`: en formularios se encadena con
  `onSubmitted`. `maxLength` activa el contador nativo.
- El focusNode lo puede inyectar la feature; si no, es interno y se libera en
  `dispose`.

### 7.4 `CategoryChip` / `CategoryChipRow` (`ui/category_chip*.dart`)

- Pill; inactivo = crema `#F7F3EC` + texto `#6E655D`; activo = `#E4F1E9` +
  texto `#1F5A3E` + **check** a la izquierda (el color no basta).
- Alto mínimo 40 dp, `Semantics(selected: true)`.
- `CategoryChipRow`: `ListView` horizontal de una línea, alto 52 dp, con
  nombre accesible del grupo.

### 7.5 `StatusBadge` (`ui/status_badge*.dart`)

- Pill con `surface` del estado + ícono (o punto en `compact`) + texto.
- `Semantics(label: 'Estado: <texto>', excludeSemantics: true)`.
- Fábricas: `.chair()`, `.order()`, `.payment()`, `.reservation()`, `.rental()`,
  `.of(visual)`. Nunca se construye el `AppStatusVisual` a mano fuera del
  catálogo.
- Padding: `md/xs` normal, `sm/xxs` compacto.

### 7.6 `PriceDisplay` (`ui/price_display.dart`)

| Variante | Render |
|---|---|
| `normal` | `$5.000` (15 px, w700, tabular) |
| `large` | `$5.000,00` (24 px, w700, tabular) — detalle y checkout |
| `promo` | `$6.000` tachado + `$5.000` + badge "Ahorra $1.000" |
| `costPerUnit` | `$8.000 / hora` |

- **Recibe centavos.** No acepta texto: formatea con `CurrencyFormatter`.
- `assert(originalMinor >= currentMinor)`.
- `Semantics` con la frase completa ("Precio con promoción: $5.000, antes
  $6.000, ahorras $1.000").

### 7.7 Estados (`ui/empty_state.dart`, `error_state.dart`, `offline_state.dart`, `loading_state.dart`, `shimmer.dart`)

- `EmptyState`: ilustración `CustomPaint` (gradiente verde→crema + arcos, sin
  assets) + ícono + título + mensaje + acción. `compact` = versión de 72 dp
  dentro de una card.
- `ErrorState`: ícono por tipo de fallo + mensaje + `requestId`/`code` en panel
  técnico (debug, con botón de copiar) + reintento **solo si el fallo es
  reintentable**.
- `OfflineState`: específica, porque la acción es distinta; incluye aviso de
  operaciones pendientes (no repetir el pago).
- `AppSpinner`: spinner centrado con mensaje.
- `ShimmerBox` / `ShimmerList`: skeleton con `ShaderMask`, sin paquetes
  externos, se congela con `prefers-reduced-motion`.
- `AsyncStateBuilder<T>`: **el orquestador**. Toda pantalla asíncrona lo usa.

```dart
AsyncStateBuilder<ProductList>(
  value: products,
  isEmpty: (data) => data.items.isEmpty,
  emptyTitle: 'No hay productos',
  onRetry: () => ref.invalidate(productsProvider),
  builder: (context, data) => ProductGrid(items: data.items),
)
```

Orden de decisión: loading → error/offline/unauthorized → sin data → vacío →
contenido. `skipLoadingOnRefresh` (default `true`) evita el parpadeo del
skeleton al refrescar.

### 7.8 `ConfirmDialog` (`ui/confirm_dialog.dart`)

- `ConfirmDialog.show(context, title:, message:, action: DialogAction.cancel)`
  devuelve `DialogAction` (`confirm` / `cancel`); nunca `bool`.
- `action: DialogAction.cancel` = destructivo (confirmación en **rojo**);
  `DialogAction.confirm` = inocua (verde).
- `barrierDismissible: false`: una acción destructiva no se cierra por error.
- Diálogo y no bottom sheet: exige atención y atrapa el foco.

### 7.9 `SectionHeader` (`ui/section_header.dart`)

Título (1–2 líneas) + subtítulo opcional + "ver todo" con chevron. Alto de
botón ≥ 44 dp aunque la etiqueta sea de 12 px. `level: page` sube a
`headlineSmall` para títulos de pantalla.

### 7.10 `KpiTile` (`ui/kpi_tile.dart`)

```
┌─────────────────────────┐
│ (icono)  VENTAS DE HOY  │  labelMedium, gris, 2 líneas
│ $1.284.000              │  displaySmall, espresso
│ ▲ +12,4%                │  delta: flecha + color + texto
└─────────────────────────┘
```

- `value` llega **ya formateado** (el widget no sabe de dinero).
- `delta` positivo = `#1F5A3E` + `trending_up`; negativo = `#8C2F22` +
  `trending_down`. Siempre flecha **y** texto.
- `FittedBox(scaleDown)` en la cifra: un número largo no desborda la card.

### 7.11 `EmptyPlaceholderImage` (`ui/empty_placeholder_image.dart`)

Placeholder de producto sin foto: gradiente verde→crema + 2 blobs translúcidos
+ iniciales del nombre (24 dp extra en el box). `CustomPaint`, sin assets.
Objetivo de tamaño reservado (cuadrado) → no hay CLS al cargar la imagen real.

### 7.12 `AdaptiveScaffold` (`adaptive_scaffold.dart` + módulo)

```dart
AdaptiveScaffold(
  destinations: ref.watch(menuDestinationsProvider),
  currentLocation: GoRouterState.of(context).uri.path,
  appBarTitle: 'Menú',
  body: ProductGrid(...),
)
```

| Breakpoint | Render |
|---|---|
| mobile | `Scaffold` + `AppNavigationBar` (5 destinos, etiquetas siempre visibles) + divisor 1 dp |
| tablet | `Row` + `AppNavigationRail` + divisor + contenido |
| desktop / wide | `Row` + `AppSidebar` (240/264) + divisor + contenido con ancho máximo |

- `AppDestination` (`shared/constants/app_destination.dart`): `label`, `icon`,
  `selectedIcon`, `location`, `badgeCount`, `isVisible`. El caller filtra por
  permiso antes de pasar la lista.
- `isSelected(location)`: la home (`/inicio`) no captura sus hijas
  (`/inicio/pedidos` marca "Pedidos").
- Navegación con `context.go` (reemplaza la pila: el menú lateral es nivel
  superior, no historial).
- `AppSidebar` (`app_sidebar.dart` + `sidebar_item.dart`): monograma + nombre
  arriba, items con ícono + texto, activo con fondo `#E4F1E9` + texto `#1F5A3E`
  + **barra de 3 dp** (3º canal), alto mínimo 44 dp, pie opcional
  (perfil/logout).

### 7.13 Reglas transversales de componentes

1. Un archivo, una responsabilidad, ≤ ~150 líneas.
2. Doc comment que dice **cuándo usarlo**, con ejemplo copiable.
3. Cero lógica de negocio: todo entra por parámetro.
4. Inmutable: `StatelessWidget` siempre que se pueda; `dispose()` completo si
   hay `AnimationController`/`FocusNode` propios.
5. Estilo en el tema, no en el widget: `AppTextField` no declara bordes (los
   aporta `inputDecorationTheme`).
6. Antes de crear un widget, buscar si uno existente ya resuelve el caso.

---

## 8. Accesibilidad

Objetivo: **WCAG 2.1 AA** en todas las plataformas.

| Criterio | Regla |
|---|---|
| 1.4.3 Contraste (texto) | ≥ 4.5:1 (≥ 3:1 para texto grande). Verificado en §1.4 |
| 1.4.11 Contraste no textual | ≥ 3:1 en bordes de control, foco, gráficos que son el único indicador |
| 1.4.1 Uso del color | **Prohibido** comunicar solo con color: texto + ícono |
| 1.3.1 Información y relaciones | HTML semántico equivalente: `headline` en títulos de sección, labels asociados a campos, `Semantics` en badges/filas |
| 2.1.1 Teclado | Todo control interactivo es enfocable y activable con teclado; ningún trampa de foco |
| 2.4.1 Evitar bloques | Cada pantalla tiene un título único (`Semantics(header: true)`) |
| 2.4.3 Orden del foco | Sigue el orden visual; el `NavigationBar` va después del contenido en el árbol |
| 2.4.7 Foco visible | Anillo de 2 dp `#2F7D57` (ratio 5.01:1), nunca `remove`, nunca `-1` |
| 2.5.5 Tamaño del objetivo | **≥ 44 × 44 dp** en todo control. Botones: 40/48/56 dp de alto con `MaterialTapTargetSize.padded` |
| 2.5.3 Etiqueta en nombre | El texto visible ("Guardar") está dentro del `Semantics` del control |
| 4.1.2 Nombre, rol, valor | Todo botón de solo ícono tiene `tooltip` **y** `semanticLabel` |
| 4.1.3 Mensajes de estado | Cambios de estado se anuncian (`Semantics(liveRegion: true)` en el carrito y en el estado del timer) |
| 2.3.3 Animación por interacción | `prefers-reduced-motion` respetado en shimmer y transiciones |

Reglas de implementación:
- Botón de solo ícono: **siempre** `tooltip` + `semanticLabel`.
- `StatusBadge` y `CategoryChip`: `Semantics(selected:, excludeSemantics: true)`.
- Cards clicables con imagen: `semanticLabel` con el nombre.
- Formularios: label visible siempre (no solo placeholder); el error se anuncia
  con `errorText` (Material lo marca como `liveRegion`).
- Diálogos: `AlertDialog` (atrapa y restaura el foco). Sheets: foco inicial en
  el título.
- Teclado en escritorio: `Ctrl/Cmd+K` → búsqueda, `Esc` → cierra sheet/dialog,
  `Tab` recorre sidebar → contenido → acciones.
- `textScaler` limitado a `[0.85, 1.6]` (ver `app.dart`).

---

## 9. Formatos (moneda, fecha y hora) — CRÍTICO

Este apartado es **contrato con el backend**, no preferencia de diseño. Si
frontend y backend formatean distinto, el usuario ve "$5.000" y "$5000" en la
misma pantalla y pierde confianza en el cobro.

### 9.1 Dinero

| Aspecto | Regla | Fuente |
|---|---|---|
| Transporte | **Entero en centavos** (`*Minor`). `500000` = $5.000 | API.md §6.1 |
| Presentación | `$5.000` — símbolo `$`, punto de miles, **sin decimales** | `GET /meta/enums → formats.priceExample` |
| Recibo (opcional) | `$5.000,00` | API.md §6.1 |
| Locale | `es_CO` | `AppConfig.locale` |
| Cero | `$0` (nunca `$0,00` en la app) | — |
| Negativo | `-$1.000` (refunds) | — |

Implementación: `core/utils/currency_formatter.dart` (única fuente) →
`NumberFormat.currency(locale: 'es_CO', symbol: r'$', decimalDigits: 0)`.

Reglas de cálculo:
- La suma se hace con `int` (`CurrencyFormatter.sumMinor`), **nunca** con
  `double`: `0.1 + 0.2 != 0.3`.
- `parseMinor` **trunca** los centavos, no redondea (no se cobra de más).
- **BR-PRICE-008:** el frontend puede previsualizar un subtotal, pero el único
  total válido es el que devuelve el servidor tras `POST /orders` o
  `PATCH /orders/:id`. La UI reemplaza sus cifras por las del servidor **sin
  transformarlas**.
- Nada de `double` para dinero en ningún punto del código.

### 9.2 Fechas y horas

| Aspecto | Regla |
|---|---|
| Transporte | ISO-8601 **UTC** (`2026-09-28T19:35:00Z`), siempre |
| Presentación | Zona horaria del negocio (`America/Bogota` por defecto), **24 h** |
| Locale | `es_CO` |
| Formatos | `dd/MM/yyyy`, `HH:mm`, `dd/MM/yyyy HH:mm`, `EEE d MMM · HH:mm` |
| Temporizador de silla | `HH:mm:ss` (o `mm:ss` bajo 1 h), con `FontFeature.tabularFigures()` |
| Duraciones | `1h 24m` (corto), `2 h 05 min` (largo), `30s` (segundos) |
| Relativas | `ahora`, `hace 5 min`, `hace 2 h`, `hace 3 d` |

Implementación: `core/utils/date_formatter.dart`. La zona horaria se lee de
`GET /meta/enums → formats.timezone` y se inyecta en
`DateFormatter.timeZoneOverride` **antes** de construir la app. Si el negocio
cambia su zona, el backend avisa con `meta.warnings: ["TIMEZONE_CHANGED"]`
(API.md §7.19) y la app debe reconstruir el formateador.

### 9.3 Números y texto

- Contadores de lista: entero con separador de miles (`1.284` sillas).
- Porcentajes: coma decimal (`12,4%`) — es `es-CO`.
- Deltas: signo explícito (`+12,4%`).
- Fechas en tablas: `dd/MM` con el año solo si cambia de año.

---

## 10. Checklist de revisión

Antes de dar por terminada cualquier pantalla:

- [ ] ¿Usa `AsyncStateBuilder`? ¿No hay spinner propio?
- [ ] ¿Ningún color literal fuera de `app_colors.dart`?
- [ ] ¿Ningún texto de negocio en un widget base?
- [ ] ¿Los estados usan `StatusBadge` (texto + ícono + color)?
- [ ] ¿Los precios entran como centavos y salen por `PriceDisplay`?
- [ ] ¿Los botones de ícono tienen `tooltip` + `semanticLabel`?
- [ ] ¿Todos los targets ≥ 44 dp?
- [ ] ¿El foco es visible y no queda atrapado fuera de un diálogo?
- [ ] ¿Funciona en móvil (320 dp), tablet, desktop y wide?
- [ ] ¿Funciona con `textScaler` 1.6 y con `prefers-reduced-motion`?
- [ ] ¿Se ve bien sin conexión y con error de red?
- [ ] ¿El archivo tiene ≤ ~150 líneas y un doc comment que dice cuándo usarlo?
- [ ] ¿El `flutter analyze` está limpio?
