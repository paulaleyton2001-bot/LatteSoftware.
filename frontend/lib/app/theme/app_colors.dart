// Paleta LITERAL del sistema de diseño "Latte Coffee".
//
// Este archivo es el ÚNICO lugar del proyecto donde se escribe un
// `Color(0x...)`. Ningún widget, feature o test debe declarar un hex: se
// importa `AppTokens` y se usa el ROL (`context.tokens.textPrimary`).
//
// DOS RAMPAS, NO UNA INVERSIÓN
// `AppPalette` declara los literales de los DOS modos y `AppTokens` los
// empareja por rol (`app_tokens.dart`). La razón de no invertir por
// `Brightness` es que la inversión mecánica dejaba los roles que nadie
// enumeraba (chips, badges, segmentados, hojas, estados de silla) con colores
// claros incompatibles con superficies oscuras: crema sobre marrón, verde
// sobre crema, texto invisible.
//
// LOS VALORES NO SON DECORATIVOS
// Cada par texto/fondo se verificó con la fórmula de luminancia relativa de
// WCAG 2.1. La tabla completa de ratios, con el motivo de cada ajuste, está en
// `docs/DESIGN-TOKENS.md` §1.4 y en el comentario de `AppTokens.dark()`.
library;

import 'package:flutter/material.dart';

/// Tokens de color literales de la paleta.
///
/// Se mantienen privados por diseño: el código de aplicación consume
/// [AppTokens] (rol semántico, ya resuelto para el modo), no un hex suelto.
abstract final class AppPalette {
  // ================================================================== CLARO

  // --------------------------------------------------------- Neutros cálidos
  /// Fondo de la aplicación (crema muy claro).
  static const Color background = Color(0xFFFAF8F4);
  /// Superficie alternativa crema (chips inactivos, filas de tabla).
  static const Color surfaceMuted = Color(0xFFF7F3EC);
  /// Superficie hundida (skeletons, cabeceras, campos deshabilitados).
  static const Color surfaceSunken = Color(0xFFF1EADF);
  /// Superficie principal (cards, hojas, diálogos).
  static const Color surface = Color(0xFFFFFFFF);

  /// Borde hairline por defecto (cards outlined, separadores).
  static const Color borderSubtle = Color(0xFFEDE7DE);
  /// Borde de card outlined y de chip. Decorativo: la card apoya la separación
  /// en la sombra y el chip en su relleno.
  static const Color borderDefault = Color(0xFFD2C7B7);
  /// Borde de input en reposo. Todo input tiene etiqueta visible, que es lo
  /// que lo identifica; el borde refuerza, no informa.
  static const Color borderInput = Color(0xFFC2B4A0);
  /// Borde de control identificable SOLO por su borde (checkbox, radio,
  /// switch): 3.86:1 en blanco. Cumple WCAG 1.4.11.
  static const Color borderStrong = Color(0xFF8A8078);

  // ------------------------------------------------------------------ Tinta
  /// Texto principal / títulos / números KPI (13.37:1 en blanco).
  static const Color ink = Color(0xFF3B2C23);
  /// Espresso 700: subtítulos de alto peso.
  static const Color inkStrong = Color(0xFF4A382C);
  /// Texto secundario legible (5.70:1 en blanco).
  static const Color textSecondary = Color(0xFF6E655D);

  /// Texto terciario. Se oscureció desde `#7A7069` (4.37:1 en `surfaceMuted`,
  /// por debajo de AA) a `#726861` (4.91:1 / 4.54:1 en `surfaceSunken`).
  static const Color textTertiaryAa = Color(0xFF726861);

  /// Texto atenuado. Se oscureció desde `#8A8078` (3.49:1 en `surfaceMuted`) a
  /// `#6F665E` (5.08:1 / 4.70:1 en `surfaceSunken`).
  static const Color textMutedAa = Color(0xFF6F665E);

  /// Texto e iconos deshabilitados. WCAG 1.4.3 exime a los deshabilitados, pero
  /// un control apagado que no se distingue de uno encendido hace dudar al
  /// usuario de si ha fallado o si es que ya estaba hecho. Por eso NO se queda en
  /// el gris claro `#A9A29A` (2.38:1 en el fondo, 2.74:1 medido: por debajo del
  /// 3:1 de WCAG 1.4.11) sino en `#87817B`, que da 3.63:1 en el fondo y 3.22:1 en
  /// la superficie hundida: sigue siendo claramente "apagado" y sigue siendo
  /// legible. Verificado por `test/theme_contrast_test.dart`.
  static const Color textDisabled = Color(0xFF87817B);
  /// Texto sobre un control primario deshabilitado (3.14:1 sobre su fondo).
  static const Color textOnDisabled = Color(0xFF6B7A70);

  /// Crema de la marca. Es el texto sobre superficies oscuras fijas (hero,
  /// snackbar) y el `onAccent` del modo oscuro invertido.
  static const Color cream = Color(0xFFF5EFE6);
  /// Crema atenuada para subtítulos sobre oscuro fijo (8.47:1 en espresso).
  static const Color creamMuted = Color(0xFFD8CCBE);

  // ------------------------------------------------------------------ Verdes
  /// Salvia 300: acento de marca puro. NO usar con texto blanco encima
  /// (2.14:1): es un acento gráfico, no un relleno de acción.
  static const Color sage = Color(0xFF7FBF9A);
  /// Salvia 300 más clara: acento del modo oscuro y hovered de acento.
  static const Color sageLight = Color(0xFF8FC9A8);
  /// Salvia 600: pressed de acentos, bordes verdes.
  static const Color sageDark = Color(0xFF5E9B79);
  /// Salvia 500/400 legible sobre superficie oscura (6.56:1 en `espresso900`).
  static const Color sageDarkLg = Color(0xFF6FAE89);

  /// Verde 700 — fondo del botón primario (5.01:1 con blanco).
  static const Color green700 = Color(0xFF2F7D57);
  /// Verde 800 — pressed del botón primario.
  static const Color green800 = Color(0xFF2A6B4A);
  /// Verde 950 — texto verde AA sobre superficie clara o diluida.
  static const Color green950 = Color(0xFF1F5A3E);
  /// Superficie verde muy clara (chips activos, badges info).
  static const Color greenSubtle = Color(0xFFE4F1E9);
  /// Superficie verde media (chips activos hover, realce).
  static const Color greenMuted = Color(0xFFD3E9DD);
  /// Primario deshabilitado en claro.
  static const Color greenDisabledSurface = Color(0xFFC7DCCF);

  // -------------------------------------------------------------------- Hero
  /// Panel marrón espresso (hero POS, banners).
  static const Color espresso = Color(0xFF3B2C23);
  /// Overlay del gradiente del hero.
  static const Color espresso70 = Color(0xFF6B584A);

  // ----------------------------------------------------------------- Estado
  /// Rojo suave de la referencia: indicadores/gráficos, NO texto.
  static const Color errorSoft = Color(0xFFE88B8B);
  /// Rojo claro para texto/iconos sobre superficie oscura (8.90:1).
  static const Color errorSoftDark = Color(0xFFF2A9A2);
  /// Rojo 700 de acción (botón danger).
  static const Color errorDark = Color(0xFFB3261E);
  /// Rojo 800 para texto sobre superficie roja diluida.
  static const Color errorText = Color(0xFF8C2F22);
  /// Superficie roja diluida.
  static const Color errorSubtle = Color(0xFFFBE9E6);
  /// Superficie del danger deshabilitado en claro.
  static const Color errorDisabledSurface = Color(0xFFEFDCD8);
  /// Texto del danger deshabilitado en claro (5.91:1 sobre su fondo).
  static const Color errorDisabledText = Color(0xFF6B4A44);

  /// Naranja suave de la referencia (warning/ocupado). Es el punto de estado y
  /// los gráficos: el DOT tiene que separarse de su propia superficie diluida
  /// (`#FCF0E2`), así que se oscurece a `#B67E1D` (3.12:1) frente al naranja
  /// claro `#C0851F`, que se quedaba en 2.83:1 y desaparecía. Para el TEXTO de
  /// esos estados está `warningText`.
  static const Color warningSoft = Color(0xFFB67E1D);
  /// Naranja claro para texto/iconos sobre superficie oscura (9.71:1).
  static const Color warningSoftDark = Color(0xFFE9BC81);
  /// Naranja 700 de acción.
  static const Color warningDark = Color(0xFF9A6114);
  /// Texto warning sobre superficie diluida (6.63:1).
  static const Color warningText = Color(0xFF7A4A18);
  /// Superficie naranja diluida.
  static const Color warningSubtle = Color(0xFFFCF0E2);

  /// Verde de éxito (gráficos, KPIs positivos).
  static const Color success = Color(0xFF2F7D57);
  /// Superficie éxito diluida.
  static const Color successSubtle = Color(0xFFDFF2E7);

  /// Azul de información / reserva.
  static const Color info = Color(0xFF2B4C8C);
  /// Azul claro para texto/iconos sobre superficie oscura (8.68:1).
  static const Color infoSoftDark = Color(0xFF9DBBE8);
  /// Superficie azul diluida.
  static const Color infoSubtle = Color(0xFFE7ECFA);

  /// Violeta de limpieza.
  static const Color cleaning = Color(0xFF5F3E8E);
  /// Violeta claro para texto/iconos sobre superficie oscura (7.69:1).
  static const Color cleaningSoftDark = Color(0xFFBCA3E2);
  /// Texto cleaning sobre superficie diluida.
  static const Color cleaningText = Color(0xFF4A3A6B);
  /// Superficie violeta diluida.
  static const Color cleaningSubtle = Color(0xFFF0E9FB);

  /// Gris cálido para estados neutros (punto sólido de badge).
  static const Color neutral = Color(0xFF8A8078);
  /// Texto neutro legible.
  static const Color neutralText = Color(0xFF5B5147);

  /// Puntos de estado de silla (siempre acompañados de texto e ícono).
  static const Color availableDot = Color(0xFF2E7D32);

  /// Punto de "ocupada". `#C0851F` daba solo 2.83:1 sobre su propia superficie
  /// diluida `#FCF0E2` y se fundía con ella; `#B67E1D` da 3.12:1 y sigue siendo
  /// claramente naranja. Verificado por `test/theme_contrast_test.dart`.
  static const Color occupiedDot = Color(0xFFB67E1D);
  static const Color reservedDot = Color(0xFF2B4C8C);
  static const Color blockedDot = Color(0xFFC0392B);
  static const Color maintenanceDot = Color(0xFF8A8078);

  /// Superficie del CTA espresso deshabilitado.
  static const Color espressoDisabledSurface = Color(0xFFDED2C5);

  /// Halo translúcido del foco/ripple en modo claro.
  static const Color focusRingSurface = Color(0x3377C79B);
  /// Scrim de modales en modo claro.
  static const Color scrim = Color(0x593B2C23);

  // Sombras del sistema de elevaciones (`app_shadows.dart`). Salen de la tinta
  // espresso con opacidades bajas y radios de blur grandes: sombras "difusas,
  // apenas perceptibles", nunca duras ni negras al 100 %.
  static const Color shadow1 = Color(0x0F3B2C23);
  static const Color shadow2 = Color(0x143B2C23);
  static const Color shadow3 = Color(0x1A3B2C23);
  static const Color shadow4 = Color(0x263B2C23);

  // ================================================================= OSCURO
  //
  // Rampa espresso: de `#141009` (casi negro con sabor a café) a `#3B2C23`.
  // Se eligió una rampa MARRÓN y no una gris porque la identidad del producto es
  // espresso + salvia; un gris neutro delata que el tema oscuro se generó por
  // inversión y ensucia las fotos de producto, que son lo que más se ve.

  /// Fondo de la aplicación. El más oscuro de la rampa.
  static const Color espressoBlack = Color(0xFF141009);
  /// Fondo de la app (un punto por encima del anterior, para que la `AppBar`
  /// separe del contenido sin necesitar sombra).
  static const Color espresso950 = Color(0xFF1A120D);
  /// Superficie principal: cards, hojas, barra de navegación.
  static const Color espresso900 = Color(0xFF241A14);
  /// Superficie alternativa: chips inactivos, filas de tabla.
  static const Color espresso800 = Color(0xFF2E211A);
  /// Superficie algo elevada (rail, cabeceras de tabla).
  static const Color espresso850 = Color(0xFF2A1D16);
  /// Superficie del hero en modo oscuro.
  static const Color espressoAccentSurface = Color(0xFF2A3B31);
  /// Superficie error en modo oscuro.
  static const Color espressoErrorSurface = Color(0xFF3A1F1C);
  /// Superficie warning en modo oscuro.
  static const Color espressoWarningSurface = Color(0xFF3A2B16);
  /// Superficie success en modo oscuro.
  static const Color espressoSuccessSurface = Color(0xFF1E3629);
  /// Superficie info en modo oscuro.
  static const Color espressoInfoSurface = Color(0xFF1C2A3F);
  /// Superficie cleaning en modo oscuro.
  static const Color espressoCleaningSurface = Color(0xFF2A2340);

  /// Tinta del texto sobre el acento claro: casi negro con sabor a espresso
  /// (9.42:1 sobre salvia 300).
  static const Color espressoInk = Color(0xFF0E1A14);

  /// Crema fuerte: `textStrong` y CTA espresso invertido (14.55:1).
  static const Color creamStrong = Color(0xFFF7F1E8);
  /// Texto secundario en oscuro (9.67:1).
  static const Color creamSecondary = Color(0xFFCFC1B1);
  /// Texto terciario en oscuro (7.18:1).
  static const Color creamTertiary = Color(0xFFB5A695);
  /// Texto atenuado en oscuro (5.05:1).
  static const Color creamMutedDark = Color(0xFF9A8979);
  /// Texto deshabilitado en oscuro (3.28:1; exento por WCAG 1.4.3).
  static const Color creamDisabled = Color(0xFF7A6A5D);
  /// Borde de control identificable solo por su borde (5.29:1 en `espresso900`).
  static const Color creamMutedStrong = Color(0xFFA08C7A);
  /// Texto sobre el contenedor de acento en oscuro (8.68:1).
  static const Color creamAccent = Color(0xFFBCE6CF);
  /// Texto del primario deshabilitado en oscuro (5.02:1 sobre su fondo).
  static const Color creamAccentDisabled = Color(0xFFA8BDB2);

  /// Borde hairline en oscuro.
  static const Color espressoBorderSubtle = Color(0xFF35271F);
  /// Borde de card outlined y chip en oscuro.
  static const Color espressoBorder = Color(0xFF4A382E);
  /// Borde de input en reposo en oscuro.
  static const Color espressoBorderInput = Color(0xFF5C4839);

  /// Primario deshabilitado en oscuro.
  static const Color espressoPrimaryDisabled = Color(0xFF33473C);
  /// Superficie del CTA espresso deshabilitado en oscuro (la acción espresso
  /// se INVIERTE en oscuro a crema, así que su estado deshabilitado es una
  /// crema apagada y su texto, un marrón, no un crema sobre marrón).
  static const Color espressoDisabledSurfaceDark = Color(0xFF3B2E25);
  /// Superficie del danger deshabilitado en oscuro.
  static const Color espressoErrorDisabled = Color(0xFF4A2C29);

  /// Halo translúcido del foco/ripple en oscuro (salvia al 26 %).
  static const Color focusRingSurfaceDark = Color(0x438FC9A8);
  /// Scrim de modales en oscuro: negro puro, porque el fondo ya es muy oscuro y
  /// un scrim marrón no llega a separar el diálogo del fondo.
  static const Color scrimDark = Color(0xB3000000);
}

/// Paleta categórica de gráficos (`fl_chart`).
///
/// Los gráficos NO se invierten: son series de datos, y una rampa distinta en
/// cada modo haría el mismo gráfico irreproducible. Se eligen tonos que
/// mantienen >= 3:1 sobre el fondo crema Y sobre el espresso, y la leyenda
/// siempre lleva la etiqueta escrita al lado (nunca solo el color).
abstract final class AppChartColors {
  /// Orden fijo de la paleta categórica. El índice 0 es la serie principal.
  static const List<Color> categorical = <Color>[
    AppPalette.sage,
    AppPalette.sageDarkLg,
    AppPalette.inkStrong,
    AppPalette.warningSoft,
    AppPalette.infoSoftDark,
    AppPalette.cleaningSoftDark,
    amber,
    AppPalette.sageLight,
  ];

  /// Serie principal. Con trazo fino o como único indicador del dato.
  static const Color seriesPrimary = AppPalette.sageDarkLg;

  /// Alternativa para líneas finas, leyenda y trazos únicos.
  static const Color seriesAlt = AppPalette.sageDark;

  /// Segunda serie (comparativas, apilados).
  static const Color seriesSecondary = AppPalette.inkStrong;

  /// Etiquetas de eje.
  static const Color axisLabel = AppPalette.textTertiaryAa;

  /// Rejilla horizontal.
  static const Color gridLine = AppPalette.borderSubtle;

  /// Rejilla destacada (eje de referencia).
  static const Color gridLineStrong = AppPalette.borderStrong;

  /// Variación positiva.
  static const Color positive = AppPalette.green700;

  /// Variación negativa.
  static const Color negative = AppPalette.errorDark;

  /// Ocre de la paleta categórica (7º color).
  static const Color amber = Color(0xFFC98A2B);
}
