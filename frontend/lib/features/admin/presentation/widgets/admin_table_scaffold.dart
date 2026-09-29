// Piezas de tabla del panel. MÓDULO `features/admin/presentation/widgets`.
//
// TRECE SUBPANTALLAS CON LA MISMA ESTRUCTURA
// Todas necesitan: cabecera de pantalla, barra de búsqueda + filtros, lista
// scrollable y estado vacío. Escribirlas trece veces producía trece variantes de
// "algo salió mal" y trece padding distintos. Aquí están UNA vez.
//
// LA TABLA SE ADAPTA AL ANCHO, NO SE ESTIRA
// En desktop la tabla de productos tiene 6 columnas; en móvil caben 2. En vez de
// un `DataTable` horizontal con scroll (que obliga a arrastrar para ver el
// estado, justo lo que importa), la lista se convierte en TARJETAS apiladas por
// debajo de `desktop` y en filas de tabla por encima. `context.breakpoint`
// decide, no `MediaQuery` directo (docs/DESIGN-TOKENS §5).

import 'package:flutter/material.dart';
import '../../../../app/theme/app_radii.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../shared/widgets/ui/app_text_field.dart';

/// Cabecera de una pantalla del panel: título, subtítulo y acciones.
///
/// Reemplaza a la `AppBar` del shell porque el shell es del Chrome de navegación y
/// el título de la subpantalla es del contenido. Ambos pueden convivir: el shell
/// pone la marca y el menú, esta cabecera pone qué estás viendo.
class AdminPageHeader extends StatelessWidget {
  const AdminPageHeader({
    required this.title,
    this.subtitle,
    this.actions = const <Widget>[],
    super.key,
  });

  final String title;
  final String? subtitle;
  final List<Widget> actions;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.lg),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Semantics(
                  header: true,
                  child: Text(title, style: AppTextStyles.headlineSmall),
                ),
                if (subtitle != null) ...<Widget>[
                  const SizedBox(height: AppSpacing.xxs),
                  Text(
                    subtitle!,
                    style: AppTextStyles.bodySmall
                        .copyWith(color: context.tokens.textSecondary),
                  ),
                ],
              ],
            ),
          ),
          if (actions.isNotEmpty) ...<Widget>[
            const SizedBox(width: AppSpacing.md),
            Wrap(spacing: AppSpacing.sm, children: actions),
          ],
        ],
      ),
    );
  }
}

/// Barra de búsqueda con filtros opcionales.
///
/// El campo de búsqueda es un `AppTextField` del design system (con label
/// flotante y foco visible) y los filtros son botones que abren un `showModal
/// BottomSheet`: una lista corta de opciones se elige mejor en una hoja con
/// `ListTile` de 44 dp que en un `DropdownButton` de 32 dp.
class AdminFilterBar extends StatelessWidget {
  const AdminFilterBar({
    required this.searchHint,
    required this.onSearch,
    this.controller,
    this.filters = const <AdminFilterOption>[],
    super.key,
  });

  final String searchHint;
  final ValueChanged<String> onSearch;
  final TextEditingController? controller;

  /// Filtros disponibles. Los que estén inactivos se ocultan.
  final List<AdminFilterOption> filters;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.lg),
      child: Row(
        children: <Widget>[
          Expanded(
            child: AppTextField(
              controller: controller,
              label: 'Buscar',
              hint: searchHint,
              prefixIcon: Icons.search_rounded,
              textInputAction: TextInputAction.search,
              onChanged: onSearch,
            ),
          ),
          for (final AdminFilterOption filter in filters)
            if (filter.isActive)
              Padding(
                padding: const EdgeInsets.only(left: AppSpacing.sm),
                child: AdminFilterButton(option: filter),
              ),
        ],
      ),
    );
  }
}

/// Filtro del panel: etiqueta, si está activo y qué abre.
class AdminFilterOption {
  const AdminFilterOption({
    required this.id,
    required this.label,
    required this.icon,
    this.isActive = false,
    this.onTap,
  });

  /// Identificador del filtro, para el estado del controlador.
  final String id;
  final String label;
  final IconData icon;
  final bool isActive;
  final VoidCallback? onTap;
}

/// Botón de filtro. Alto ≥ 44 dp y `Semantics` con el valor actual.
class AdminFilterButton extends StatelessWidget {
  const AdminFilterButton({required this.option, super.key});

  final AdminFilterOption option;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: 'Filtrar por ${option.label}',
      excludeSemantics: true,
      child: Tooltip(
        message: option.label,
        child: Material(
          color: option.isActive
              ? context.tokens.surfaceGreenSubtle
              : context.tokens.surfaceMuted,
          borderRadius: BorderRadius.circular(AppRadii.md),
          child: InkWell(
            onTap: option.onTap,
            borderRadius: BorderRadius.circular(AppRadii.md),
            child: Container(
              constraints: const BoxConstraints(minHeight: 44),
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(AppRadii.md),
                border: Border.all(
                  color: option.isActive
                      ? context.tokens.brandDark
                      : context.tokens.borderDefault,
                ),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  if (option.isActive) ...<Widget>[
                    Icon(Icons.check_rounded,
                        size: 16, color: context.tokens.actionPrimary),
                    const SizedBox(width: AppSpacing.xs),
                  ],
                  Icon(option.icon, size: 18, color: context.tokens.textSecondary),
                  const SizedBox(width: AppSpacing.xs),
                  ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 88),
                    child: Text(
                      option.label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppTextStyles.labelMedium
                          .copyWith(color: context.tokens.textSecondary),
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
