// Escala de espaciado base 4pt + helpers.
//
// Regla: todo margen/padding/gap del código usa estos tokens. Un número "suelto"
// en un `EdgeInsets` es un error de diseño, no un detalle de estilo.
// Excepción única documentada: anchos de breakpoints (que no son grid de 4pt).

import 'package:flutter/widgets.dart';

/// Escala de espaciado en múltiplos de 4.
abstract final class AppSpacing {
  /// 0 — sin espacio.
  static const double none = 0;
  /// 2 — micro-ajustes (gap entre icono y texto dentro de un chip).
  static const double xxs = 2;
  /// 4 — separación mínima noticeable.
  static const double xs = 4;
  /// 8 — gap entre elementos de una misma línea, padding de badge.
  static const double sm = 8;
  /// 12 — padding interno de card chico, gap de lista.
  static const double md = 12;
  /// 16 — padding estándar de card, separación entre secciones menores.
  static const double lg = 16;
  /// 24 — gap entre grupos de contenido, padding de card grande.
  static const double xl = 24;
  /// 32 — separación entre secciones de una pantalla.
  static const double xxl = 32;
  /// 40 — padding vertical de pantallas de contenido denso.
  static const double xxxl = 40;
  /// 48 — ritmo vertical de un hero/banner.
  static const double huge = 48;
  /// 64 — respiración máxima (hero, login card en desktop).
  static const double massive = 64;

  // --------------------------------------------------------- Helpers de layout
  /// Padding de card estándar.
  static const EdgeInsets cardPadding = EdgeInsets.all(lg);

  /// Padding de pantalla: `lg` en móvil, `xl` en tablet+.
  static EdgeInsets screenPadding({required bool isCompact}) =>
      EdgeInsets.all(isCompact ? lg : xl);

  /// Padding vertical de página (respeta safe area).
  static EdgeInsets pageVertical(double top, double bottom) =>
      EdgeInsets.only(top: top, bottom: bottom);

  /// `EdgeInsets.symmetric` con el token de la escala.
  static EdgeInsets h(double value) => EdgeInsets.symmetric(horizontal: value);

  /// `EdgeInsets.symmetric` vertical.
  static EdgeInsets v(double value) => EdgeInsets.symmetric(vertical: value);

  /// `EdgeInsets.only` con un valor.
  static EdgeInsets only({
    double left = none,
    double top = none,
    double right = none,
    double bottom = none,
  }) => EdgeInsets.only(left: left, top: top, right: right, bottom: bottom);
}

/// Objetivos táctiles mínimos (WCAG 2.5.5 / Material accessibility).
abstract final class AppTapTarget {
  /// Mínimo absoluto 44x44 dp. Todo control interactivo debe respetarlo.
  static const double min = 44;

  /// Altura de los botones por tamaño (nunca por debajo de `min` en sm).
  static const double buttonSmall = 40;
  static const double buttonMedium = 48;
  static const double buttonLarge = 56;

  /// Tamaño de los icon-buttons circulares (favorito, cerrar, stepper).
  static const double iconButton = 44;

  /// Ancho mínimo de un chip táctil.
  static const double chipHeight = 36;
}
