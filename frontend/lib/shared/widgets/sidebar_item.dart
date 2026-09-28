// Item de la sidebar de escritorio. MÓDULO `AppSidebar`.
//
// Separado por tamaño de archivo. El activo se distingue por TRES canales:
// fondo verde suave, texto/ícono verde oscuro y una barra de 3 dp a la
// izquierda (forma), para que no dependa del color.

import 'package:flutter/material.dart';

import '../../app/theme/app_colors.dart';
import '../../app/theme/app_radii.dart';
import '../../app/theme/app_spacing.dart';
import '../../app/theme/app_typography.dart';
import '../constants/app_destination.dart';

/// Item de la sidebar. Alto mínimo 44 dp (WCAG 2.5.5).
class SidebarItem extends StatelessWidget {
  const SidebarItem({
    required this.destination,
    required this.selected,
    required this.onTap,
  });

  final AppDestination destination;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final foreground =
        selected ? AppColors.textSuccess : AppColors.textSecondary;
    final int? count = destination.badgeCount;

    return Semantics(
      button: true,
      selected: selected,
      label: destination.label,
      excludeSemantics: true,
      child: Padding(
        padding: const EdgeInsets.only(bottom: AppSpacing.xs),
        child: Material(
          color: selected ? AppColors.surfaceGreenSubtle : Colors.transparent,
          borderRadius: BorderRadius.circular(AppRadii.md),
          child: InkWell(
            onTap: onTap,
            borderRadius: BorderRadius.circular(AppRadii.md),
            splashColor: AppColors.focusRingSurface,
            child: Container(
              constraints: const BoxConstraints(minHeight: 44),
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
              child: Row(
                children: <Widget>[
                  // Barra de 3 dp: el activo se distingue también por forma.
                  AnimatedContainer(
                    duration: const Duration(milliseconds: 180),
                    width: 3,
                    height: 20,
                    margin: const EdgeInsets.only(right: AppSpacing.md),
                    decoration: BoxDecoration(
                      color: selected ? AppColors.brandDark : Colors.transparent,
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                  Icon(
                    selected ? destination.selectedIcon : destination.icon,
                    size: 20,
                    color: foreground,
                  ),
                  const SizedBox(width: AppSpacing.md),
                  Expanded(
                    child: Text(
                      destination.label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppTextStyles.labelLarge.copyWith(
                        color: foreground,
                        fontWeight:
                            selected ? FontWeight.w700 : FontWeight.w500,
                      ),
                    ),
                  ),
                  if (count != null && count > 0)
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: AppSpacing.sm,
                        vertical: 2,
                      ),
                      decoration: BoxDecoration(
                        color: AppColors.stateErrorStrong,
                        borderRadius: BorderRadius.circular(AppRadii.pill),
                      ),
                      child: Text(
                        '$count',
                        style: AppTextStyles.captionSmall.copyWith(
                          color: AppColors.onActionPrimary,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
