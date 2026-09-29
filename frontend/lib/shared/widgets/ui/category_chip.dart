// Chips de filtro por categoría/estado.
//
// Patrón de la referencia: fila horizontal scrolleable de pills; el chip
// inactivo es crema con texto gris, el activo verde suave con texto verde
// oscuro + check (el color solo no identifica el activo).
//
// Uso típico:
// ```dart
// CategoryChipRow(
//   categories: categories,          // List<Category> o List<String>
//   selectedId: selectedCategoryId,
//   onSelected: ref.read(filterProvider.notifier).select,
// );
// CategoryChip(label: 'Todos', selected: true, onTap: clear);
// ```
import 'package:flutter/material.dart';
import '../../../app/theme/app_radii.dart';
import '../../../app/theme/app_spacing.dart';
import '../../../app/theme/app_tokens.dart';
import '../../../app/theme/app_typography.dart';



/// Chip individual con estado seleccionado/no seleccionado.
class CategoryChip extends StatelessWidget {
  const CategoryChip({
    required this.label,
    required this.onTap,
    this.selected = false,
    this.trailingIcon,
    this.count,
    this.semanticLabel,
    super.key,
  });

  /// Texto del chip.
  final String label;

  /// Activar/desactivar. `null` lo deja inerte (no interactivo).
  final VoidCallback? onTap;

  final bool selected;

  /// Ícono a la izquierda (p. ej. el ícono de la categoría).
  final IconData? trailingIcon;

  /// Contador opcional a la derecha (`12`).
  final int? count;

  /// Etiqueta accesible; por defecto `label` (+ "seleccionado").
  final String? semanticLabel;

  @override
  Widget build(BuildContext context) {
    final AppTokens t = context.tokens;
    // ─────────────────────────────────────────────────────────────────────────
    // POR QUÉ EL RELLENO ES `accentContainer` Y NO `surfaceGreenSubtle`
    // ─────────────────────────────────────────────────────────────────────────
    // El síntoma era "fondo marrón oscuro con los chips crema claro, y el texto
    // del chip ilegible". La causa no era este widget: `surfaceGreenSubtle` en el
    // modo oscuro valía `espressoAccentSurface` (marrón verdoso) y su texto
    // `textSuccess` era salvia, pero el TEMA (no este widget) pintaba los chips
    // con un crema fijo en el `chipTheme`, y `surfaceMuted` en oscuro salía de
    // una rampa clara.
    //
    // Lo que se hace aquí es usar el MISMO par que usa el indicador de la barra
    // de navegación (`accentContainer` / `onAccentContainer`): es el par de la
    // marca que garantiza >= 4.5:1 en los dos modos, y el usuario ya lo reconoce
    // porque es el de la pestaña activa. Un chip activo y una pestaña activa se
    // parecen porque SIGNIFICAN lo mismo.
    final Color background =
        selected ? t.accentContainer : t.surfaceMuted;
    final Color foreground =
        selected ? t.onAccentContainer : t.textSecondary;
    final Color borderColor = selected ? t.accent : t.borderDefault;

    return Semantics(
      button: true,
      selected: selected,
      label: semanticLabel ?? label,
      excludeSemantics: true,
      child: Material(
        color: background,
        borderRadius: BorderRadius.circular(AppRadii.pill),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(AppRadii.pill),
          splashColor: t.focusRingSurface,
          child: Ink(
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(AppRadii.pill),
              border: Border.all(color: borderColor),
            ),
            child: Container(
              // Alto mínimo para target táctil comfortable en móvil.
              constraints: const BoxConstraints(minHeight: 40),
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
              alignment: Alignment.center,
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  if (selected) ...<Widget>[
                    Icon(Icons.check_rounded, size: 16, color: foreground),
                    const SizedBox(width: AppSpacing.xs),
                  ] else if (trailingIcon != null) ...<Widget>[
                    Icon(trailingIcon, size: 16, color: foreground),
                    const SizedBox(width: AppSpacing.sm),
                  ],
                  // `maxLines: 1` con ellipsis: un nombre de categoría largo
                  // ("Bebidas frías y batidos") en una fila horizontal
                  // scrolleable se salía por la derecha y se comía el chip de al
                  // lado. Recortar con puntos es preferible a solapar.
                  Flexible(
                    child: Text(
                      label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppTextStyles.labelLarge.copyWith(color: foreground),
                    ),
                  ),
                  if (count != null) ...<Widget>[
                    const SizedBox(width: AppSpacing.sm),
                    Text(
                      '$count',
                      style: AppTextStyles.labelMedium
                          .copyWith(color: foreground.withOpacity(0.7)),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
