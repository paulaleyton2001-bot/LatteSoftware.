// Fila horizontal de chips de filtro.
//
// Patrón de la referencia: una sola línea scrolleable de pills; el chip activo
// se rellena de verde suave con check y texto verde oscuro.
//
// En tablet/desktop puede convenir un `Wrap` en lugar de esta fila: quien
// tenga muchas categorías decide en la feature, aquí no se adivina.

import 'package:flutter/material.dart';

import '../../../app/theme/app_spacing.dart';
import 'category_chip.dart';

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

  /// Nombre accesible del grupo (el lector anuncia un campo "Filtros").
  final String semanticRowLabel;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      container: true,
      label: semanticRowLabel,
      child: SizedBox(
        height: 52,
        child: ListView.separated(
          scrollDirection: Axis.horizontal,
          padding: padding,
          itemCount: labels.length,
          separatorBuilder: (_, __) => const SizedBox(width: AppSpacing.sm),
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
    );
  }
}
