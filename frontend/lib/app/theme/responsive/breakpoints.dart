// Breakpoints responsive y helpers de layout adaptativo.
//
// Objetivo de diseño: desktop NO es la app móvil estirada. Cada breakpoint
// cambia la navegación (bottom bar / rail / sidebar), el número de columnas y
// la densidad, no solo el ancho.
//
// Ver docs/DESIGN-TOKENS.md §5 para la tabla de valores exactos.

import 'package:flutter/widgets.dart';

/// Puntos de corte del layout. El orden del enum ES el orden de tamaño.
enum Breakpoint {
  /// < 600 dp — navegación inferior de 5 destinos, 1 columna.
  mobile,

  /// 600–1023 dp — NavigationRail, 2 columnas.
  tablet,

  /// 1024–1439 dp — sidebar fija, 3 columnas, tablas densas.
  desktop,

  /// >= 1440 dp — sidebar fija + contenido con ancho máximo, 4 columnas.
  wide;

  /// Límite superior exclusivo en dp (null = infinito).
  double? get maxWidthDp => switch (this) {
        Breakpoint.mobile => 600,
        Breakpoint.tablet => 1024,
        Breakpoint.desktop => 1440,
        Breakpoint.wide => null,
      };

  /// Límite inferior inclusivo en dp.
  double get minWidthDp => switch (this) {
        Breakpoint.mobile => 0,
        Breakpoint.tablet => 600,
        Breakpoint.desktop => 1024,
        Breakpoint.wide => 1440,
      };

  /// `true` en móvil: navegación inferior.
  bool get isMobile => this == Breakpoint.mobile;

  /// `true` en tablet.
  bool get isTablet => this == Breakpoint.tablet;

  /// Etiqueta legible (solo diagnóstico/dev; nunca en UI de usuario).
  String get label => switch (this) {
        Breakpoint.mobile => 'mobile',
        Breakpoint.tablet => 'tablet',
        Breakpoint.desktop => 'desktop',
        Breakpoint.wide => 'wide',
      };

  /// `true` en móvil y tablet: la navegación no es un sidebar persistente.
  bool get usesBottomNavigation => this == Breakpoint.mobile;

  /// `true` solo en tablet: hay NavigationRail.
  bool get usesRail => this == Breakpoint.tablet;

  /// `true` en desktop y wide: sidebar persistente con logo + items + perfil.
  bool get usesSidebar => this == Breakpoint.desktop || this == Breakpoint.wide;

  /// Densidad de contenido: más elementos por fila en pantallas grandes.
  int gridColumns(int baseColumns) => switch (this) {
        Breakpoint.mobile => baseColumns,
        Breakpoint.tablet => baseColumns + 1,
        Breakpoint.desktop => baseColumns + 2,
        Breakpoint.wide => baseColumns + 3,
      };

  /// Ancho máximo del contenido legible (evita líneas de 2000 px).
  double get contentMaxWidth => switch (this) {
        Breakpoint.mobile => double.infinity,
        Breakpoint.tablet => 840,
        Breakpoint.desktop => 1120,
        Breakpoint.wide => 1360,
      };

  /// Ancho de la sidebar en desktop/wide.
  double get sidebarWidth => this == Breakpoint.wide ? 264 : 240;

  /// Ancho del NavigationRail en tablet.
  double get railWidth => 80;

  /// Padding horizontal de pantalla.
  double get screenPadding => switch (this) {
        Breakpoint.mobile => 16,
        Breakpoint.tablet => 24,
        Breakpoint.desktop => 32,
        Breakpoint.wide => 40,
      };
}

/// Resolución de breakpoints desde un [MediaQuery] o un ancho arbitrario.
abstract final class Breakpoints {
  /// Resuelve el breakpoint a partir del ancho en dp.
  static Breakpoint fromWidth(double width) {
    if (width < Breakpoint.tablet.minWidthDp) return Breakpoint.mobile;
    if (width < Breakpoint.desktop.minWidthDp) return Breakpoint.tablet;
    if (width < Breakpoint.wide.minWidthDp) return Breakpoint.desktop;
    return Breakpoint.wide;
  }

  /// Menos de `Breakpoint.desktop`: layout compacto, sin rail.
  static bool isCompact(BuildContext context) =>
      MediaQuery.sizeOf(context).width < Breakpoint.desktop.minWidthDp;

  static bool isMobile(BuildContext context) =>
      MediaQuery.sizeOf(context).width < Breakpoint.tablet.minWidthDp;

  static bool isDesktopOrWider(BuildContext context) =>
      MediaQuery.sizeOf(context).width >= Breakpoint.desktop.minWidthDp;
}

/// Acceso al breakpoint desde cualquier `BuildContext`.
///
/// Uso: `context.breakpoint == Breakpoint.mobile`, `context.isMobile`,
/// `context.breakpoint.gridColumns(2)`.
extension BreakpointContext on BuildContext {
  /// Breakpoint actual según el ancho de la ventana.
  Breakpoint get breakpoint =>
      Breakpoints.fromWidth(MediaQuery.sizeOf(this).width);

  /// `true` en móvil (< 600 dp).
  bool get isMobile => breakpoint == Breakpoint.mobile;

  /// `true` en tablet.
  bool get isTablet => breakpoint == Breakpoint.tablet;

  /// `true` en desktop o wide (hay sidebar persistente).
  bool get isDesktopOrWider => breakpoint.usesSidebar;

  /// Alto del viewport útil (descontando app bar y bottom nav si ya se descontaron).
  double get viewportHeight => MediaQuery.sizeOf(this).height;

  /// `true` si el usuario pidió menos animación.
  bool get prefersReducedMotion => MediaQuery.disableAnimationsOf(this);
}
