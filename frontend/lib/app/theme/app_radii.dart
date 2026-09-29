// Radios del sistema de diseño.

import 'package:flutter/material.dart';
//
// Principio: la UI es "blandita" — bordes generosos. Pills solo para controles
// compactos (chips, botones); cards y campos usan radios grandes.


abstract final class AppRadii {
  /// 0 — elementos que no deben redondearse (progress bar, skeleton de línea).
  static const double none = 0;

  /// 8 — chips de estado, thumbnails, thumbs de galería.
  static const double sm = 8;

  /// 12 — inputs, botones medianos, thumbnails de producto.
  static const double md = 12;

  /// 16 — card estándar.
  static const double lg = 16;

  /// 20 — card destacada, modal de detalle.
  static const double xl = 20;

  /// 24 — sheet de detalle, dialogs grandes.
  static const double xxl = 24;

  /// 999 — pill completo (chips de categoría, botones primary/secondary, badges).
  static const double pill = 999;

  // ------------------------------------------------------------------ Helpers
  /// `BorderRadius` uniforme.
  static BorderRadius all(double value) => BorderRadius.circular(value);

  static const BorderRadius smAll = BorderRadius.all(Radius.circular(sm));
  static const BorderRadius mdAll = BorderRadius.all(Radius.circular(md));
  static const BorderRadius lgAll = BorderRadius.all(Radius.circular(lg));
  static const BorderRadius xlAll = BorderRadius.all(Radius.circular(xl));
  static const BorderRadius xxlAll = BorderRadius.all(Radius.circular(xxl));
  static const BorderRadius pillAll = BorderRadius.all(Radius.circular(pill));

  /// Solo esquinas superiores (hojas/banners).
  static BorderRadius top(double value) =>
      BorderRadius.vertical(top: Radius.circular(value));
}
