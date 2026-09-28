// Pantalla provisional de las rutas cuya feature todavía no existe.
//
// No es un adorno: mientras las features entran una por una, esta pantalla es la
// que permite VERIFICAR que el árbol de rutas, el `redirect` de sesión y los
// guards por rol funcionan. Reemplaza el `placeholderBuilder` monolítico de la
// fase 1.
//
// Cada ruta declara en un comentario a qué feature pertenece y qué roles pueden
// entrar, para que quien implemente la feature sepa exactamente qué espera el
// router. Los roles se leen de `permissions` de `GET /auth/me` (BR-RBAC-005),
// nunca de una matriz duplicada en el cliente.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../app/theme/app_spacing.dart';
import '../features/auth/presentation/auth_controller.dart';
import '../features/auth/presentation/auth_state.dart';
import '../shared/widgets/ui/empty_state.dart';
import 'routes.dart';

/// Placeholder con contexto de la ruta pendiente.
class PlaceholderScreen extends ConsumerWidget {
  const PlaceholderScreen({
    required this.title,
    required this.feature,
    this.allowedRoles = 'Autenticados',
    this.requiredPermissions = const <String>[],
    this.message,
    super.key,
  });

  /// Nombre de la pantalla real, como la verá el usuario.
  final String title;

  /// Feature a la que pertenece la ruta (`features/menu`, `features/pos`...).
  final String feature;

  /// Quién puede entrar. Se muestra como documentación, no se aplica todavía:
  /// el guard por permiso llega con la feature.
  final String allowedRoles;

  /// Claves de permiso que exigirá la pantalla (`products:read`, ...).
  final List<String> requiredPermissions;

  /// Mensaje propio; por defecto explica el estado del trabajo.
  final String? message;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      appBar: AppBar(title: Text(title)),
      body: SafeArea(
        child: EmptyState(
          icon: Icons.construction_rounded,
          title: 'Pantalla en construcción: $title',
          message: message ??
              'Esta pantalla se implementa en $feature. Mientras tanto se '
                  'puede comprobar que la ruta, la redirección de sesión y el '
                  'layout adaptativo funcionan.',
          actionLabel: 'Ir al inicio',
          onAction: () => context.go(AppRoutes.home),
        ),
      ),
      bottomNavigationBar: _RouteFacts(
        feature: feature,
        allowedRoles: allowedRoles,
        requiredPermissions: requiredPermissions,
        currentUser: _sessionLabel(ref),
      ),
    );
  }

  /// Resumen de la sesión: quién está viendo el placeholder y con qué roles.
  static String _sessionLabel(WidgetRef ref) {
    final AuthState state = ref.watch(authControllerProvider);
    final String? email = state.user?.email;
    if (email == null) return 'Sin sesión';
    final List<String> roles = state.user?.roles ?? const <String>[];
    return roles.isEmpty ? email : '$email · ${roles.join(', ')}';
  }
}

/// Franja inferior con los datos de la ruta pendiente.
class _RouteFacts extends StatelessWidget {
  const _RouteFacts({
    required this.feature,
    required this.allowedRoles,
    required this.requiredPermissions,
    required this.currentUser,
  });

  final String feature;
  final String allowedRoles;
  final List<String> requiredPermissions;
  final String currentUser;

  @override
  Widget build(BuildContext context) {
    final List<String> lines = <String>[
      'Feature pendiente: $feature',
      'Acceso previsto: $allowedRoles',
      if (requiredPermissions.isNotEmpty)
        'Permisos: ${requiredPermissions.join(', ')}',
      'Sesión actual: $currentUser',
    ];
    final ThemeData theme = Theme.of(context);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerLow,
        border: Border(top: BorderSide(color: theme.colorScheme.outlineVariant)),
      ),
      child: Text(lines.join('\n'), style: theme.textTheme.captionSmall),
    );
  }
}
