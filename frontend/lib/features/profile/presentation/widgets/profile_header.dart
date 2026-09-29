// Cabecera del perfil, cifras de actividad y cierre de sesión.
// Módulo `features/profile/presentation/widgets`.
//
// Va en su propio archivo porque son tres piezas independientes del menú de
// secciones, y porque la cabecera necesita `AppCard` + avatar + roles mientras que
// las cifras usan `KpiTile`: mantenerlas juntas obligaba a un archivo de 400
// líneas donde no se distinguía una cosa de otra.
//
// LA FOTO NUNCA QUEDA ROTA
// `Image.network` con `EmptyPlaceholderImage` de respaldo y las iniciales del
// usuario como contenido. El mismo placeholder en error y en carga mantiene la
// cabecera con el mismo alto y aspecto aunque la foto no cargue.


import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../../app/routes.dart';
import '../../../../app/theme/app_radii.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../core/utils/currency_formatter.dart';
import '../../../../domain/entities/user.dart';
import '../../../../shared/widgets/ui/app_button.dart';
import '../../../../shared/widgets/ui/app_card.dart';
import '../../../../shared/widgets/ui/empty_placeholder_image.dart';
import '../../../../shared/widgets/ui/kpi_tile.dart';
import '../../domain/entities/customer_stats.dart';
// `authControllerProvider` es de la feature de auth: la sesión es de toda la app
// y este header cierra sesión desde el perfil. Misma excepción que
// `profile_page.dart` y `admin_users_page.dart`.
import '../../../auth/presentation/auth_controller.dart';

/// Cabecera con los datos del usuario.
class ProfileHeader extends StatelessWidget {
  const ProfileHeader({required this.user, super.key});

  final User user;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      child: Row(
        children: <Widget>[
          _Avatar(user: user),
          const SizedBox(width: AppSpacing.lg),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Semantics(
                  header: true,
                  child: Text(
                    user.displayName,
                    style: AppTextStyles.titleLarge,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                const SizedBox(height: AppSpacing.xxs),
                Text(
                  user.email,
                  style: AppTextStyles.bodySmall
                      .copyWith(color: context.tokens.textSecondary),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                if (user.phone != null) ...<Widget>[
                  const SizedBox(height: AppSpacing.xxs),
                  Text(
                    user.phone!,
                    style: AppTextStyles.captionMedium
                        .copyWith(color: context.tokens.textTertiary),
                  ),
                ],
                if (user.roles.isNotEmpty) ...<Widget>[
                  const SizedBox(height: AppSpacing.sm),
                  _RolesRow(roles: user.roles),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Foto o iniciales.
class _Avatar extends StatelessWidget {
  const _Avatar({required this.user});

  final User user;

  @override
  Widget build(BuildContext context) {
    final String? url = user.photoUrl;
    final Widget initials = EmptyPlaceholderImage(
      name: user.displayName,
      size: 64,
      borderRadius: AppRadii.pill,
    );

    return Semantics(
      image: true,
      label: 'Foto de ${user.displayName}',
      excludeSemantics: true,
      child: url == null || url.isEmpty
          ? initials
          : ClipRRect(
              borderRadius: BorderRadius.circular(64),
              child: Image.network(
                url,
                width: 64,
                height: 64,
                fit: BoxFit.cover,
                // El mismo placeholder en error y en carga: la cabecera no
                // cambia de alto ni de aspecto al fallar la imagen.
                errorBuilder: (BuildContext context, Object error, StackTrace? stack) =>
                    initials,
              ),
            ),
    );
  }
}

/// Roles del usuario, como badges de texto.
class _RolesRow extends StatelessWidget {
  const _RolesRow({required this.roles});

  final List<String> roles;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: AppSpacing.xs,
      runSpacing: AppSpacing.xs,
      children: <Widget>[
        for (final String role in roles)
          Container(
            padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.sm,
              vertical: 2,
            ),
            decoration: BoxDecoration(
              color: context.tokens.surfaceGreenSubtle,
              borderRadius: BorderRadius.circular(999),
            ),
            child: Text(
              role,
              style: AppTextStyles.captionSmall
                  .copyWith(color: context.tokens.textSuccess),
            ),
          ),
      ],
    );
  }
}

/// Rejilla de cifras de actividad.
class _StatsGrid extends StatelessWidget {
  const _StatsGrid({required this.stats});

  final CustomerStats stats;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        final int columns = constraints.maxWidth > 520 ? 4 : 2;
        final List<Widget> tiles = <Widget>[
          KpiTile(
            label: 'Pedidos',
            value: '${stats.totalOrders}',
            icon: Icons.receipt_long_rounded,
            compact: true,
          ),
          KpiTile(
            label: 'Gastado',
            value: CurrencyFormatter.formatCompactMinor(stats.totalSpentMinor),
            icon: Icons.payments_rounded,
            compact: true,
          ),
          KpiTile(
            label: 'Reservas activas',
            value: '${stats.activeReservations}',
            icon: Icons.event_note_rounded,
            compact: true,
          ),
          KpiTile(
            label: 'Sillas en uso',
            value: '${stats.activeRentals}',
            icon: Icons.event_seat_rounded,
            compact: true,
          ),
        ];
        return Wrap(
          spacing: AppSpacing.md,
          runSpacing: AppSpacing.md,
          children: <Widget>[
            for (final Widget tile in tiles)
              SizedBox(
                width: (constraints.maxWidth - (columns - 1) * AppSpacing.md) / columns,
                child: tile,
              ),
          ],
        );
      },
    );
  }
}

/// Bloque de cierre de sesión.
class _LogoutCard extends ConsumerStatefulWidget {
  const _LogoutCard();

  @override
  ConsumerState<_LogoutCard> createState() => _LogoutCardState();
}

class _LogoutCardState extends ConsumerState<_LogoutCard> {
  bool _busy = false;

  Future<void> _logout() async {
    setState(() => _busy = true);
    await ref.read(authControllerProvider.notifier).logout();
    if (!mounted) return;
    // El `redirect` global del router lleva a `/login` en cuanto el estado pasa
    // a `AuthStateUnauthenticated`; si la pantalla sigue montada, se fuerza.
    if (mounted) context.go(AppRoutes.login);
  }

  @override
  Widget build(BuildContext context) {
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Text('¿Ya no usas este dispositivo?', style: AppTextStyles.titleSmall),
          const SizedBox(height: AppSpacing.xxs),
          Text(
            'Cerrar sesión borra los tokens guardados y vacía el carrito de este '
            'dispositivo.',
            style: AppTextStyles.captionMedium
                .copyWith(color: context.tokens.textSecondary),
          ),
          const SizedBox(height: AppSpacing.md),
          AppButton(
            label: 'Cerrar sesión',
            icon: Icons.logout_rounded,
            variant: AppButtonVariant.danger,
            isFullWidth: true,
            isLoading: _busy,
            onPressed: _busy ? null : _logout,
            semanticLabel: 'Cerrar la sesión en este dispositivo',
          ),
        ],
      ),
    );
  }
}
