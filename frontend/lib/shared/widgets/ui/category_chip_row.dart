// Fila horizontal de chips de filtro.
//
// Patrón de la referencia: una sola línea scrolleable de pills; el chip activo
// se rellena de verde suave con check y texto verde oscuro.
//
// En tablet/desktop puede convenir un `Wrap` en lugar de esta fila: quien
// tenga muchas categorías decide en la feature, aquí no se adivina.
//
// ─────────────────────────────────────────────────────────────────────────────
// POR QUÉ [spacing] ES UN PARÁMETRO Y NO UN `AppSpacing.sm` FIJO
// ─────────────────────────────────────────────────────────────────────────────
// El usuario reportó los chips del menú «pegados entre sí». La separación que
// había (8 dp, `AppSpacing.sm`) era correcta en un carril de dos o tres filtros
// cortos y se quedaba corta en cuanto la fila tenía cinco o seis: dos pills de
// 36 dp de alto separadas por 8 dp se leen como una barra continua, sobre todo
// con el borde que lleva cada chip.
//
// Ahora es [spacing], con `AppSpacing.md` (12 dp) por defecto, y quien lo necesite
// (una fila de filtros numerosos) lo sube sin abrir este archivo. La
// separación mínima se documenta aquí para que no vuelva a bajar de 8.


import 'package:flutter/material.dart';
import '../../../app/theme/app_spacing.dart';
import './category_chip.dart';

/// Separación por defecto entre dos pills de la fila.
///
/// 12 dp es el hueco de `AppSpacing.md` y el que separa dos controles contiguos en
/// el resto del sistema. Por debajo de `AppSpacing.sm` (8) dos pills con borde
/// dejan de leerse como dos cosas.
const double kCategoryChipSpacing = AppSpacing.md;

/// Fila horizontal scrolleable de chips (patrón de filtros del menú).
///
/// El alto se limita para que un chip nunca pase de 44 dp de alto en móvil y
/// la fila ocupe una sola línea: en tablet/desktop, quien lo necesite puede
/// usar `Wrap` en lugar de esta fila.
class CategoryChipRow extends StatelessWidget {
  const CategoryChipRow({
    required this.labels,
    required this.onSelected,
    this.selectedLabel,
    this.padding = const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
    this.spacing = kCategoryChipSpacing,
    this.verticalPadding = AppSpacing.sm,
    this.semanticRowLabel = 'Filtros',
    super.key,
  });

  /// Etiquetas en orden de aparición.
  final List<String> labels;

  /// Callback con la etiqueta pulsada.
  final ValueChanged<String> onSelected;

  /// Etiqueta activa.
  final String? selectedLabel;

  final EdgeInsetsGeometry padding;

  /// Separación horizontal entre pills consecutive.
  final double spacing;

  /// Aire vertical del carril respecto al contenido de arriba y de abajo.
  ///
  /// Va FUERA del `SizedBox` de alto fijo y no en el `padding` del `ListView`
  /// (que se comería el alto de la fila): así los chips siguen midiendo lo que
  /// miden y lo que se separa es la fila del buscador y del título.
  final double verticalPadding;

  /// Nombre accesible del grupo (el lector anuncia un campo "Filtros").
  final String semanticRowLabel;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      container: true,
      label: semanticRowLabel,
      child: Padding(
        padding: EdgeInsets.symmetric(vertical: verticalPadding),
        child: SizedBox(
          height: 52,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            padding: padding,
            itemCount: labels.length,
            separatorBuilder: (BuildContext context, int index) =>
                SizedBox(width: spacing),
            itemBuilder: (BuildContext context, int index) {
              final label = labels[index];
              return Center(
                child: CategoryChip(
                  label: label,
                  selected: label == selectedLabel,
                  onTap: () => onSelected(label),
                ),
              );
            },
          ),
        ),
      ),
    );
  }
}
