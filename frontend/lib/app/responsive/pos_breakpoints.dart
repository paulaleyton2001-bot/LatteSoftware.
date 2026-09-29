// Comportamiento de layout del PUNTO DE VENTA por ancho.
//
// POR QUÉ NO BASTA CON `Breakpoint` DE `app/theme/responsive/breakpoints.dart`
// Ese enum decide NAVEGACIÓN y DENSIDAD de contenido editorial (menú, perfil).
// El POS no es contenido editorial: es una ESTACIÓN DE TRABAJO con tres
// columnas que tienen que verse las tres a la vez, sin scroll entre ellas, porque
// el cajero cobra mirando el pedido y mirando la silla. El POS gana columnas con
// el ancho en vez de estirar las que ya tiene, y para eso necesita cortes
// propios, más finos que los de la app.
//
// LA REGLA
//   - Ganar columnas, nunca estirar: el ancho extra se reparte en columnas
//     nuevas (más productos por fila, más información por tarjeta), no en
//     columnas más anchas. Un catálogo estirado a 2500 px obliga a mover la
//     mirada de un extremo a otro del mismo.
//   - Móvil NO es el desktop encogido: en compacto hay UNA columna y se navega
//     por pestañas explícitas (Catálogo / Pedido / Cobro), no con un `Row`
//     aplastado.
//
// ANCHOS Y COLUMNAS
//
//   | Comportamiento  | Ancho dp  | Columnas | Rejilla | Navegación        |
//   |-----------------|-----------|----------|---------|-------------------|
//   | `compact`       | 0 – 767    | 1        | 2       | pestañas (bottom) |
//   | `medium`        | 768 – 1183 | 2        | 3       | rail + 2 columnas |
//   | `expanded`      | 1184 – 1679| 3        | 4       | rail + 3 columnas |
//   | `ultraExpanded` | ≥ 1680     | 3 + panel| 5       | rail + 3 + lateral|
//
// El corte de 768 dp es el del iPad en vertical y el de cualquier tablet
// montada en el mostrador; 1184 dp es donde ya caben catálogo + pedido + cobro
// sin que ninguna quede por debajo de 300 dp (el mínimo legible de este widget).


import 'package:flutter/widgets.dart';

import '../theme/app_spacing.dart';

/// Forma del layout del POS a un ancho dado.
enum PosLayout {
  /// Una columna y navegación por pestañas. Móvil y tablet pequeña.
  compact,

  /// Dos columnas (catálogo | pedido) con el cobro plegado abajo.
  medium,

  /// Tres columnas (catálogo | pedido | cobro). Tablet grande y portátil.
  expanded,

  /// Tres columnas más un panel lateral de pedidos recientes.
  ultraExpanded;

  /// `true` si el POS pinta columna de cobro fija a la derecha.
  bool get hasCheckoutColumn => this == PosLayout.expanded || this == PosLayout.ultraExpanded;

  /// `true` si el POS muestra el panel lateral de pedidos en curso.
  bool get hasSidePanel => this == PosLayout.ultraExpanded;

  /// `true` si el POS funciona con pestañas (una columna).
  bool get usesTabs => this == PosLayout.compact;

  /// Etiqueta legible, solo para diagnóstico.
  String get label => switch (this) {
        PosLayout.compact => 'compact',
        PosLayout.medium => 'medium',
        PosLayout.expanded => 'expanded',
        PosLayout.ultraExpanded => 'ultraExpanded',
      };

  /// Número de columnas del catálogo de productos.
  int get catalogColumns => switch (this) {
        PosLayout.compact => 2,
        PosLayout.medium => 3,
        PosLayout.expanded => 4,
        PosLayout.ultraExpanded => 5,
      };

  /// Ancho mínimo legible de una tarjeta de producto (dp).
  double get productTileMinWidth => switch (this) {
        PosLayout.compact => 148,
        PosLayout.medium => 156,
        PosLayout.expanded => 168,
        PosLayout.ultraExpanded => 176,
      };

  /// Ancho de la columna de cobro (dp). `0` si no hay columna fija.
  double get checkoutColumnWidth => switch (this) {
        PosLayout.compact => 0,
        PosLayout.medium => 0,
        PosLayout.expanded => 340,
        PosLayout.ultraExpanded => 380,
      };

  /// Ancho de la columna del pedido en curso (dp). `0` si no hay columna.
  double get orderColumnWidth => switch (this) {
        PosLayout.compact => 0,
        PosLayout.medium => 360,
        PosLayout.expanded => 400,
        PosLayout.ultraExpanded => 440,
      };

  /// Número de tarjetas por columna en el tablero Kanban de pedidos.
  int get boardColumns => switch (this) {
        PosLayout.compact => 1,
        PosLayout.medium => 2,
        PosLayout.expanded => 3,
        PosLayout.ultraExpanded => 4,
      };

  /// Separación entre columnas (dp).
  double get gutter => switch (this) {
        PosLayout.compact => AppSpacing.md,
        PosLayout.medium => AppSpacing.md,
        PosLayout.expanded => AppSpacing.lg,
        PosLayout.ultraExpanded => AppSpacing.lg,
      };

  /// Padding de la pantalla (dp).
  double get padding => switch (this) {
        PosLayout.compact => AppSpacing.md,
        PosLayout.medium => AppSpacing.lg,
        PosLayout.expanded => AppSpacing.lg,
        PosLayout.ultraExpanded => AppSpacing.xl,
      };
}

/// Resolución del layout del POS.
abstract final class PosBreakpoints {
  /// Ancho mínimo de la columna de cobro. Por debajo el POS pasa a pestañas.
  static const double expandedMinWidth = 1184;

  /// Ancho a partir del cual aparece el panel lateral de pedidos.
  static const double ultraExpandedMinWidth = 1680;

  /// Ancho a partir del cual el POS deja de ser una sola columna.
  static const double mediumMinWidth = 768;

  /// Resuelve el layout a partir de un ancho arbitrario en dp.
  static PosLayout fromWidth(double width) {
    if (width < mediumMinWidth) return PosLayout.compact;
    if (width < expandedMinWidth) return PosLayout.medium;
    if (width < ultraExpandedMinWidth) return PosLayout.expanded;
    return PosLayout.ultraExpanded;
  }

  /// Layout del POS para el ancho de la ventana actual.
  static PosLayout of(BuildContext context) =>
      fromWidth(MediaQuery.sizeOf(context).width);

  /// `true` si el teclado físico y los atajos tienen sentido (ancho de escritorio).
  ///
  /// No es lo mismo que `Breakpoint.desktop`: una tablet de 1024 dp tiene
  /// teclado físico, y un portátil de 1366 dp también. El POS muestra los
  /// atajos cuando hay sitio para una fila de teclas, no cuando hay docking.
  static bool hasKeyboardShortcuts(BuildContext context) =>
      MediaQuery.sizeOf(context).width >= mediumMinWidth;
}

/// Acceso al layout del POS desde cualquier contexto.
extension PosLayoutContext on BuildContext {
  /// Layout del POS en este punto del árbol.
  PosLayout get posLayout => PosBreakpoints.of(this);

  /// `true` si el POS usa pestañas de una columna.
  bool get posIsCompact => posLayout.usesTabs;

  /// `true` si el POS muestra atajos de teclado.
  bool get posShowsShortcuts => PosBreakpoints.hasKeyboardShortcuts(this);
}

/// Ajusta el layout del POS al ancho REAL de la columna en la que se pinta.
///
/// El POS vive dentro de un shell que en `desktop`/`wide` roba 240–264 dp a la
/// sidebar. Sin este ajuste, un portátil de 1440 dp con la sidebar abierta
/// daría 1176 dp útiles y caería en `medium` (dos columnas) cuando la pantalla
/// sí tiene sitio para tres. Se usa con `LayoutBuilder` dentro de la columna
/// real, que es la única medida honesta.
PosLayout posLayoutForWidth(double availableWidth) =>
    PosBreakpoints.fromWidth(availableWidth);
