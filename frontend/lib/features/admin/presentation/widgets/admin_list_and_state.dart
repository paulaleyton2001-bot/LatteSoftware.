// Lista adaptativa y estados vacíos del panel.
// MÓDULO `features/admin/presentation/widgets`.
//
// Ver `admin_table_scaffold.dart` para el criterio de por qué están en un módulo
// aparte: las trece subpantallas comparten estructura, y la estructura no puede
// vivir pegada a una de ellas.

import 'package:flutter/material.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../shared/widgets/ui/empty_state.dart';

/// Lista adaptativa: filas de tabla en desktop, tarjetas en móvil.
class AdminResponsiveList extends StatelessWidget {
  const AdminResponsiveList({
    required this.count,
    required this.itemBuilder,
    required this.emptyState,
    super.key,
  });

  final int count;
  final Widget Function(BuildContext context, int index) itemBuilder;
  final Widget emptyState;

  @override
  Widget build(BuildContext context) {
    if (count == 0) return emptyState;
    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        final bool asTable = constraints.maxWidth >= 720;
        return ListView.separated(
          padding: EdgeInsets.zero,
          itemCount: count,
          separatorBuilder: (BuildContext context, int index) =>
              SizedBox(height: asTable ? AppSpacing.sm : AppSpacing.md),
          itemBuilder: (BuildContext context, int index) =>
              itemBuilder(context, index),
        );
      },
    );
  }
}

/// Estado vacío estándar de una tabla del panel.
class AdminEmptyTable extends StatelessWidget {
  const AdminEmptyTable({
    required this.title,
    required this.message,
    this.icon = Icons.inbox_rounded,
    this.actionLabel,
    this.onAction,
    super.key,
  });

  final String title;
  final String message;
  final IconData icon;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    return EmptyState(
      icon: icon,
      title: title,
      message: message,
      actionLabel: actionLabel,
      onAction: onAction,
    );
  }
}
