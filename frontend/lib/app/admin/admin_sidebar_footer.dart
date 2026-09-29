// Pie de la sidebar del panel. MÓDULO `app/admin`.
//
// QUÉ LLEVA
// Nombre del usuario, botón al mostrador y cerrar sesión. El `AppSidebar` ya dibuja
// un `Divider` y un padding alrededor del `footer`, así que aquí solo va el
// contenido.
//
// POR QUÉ ESTÁ SEPARADO DEL SHELL
// `AdminShell` compone navegación; esto compone ACCIONES sobre la sesión. Se
// separaron porque el shell debe poder renderizarse sin saber quién es el usuario
// (durante el arranque, el perfil aún puede no haber resuelto) y este widget
// consulta al usuario por su cuenta.
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../domain/entities/user.dart';
import '../../features/auth/presentation/auth_controller.dart';
import '../../shared/widgets/ui/app_button.dart';
import '../../shared/widgets/ui/confirm_dialog.dart';
import '../routes.dart';
import './admin_shell.dart';

/// Pie de la sidebar del panel: identidad, acceso al POS y cerrar sesión.
class AdminSidebarFooter extends ConsumerWidget {
  const AdminSidebarFooter({required this.user, super.key});

  final User? user;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (user == null) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        _Identity(user: user!),
        const SizedBox(height: 12),
        const PosShortcutButton(),
        const SizedBox(height: 8),
        AppButton(
          label: 'Volver a la app',
          icon: Icons.storefront_outlined,
          variant: AppButtonVariant.ghost,
          size: AppButtonSize.small,
          isFullWidth: true,
          onPressed: () => context.go(AppRoutes.home),
          tooltip: 'Salir del panel sin cerrar sesión',
        ),
        AppButton(
          label: 'Cerrar sesión',
          icon: Icons.logout_rounded,
          variant: AppButtonVariant.ghost,
          size: AppButtonSize.small,
          isFullWidth: true,
          // `unawaited`: el cierre de sesión navega solo (el `redirect` raíz
          // manda a `/login`); el botón no necesita esperar al resultado.
          onPressed: () => unawaited(_logout(context, ref)),
        ),
      ],
    );
  }

  /// Cierra sesión con confirmación: en un turno de caja, un clic de más deja al
  /// cajero fuera y con pedidos sin cobrar en la pantalla.
  Future<void> _logout(BuildContext context, WidgetRef ref) async {
    final DialogAction action = await ConfirmDialog.show(
      context,
      title: '¿Cerrar sesión?',
      message: 'Si hay pedidos en curso en el mostrador, se perderán.',
      confirmLabel: 'Cerrar sesión',
      action: DialogAction.cancel,
      icon: Icons.logout_rounded,
    );
    if (action != DialogAction.confirm || !context.mounted) return;
    await ref.read(authControllerProvider.notifier).logout();
  }
}

/// Nombre y rol del usuario, con monograma.
class _Identity extends StatelessWidget {
  const _Identity({required this.user});

  final User user;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'Sesión de ${user.displayName}',
      child: Row(
        children: <Widget>[
          CircleAvatar(
            radius: 18,
            backgroundColor: Theme.of(context).colorScheme.primaryContainer,
            child: Text(user.initials),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(
                  user.displayName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.titleSmall,
                ),
                if (user.roles.isNotEmpty)
                  Text(
                    user.roles.join(' · '),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    // `bodySmall`: en Material 3 es el escalón que sustituye al
                    // antiguo `captionSmall` de `TextTheme` para texto auxiliar.
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
