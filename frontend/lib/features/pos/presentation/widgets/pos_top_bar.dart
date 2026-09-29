// Barra superior del mostrador. MÓDULO `pos/presentation/widgets`.
//
// MARCA, TABLERO Y ATAJOS
// Tres cosas que siempre están en el mismo sitio. Se separó de `pos_page.dart`
// porque la barra no sabe nada del flujo de cobro ni de los diálogos: solo navega
// y avisa. Si compartiera archivo, cada cambio en la orquestación del cobro
// tocaría también la barra.
//
// EL BOTÓN DEL TABLERO ES DE 40 DP
// Es una acción secundaria que se usa una vez por turno, no el control principal
// del POS: por eso `AppButtonSize.small` (40 dp) y el cobro vive en la columna
// derecha, con 56 dp.

import 'package:flutter/material.dart';
import '../../../../app/responsive/pos_breakpoints.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../shared/widgets/ui/app_button.dart';
import '../pos_shortcuts.dart';

class PosTopBar extends StatelessWidget {
  const PosTopBar({
    required this.layout,
    required this.onShowOrders,
    required this.onShowShortcuts,
  });

  final PosLayout layout;
  final VoidCallback onShowOrders;
  final VoidCallback onShowShortcuts;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.md,
        vertical: AppSpacing.sm,
      ),
      child: Row(
        children: <Widget>[
          Icon(Icons.local_cafe_rounded,
              size: 22, color: context.tokens.actionPrimary),
          const SizedBox(width: AppSpacing.sm),
          Text('Latte Coffee', style: AppTextStyles.titleLarge),
          const Spacer(),
          if (layout.hasSidePanel)
            const PosShortcutHintBar()
          else
            IconButton(
              onPressed: onShowShortcuts,
              icon: const Icon(Icons.keyboard_alt_outlined, size: 20),
              tooltip: 'Ver los atajos de teclado',
              constraints: const BoxConstraints(minWidth: 44, minHeight: 44),
            ),
          const SizedBox(width: AppSpacing.xs),
          AppButton(
            label: 'Tablero',
            icon: Icons.dashboard_outlined,
            variant: AppButtonVariant.secondary,
            size: AppButtonSize.small,
            onPressed: onShowOrders,
            tooltip: 'Abrir el tablero de pedidos',
          ),
        ],
      ),
    );
  }
}
