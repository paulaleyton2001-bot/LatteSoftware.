// Pantalla de perfil del cliente.
//
// SECCIONES, EN EL ORDEN EN QUE SE USAN
//   1. Cabecera con los datos (nombre, email, teléfono, foto, roles).
//   2. Resumen: pedidos, gasto, reservas y alquileres activos (`GET
//      /customers/me`). Son cuatro `KpiTile`, que es el componente del design
//      system para cifras.
//   3. Mis pedidos, mis reservas, historial de pagos.
//   4. Preferencias de notificación, apariencia del tema y sesiones activas.
//   5. Entrada al área de administración, SOLO si el usuario es staff.
//   6. Cerrar sesión.
//
// LA ENTRADA DE PERSONAL
// Se muestra si `canUsePos(user)` o `canUseAdmin(user)`, predicados definidos en
// `app/admin/admin_navigation.dart` que combinan DOS señales del backend
// (`isStaff` y el permiso concreto; `GET /auth/me` devuelve las dos, BR-RBAC-005).
// No se reimplementan aquí: si el criterio cambia, cambia en un sitio.
//
// Ambas rutas tienen guard en `router.dart`: escribir `/pos` o `/admin` a mano
// redirige a `/home` con un aviso. Este enlace solo se pinta a quien puede, que es
// lo que evita el "entro y me echaron".
//
// FOTO DE PERFIL
// `cached_network_image` con `EmptyPlaceholderImage` de respaldo y las iniciales
// del usuario como contenido cuando no hay foto: nunca un avatar roto.


import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
// `canUsePos` y `canUseAdmin` son predicados de DOS señales del backend
// (`isStaff` + permiso) y viven AQUÍ, no en la entidad: son el criterio de
// ENTRADA del router, y la cabecera de este archivo lo deja escrito. Duplicarlos
// en cliente sería la matriz rol × permiso que la norma prohíbe.
import '../../../app/admin/admin_navigation.dart';
import '../../../app/breakpoints.dart';
import '../../../app/routes.dart';
import '../../../app/theme/app_spacing.dart';
import '../../../app/theme/app_tokens.dart';
import '../../../app/theme/app_typography.dart';
import '../../../core/utils/currency_formatter.dart';
import '../../../domain/entities/user.dart';
import '../../../shared/constants/app_strings.dart';
import '../../../shared/widgets/ui/app_button.dart';
import '../../../shared/widgets/ui/app_card.dart';
import '../../../shared/widgets/ui/async_state_builder.dart';
import '../../../shared/widgets/ui/confirm_dialog.dart';
import '../../../shared/widgets/ui/empty_state.dart';
import '../../../shared/widgets/ui/kpi_tile.dart';
import '../../../shared/widgets/ui/section_header.dart';
import '../../../shared/widgets/ui/theme_mode_selector.dart';
import '../../auth/presentation/auth_controller.dart';
import '../../auth/presentation/auth_state.dart';
import '../domain/entities/customer_stats.dart';
import './profile_controller.dart';
import './widgets/profile_header.dart';
import './widgets/profile_menu_tile.dart';

/// Pantalla de perfil.
class ProfilePage extends ConsumerWidget {
  const ProfilePage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<AuthState> session = ref.watch(authSessionAsyncProvider);

    // El chrome (AppBar y navegación) es de `CustomerShell`; esta pantalla solo
    // devuelve su contenido.
    return AsyncStateBuilder<AuthState>(
      value: session,
      loadingMessage: 'Cargando tu perfil…',
      onRetry: () async => ref.read(authControllerProvider.notifier).retryBootstrap(),
      builder: (BuildContext context, AuthState state) {
        final User? actor = state.user;
        if (actor == null) {
          return EmptyState(
            icon: Icons.person_off_rounded,
            title: 'Tu sesión no está disponible',
            message: 'Vuelve a iniciar sesión para ver tu perfil.',
            actionLabel: 'Iniciar sesión',
            onAction: () => context.go(AppRoutes.login),
          );
        }
        return _ProfileBody(user: actor);
      },
    );
  }
}

/// Cuerpo del perfil.
class _ProfileBody extends ConsumerWidget {
  const _ProfileBody({required this.user});

  final User user;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<CustomerStats> stats = ref.watch(customerStatsProvider);
    final AsyncValue<List<CustomerReservation>> reservations =
        ref.watch(myReservationsProvider);
    final AsyncValue<NotificationPreferences> prefs =
        ref.watch(notificationPrefsProvider);
    final double padding = context.breakpoint.screenPadding;

    return ListView(
      padding: EdgeInsets.fromLTRB(padding, AppSpacing.lg, padding, AppSpacing.xxl),
      children: <Widget>[
        ProfileHeader(user: user),
        const SizedBox(height: AppSpacing.xl),
        const SectionHeader(
          title: 'Tu actividad',
          padding: EdgeInsets.fromLTRB(0, 0, AppSpacing.sm, AppSpacing.sm),
        ),
        AsyncStateBuilder<CustomerStats>(
          value: stats,
          loadingMessage: 'Cargando tus números…',
          onRetry: () async => ref.invalidate(customerStatsProvider),
          builder: (BuildContext context, CustomerStats data) =>
              _StatsGrid(stats: data),
        ),
        const SizedBox(height: AppSpacing.xl),
        const SectionHeader(
          title: 'Tus pedidos y reservas',
          padding: EdgeInsets.fromLTRB(0, 0, AppSpacing.sm, AppSpacing.sm),
        ),
        ProfileMenuTile(
          icon: Icons.receipt_long_rounded,
          title: 'Mis pedidos',
          subtitle: 'Estado, silla y comprobante',
          onTap: () => context.go(AppRoutes.orders),
        ),
        ProfileMenuTile(
          icon: Icons.event_note_rounded,
          title: 'Mis reservas',
          subtitle: reservations.valueOrNull == null
              ? 'Cargando…'
              : '${reservations.valueOrNull!.length} reserva'
                  '${reservations.valueOrNull!.length == 1 ? '' : 's'}',
          onTap: () => context.push(AppRoutes.reservations),
        ),
        ProfileMenuTile(
          icon: Icons.payments_rounded,
          title: 'Pagos en el local',
          subtitle: 'Efectivo y tarjeta, sin pasarela',
          onTap: () => context.push(AppRoutes.profilePayments),
        ),
        const SizedBox(height: AppSpacing.lg),
        const SectionHeader(
          title: 'Cuenta',
          padding: EdgeInsets.fromLTRB(0, 0, AppSpacing.sm, AppSpacing.sm),
        ),
        ProfileMenuTile(
          icon: Icons.badge_outlined,
          title: 'Editar mis datos',
          subtitle: user.email,
          onTap: () => context.push(AppRoutes.profileEdit),
        ),
        ProfileMenuTile(
          icon: Icons.lock_outline_rounded,
          title: 'Cambiar contraseña',
          onTap: () => context.push(AppRoutes.profilePassword),
        ),
        ProfileMenuTile(
          icon: Icons.notifications_none_rounded,
          title: 'Notificaciones',
          subtitle: _prefsSummary(prefs.valueOrNull),
          onTap: () => context.push(AppRoutes.profileNotifications),
        ),
        ProfileMenuTile(
          icon: Icons.devices_rounded,
          title: 'Sesiones activas',
          subtitle: 'Dónde tienes la sesión abierta',
          onTap: () => context.push(AppRoutes.profileSessions),
        ),
        if (canUsePos(user)) ...<Widget>[
          const SizedBox(height: AppSpacing.lg),
          const SectionHeader(
            title: 'Personal',
            padding: EdgeInsets.fromLTRB(0, 0, AppSpacing.sm, AppSpacing.sm),
          ),
          // La ruta `/pos` YA EXISTE (router.dart → staffRoutes) y tiene guard de
          // rol: un CUSTOMER que escriba la dirección a mano es devuelto a `/home`
          // con un aviso. Aquí el enlace solo se pinta a quien puede usarlo, que es
          // lo que evita el "entro y me echaron".
          ProfileMenuTile(
            icon: Icons.point_of_sale_rounded,
            title: 'Punto de venta',
            subtitle: 'Abrir el mostrador',
            iconColor: context.tokens.stateInfo,
            onTap: () => context.go(AppRoutes.pos),
          ),
        ],
        if (canUseAdmin(user)) ...<Widget>[
          ProfileMenuTile(
            icon: Icons.admin_panel_settings_outlined,
            title: AppStrings.adminAreaTitle,
            subtitle: 'Pedidos, sillas, inventario y reportes',
            iconColor: context.tokens.stateInfo,
            onTap: () => context.go(AppRoutes.admin),
          ),
        ],
        const SizedBox(height: AppSpacing.lg),
        const SectionHeader(
          title: 'Apariencia',
          padding: EdgeInsets.fromLTRB(0, 0, AppSpacing.sm, AppSpacing.sm),
        ),
        // Las TRES opciones (Sistema / Claro / Oscuro) con icono y etiqueta. Es el
        // sitio canónico del ajuste: el tema es una preferencia de la cuenta, y
        // aquí ya viven las demás (notificaciones, sesiones, datos). El acceso
        // rápido de la barra superior abre este MISMO selector.
        const ThemeModeSelector(showLabel: false),
        const SizedBox(height: AppSpacing.lg),
        const SectionHeader(
          title: 'Sesión',
          padding: EdgeInsets.fromLTRB(0, 0, AppSpacing.sm, AppSpacing.sm),
        ),
        const _LogoutCard(),
      ],
    );
  }

  /// Resumen de las preferencias en una línea.
  static String _prefsSummary(NotificationPreferences? prefs) {
    if (prefs == null) return 'Avisos de pedidos y reservas';
    final List<String> active = <String>[
      if (prefs.push) 'Push',
      if (prefs.email) 'Correo',
      if (prefs.sms) 'SMS',
      if (prefs.whatsapp) 'WhatsApp',
    ];
    if (active.isEmpty) return 'Solo avisos dentro de la app';
    return active.join(' · ');
  }
}

/// Rejilla de las CUATRO cifras del cliente.
///
/// Van en `KpiTile` (el componente del design system para cifras) y no en
/// `Text` sueltos: son las mismas cuatro que vería un encargado, con el mismo
/// formato y el mismo tamaño, y un número con un estilo distinto en dos pantallas
/// se lee como un dato que no cuadra.
class _StatsGrid extends StatelessWidget {
  const _StatsGrid({required this.stats});

  final CustomerStats stats;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        // Dos columnas en móvil, cuatro en desktop: con cuatro columnas en 360 dp
        // cada cifra mide 80 dp y el número no cabe sin `FittedBox`.
        final int columns = constraints.maxWidth >= 560 ? 4 : 2;
        return GridView.count(
          crossAxisCount: columns,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: AppSpacing.sm,
          crossAxisSpacing: AppSpacing.sm,
          // 4:3 con alto FIJO: los `KpiTile` no admiten alto variable y una
          // celda más baja recortaría el número grande.
          childAspectRatio: 1.35,
          children: <Widget>[
            KpiTile(
              label: 'Pedidos',
              value: '${stats.totalOrders}',
              icon: Icons.receipt_long_rounded,
            ),
            KpiTile(
              label: 'Gasto total',
              value: CurrencyFormatter.formatMinor(stats.totalSpentMinor),
              icon: Icons.account_balance_wallet_outlined,
              accent: context.tokens.textSuccess,
            ),
            KpiTile(
              label: 'Reservas activas',
              value: '${stats.activeReservations}',
              icon: Icons.event_note_rounded,
              accent: context.tokens.stateInfo,
            ),
            KpiTile(
              label: 'Alquileres en curso',
              value: '${stats.activeRentals}',
              icon: Icons.hourglass_bottom_rounded,
              accent: context.tokens.stateWarningStrong,
            ),
          ],
        );
      },
    );
  }
}

/// Tarjeta de cerrar sesión, con confirmación.
///
/// `ConfirmDialog` y no un `AlertDialog` propio: es la única forma de pedir
/// confirmación en la app y gestiona la trampa de foco. El motivo es concreto:
/// cerrar sesión vacía la caché del negocio del dispositivo, y en un local
/// compartido eso deja al siguiente sin menú hasta que vuelva a descargarlo.
class _LogoutCard extends ConsumerWidget {
  const _LogoutCard();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<AuthState> session = ref.watch(authSessionAsyncProvider);
    final bool busy = session.valueOrNull?.isResolving ?? false;

    return AppCard(
      variant: AppCardVariant.elevated,
      child: Row(
        children: <Widget>[
          Icon(
            Icons.logout_rounded,
            color: context.tokens.textError,
            size: 20,
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Text(
              'Cerrar sesión en este dispositivo',
              style: AppTextStyles.titleSmall,
            ),
          ),
          const SizedBox(width: AppSpacing.sm),
          AppButton(
            label: 'Salir',
            icon: Icons.logout_rounded,
            variant: AppButtonVariant.danger,
            size: AppButtonSize.small,
            isLoading: busy,
            onPressed: busy ? null : () => _logout(context, ref),
          ),
        ],
      ),
    );
  }

  Future<void> _logout(BuildContext context, WidgetRef ref) async {
    final DialogAction action = await ConfirmDialog.show(
      context,
      title: '¿Cerrar sesión?',
      message: 'Se borra la sesión de este dispositivo y la copia guardada del '
          'menú. Tendrás que entrar otra vez.',
      action: DialogAction.cancel,
      confirmLabel: 'Cerrar sesión',
      icon: Icons.logout_rounded,
    );
    if (action != DialogAction.confirm) return;
    await ref.read(authControllerProvider.notifier).logout();
  }
}
