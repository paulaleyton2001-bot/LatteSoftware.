// Tokens de borde y separadores.
//
// La referencia usa líneas "hairline" crema: separadores casi invisibles que
// estructuran sin ruido visual. En pantallas táctiles se sube a 1dp real y en
// escritorio 1dp con opacidad reducida.

import 'package:flutter/material.dart';

import 'app_colors.dart';
import 'app_spacing.dart';

abstract final class AppBorders {
  /// Grosor hairline estándar (1dp lógico).
  static const double width = 1;

  /// Grosor de borde de foco/error.
  static const double widthStrong = 2;

  /// Color por defecto de borde.
  static const Color color = AppPalette.borderSubtle;

  /// Color de borde de card outlined / chip.
  static const Color colorDefault = AppPalette.borderDefault;

  /// Color de borde de input en reposo.
  static const Color colorInput = AppPalette.borderInput;

  /// Color de borde de control identificable solo por su borde (3.86:1).
  static const Color colorStrong = AppPalette.borderStrong;

  // ------------------------------------------------------------------ Bordes
  /// Borde hairline estándar (card outlined, tabla).
  static Border get subtle => Border.all(color: color, width: width);

  /// Borde de card outlined con un punto más de presencia.
  static Border get outlined => Border.all(color: colorDefault, width: width);

  /// Borde de inputs en reposo.
  static Border get input => Border.all(color: colorInput, width: width);

  /// Borde de checkbox / radio / switch: cumple 1.4.11 (3:1).
  static Border get strong => Border.all(color: colorStrong, width: width);

  /// Borde de foco: verde + halo suave (WCAG 2.4.11 foco no oculta).
  static Border get focus => Border.all(color: AppPalette.focusRing, width: widthStrong);

  /// Borde de error (valida en línea al perder el foco).
  static Border get error => Border.all(color: AppPalette.errorDark, width: width);

  /// Sin borde.
  static const Border none = BorderSide.none;

  // ------------------------------------------------------------- Separadores
  /// Separador horizontal de 1dp que ocupa el ancho disponible.
  static const Widget divider = Divider(
    height: 1,
    thickness: 1,
    color: color,
  );

  /// Separador con sangría (para listas dentro de una card).
  static Widget indentedDivider({double indent = AppSpacing.lg}) => Padding(
        padding: EdgeInsets.only(left: indent),
        child: divider,
      );

  /// Separador vertical (tablas, filas de formulario).
  static const Widget verticalDivider = SizedBox(
    width: 1,
    height: 24,
    child: ColoredBox(color: color),
  );
}
