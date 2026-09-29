// Stepper de cantidad. Vive en `shared/` porque lo usan el carrito y la ficha de
// producto, y las features no se importan entre sí (docs/DESIGN.md §2.3).
//
// ACCESIBILIDAD (WCAG 2.5.5 y 4.1.2)
// - Los dos botones son de 44 × 44 dp exactos (`AppTapTarget.iconButton`).
// - Cada uno tiene `tooltip` Y `Semantics(button: true, label: ...)`: "icono
//   más" no le dice nada a un lector de pantalla; "Restar una unidad a
//   Espresso doble" sí.
// - El valor es un nodo propio con `Semantics(value:)` y `liveRegion`, para que
//   el cambio se anuncie sin que el usuario tenga que buscar dónde cambió.
// - `enabled` en el botón de restar avisa del límite ANTES de pulsarlo, no
//   después con un error.
import 'package:flutter/material.dart';
import '../../../app/theme/app_tokens.dart';
import '../../../app/theme/app_typography.dart';



/// Stepper `− n +` con límites.
class QuantityStepper extends StatelessWidget {
  const QuantityStepper({
    required this.quantity,
    required this.onChanged,
    this.min = 1,
    this.max = 99,
    this.semanticLabel,
    super.key,
  });

  final int quantity;
  final ValueChanged<int> onChanged;
  final int min;
  final int max;

  /// Nombre del control, para que los botones se lean como "Restar una unidad a
  /// <este producto>".
  final String? semanticLabel;

  @override
  Widget build(BuildContext context) {
    final String base = semanticLabel ?? 'cantidad';
    final bool canDecrease = quantity > min;
    final bool canIncrease = quantity < max;

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        _StepperButton(
          icon: Icons.remove_rounded,
          tooltip: 'Restar una unidad',
          semanticLabel: 'Restar una unidad a $base',
          onPressed: canDecrease ? () => onChanged(quantity - 1) : null,
        ),
        Semantics(
          liveRegion: true,
          label: 'Cantidad de $base',
          value: '$quantity',
          child: ExcludeSemantics(
            child: Container(
              constraints: const BoxConstraints(minWidth: 44, minHeight: 44),
              alignment: Alignment.center,
              child: Text(
                '$quantity',
                style: AppTextStyles.titleMedium
                    .copyWith(color: context.tokens.textPrimary),
              ),
            ),
          ),
        ),
        _StepperButton(
          icon: Icons.add_rounded,
          tooltip: 'Añadir una unidad',
          semanticLabel: 'Añadir una unidad a $base',
          onPressed: canIncrease ? () => onChanged(quantity + 1) : null,
        ),
      ],
    );
  }
}

/// Botón circular del stepper con target táctil garantizado.
class _StepperButton extends StatelessWidget {
  const _StepperButton({
    required this.icon,
    required this.tooltip,
    required this.semanticLabel,
    required this.onPressed,
  });

  final IconData icon;
  final String tooltip;
  final String semanticLabel;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      enabled: onPressed != null,
      label: semanticLabel,
      excludeSemantics: true,
      child: Tooltip(
        message: tooltip,
        child: SizedBox.square(
          dimension: 44,
          child: Material(
            color: context.tokens.surfaceMuted,
            shape: const CircleBorder(),
            child: InkWell(
              onTap: onPressed,
              customBorder: const CircleBorder(),
              splashColor: context.tokens.focusRingSurface,
              child: Icon(
                icon,
                size: 20,
                color: onPressed == null
                    ? context.tokens.textDisabled
                    : context.tokens.textPrimary,
              ),
            ),
          ),
        ),
      ),
    );
  }
}
