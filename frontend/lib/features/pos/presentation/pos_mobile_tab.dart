// Secciones del POS en móvil. MÓDULO `pos/presentation`.
//
// En `PosLayout.compact` el POS no cabe en tres columnas: el catálogo con 140 dp
// por celda no es legible y el botón de cobrar queda lejos del pulgar. Por eso hay
// TRES PESTAÑAS explícitas en vez de un `Row` aplastado.
//
// MÓDULO aparte del layout porque lo comparten `PosWorkspace` y `PosPage`: la
// barra de pestañas y el enum tienen que ser la misma lista, o el número de
// destinos se desincroniza.

import 'package:flutter/material.dart';
import '../../../app/theme/app_spacing.dart';
import '../../../app/theme/app_tokens.dart';
import '../../../app/theme/app_typography.dart';
import '../../../shared/constants/app_strings.dart';

/// Secciones del POS en móvil (`PosLayout.compact`).
enum PosMobileTab {
  catalog(AppStrings.posTabCatalog, Icons.grid_view_rounded),
  order(AppStrings.posTabOrder, Icons.receipt_long_rounded),
  charge(AppStrings.posTabCharge, Icons.payments_rounded);

  const PosMobileTab(this.label, this.icon);

  final String label;
  final IconData icon;
}

/// Barra de pestañas del POS en una columna.
class PosMobileTabBar extends StatelessWidget {
  const PosMobileTabBar({required this.current, required this.onChanged});

  final PosMobileTab current;
  final ValueChanged<PosMobileTab> onChanged;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 56,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.md,
          vertical: AppSpacing.sm,
        ),
        children: <Widget>[
          for (final PosMobileTab tab in PosMobileTab.values)
            Padding(
              padding: const EdgeInsets.only(right: AppSpacing.sm),
              child: _TabButton(
                tab: tab,
                selected: tab == current,
                onTap: () => onChanged(tab),
              ),
            ),
        ],
      ),
    );
  }
}

/// Botón de pestaña del POS. Alto ≥ 44 dp, check + fondo al activo.
class _TabButton extends StatelessWidget {
  const _TabButton({
    required this.tab,
    required this.selected,
    required this.onTap,
  });

  final PosMobileTab tab;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final Color foreground =
        selected ? context.tokens.textSuccess : context.tokens.textSecondary;
    return Semantics(
      button: true,
      selected: selected,
      label: tab.label,
      excludeSemantics: true,
      child: Material(
        color:
            selected ? context.tokens.surfaceGreenSubtle : context.tokens.surfaceMuted,
        borderRadius: BorderRadius.circular(999),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(999),
          child: Container(
            constraints: const BoxConstraints(minHeight: 44),
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(999),
              border: Border.all(
                color: selected ? context.tokens.brandDark : context.tokens.borderDefault,
              ),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                if (selected) ...<Widget>[
                  Icon(Icons.check_rounded,
                      size: 16, color: context.tokens.actionPrimary),
                  const SizedBox(width: AppSpacing.xs),
                ],
                Icon(tab.icon, size: 18, color: foreground),
                const SizedBox(width: AppSpacing.sm),
                Text(
                  tab.label,
                  style: AppTextStyles.labelLarge.copyWith(color: foreground),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
