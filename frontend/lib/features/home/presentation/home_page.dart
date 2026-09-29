// Pantalla de inicio del cliente: la que aparece al entrar.
//
// QUÉ REÚNE, EN ESTE ORDEN
//   1. Saludo con el nombre del cliente y el momento del día.
//   2. Estado del local: abierto/cerrado y horario (`GET /business` +
//      `GET /business/hours`). Sin pasarela: se paga aquí, en efectivo o tarjeta.
//   3. Tu silla activa, si la hay, CON TEMPORIZADOR EN VIVO.
//   4. Destacados del menú (misma rejilla, mismos datos cacheados que el menú).
//   5. Categorías, para saltar al menú.
//
// LAYOUT ADAPTATIVO (docs/DESIGN-TOKENS §5)
//   mobile / tablet → una columna
//   desktop / wide  → dos columnas: la información a la izquierda y el panel de
//                     pedido/reservas a la derecha.
//
// ESTADOS
//   El catálogo de la home es el MISMO provider que el del menú, así que la home
//   no hace una segunda descarga. La búsqueda de alquileres pasa por
//   `AsyncStateBuilder`; el local pinta su caché de inmediato y avisa si la
//   lectura de red falló.


import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../app/breakpoints.dart';
import '../../../app/theme/app_radii.dart';
import '../../../app/theme/app_spacing.dart';
import '../../../app/theme/app_tokens.dart';
import '../../../app/theme/app_typography.dart';
import '../../../shared/constants/app_strings.dart';
import '../../../shared/constants/greeting.dart';
import '../../../shared/widgets/ui/async_state_builder.dart';
import '../../../shared/widgets/ui/section_header.dart';
import '../../chair/presentation/chair_controller.dart';
import '../../menu/domain/entities/menu_category.dart';
import '../../menu/domain/repositories/menu_repository.dart';
// `currentUserProvider` es de la feature de auth (la sesión es de toda la app).
// Misma excepción que `admin_users_page.dart` y `chair_controller.dart`: el
// saludo de la home necesita el nombre del cliente y no hay provider equivalente
// fuera de las features.
import '../../auth/presentation/auth_controller.dart';
import '../../menu/presentation/menu_controller.dart';
import '../../orders/domain/entities/rental.dart';
import '../domain/entities/business_status.dart';
import './home_controller.dart';
import './widgets/home_blocks.dart';
import './widgets/home_content.dart';
import './widgets/home_side_panel.dart';

/// Pantalla de inicio.
class HomePage extends ConsumerWidget {
  const HomePage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final GoRouterState state = GoRouterState.of(context);
    final AsyncValue<BusinessStatus> business = ref.watch(businessStatusProvider);
    final BusinessStatus? cached = ref.watch(cachedBusinessStatusProvider);
    final AsyncValue<List<Rental>> rentals = ref.watch(myRentalsProvider);
    final Rental? active = ref.watch(activeRentalProvider);
    final AsyncValue<MenuCatalog> catalog = ref.watch(menuProductsProvider);
    final AsyncValue<List<MenuCategory>> categories =
        ref.watch(menuCategoriesProvider);
    final double padding = context.breakpoint.screenPadding;

    // Aviso de ACCESO DENEGADO, leído de la URL.
    //
    // El guard de `router.dart` redirige a `/home?aviso=<área>` cuando alguien
    // sin permiso escribe `/pos` o `/admin` a mano. El aviso viaja en el QUERY y
    // no en un diálogo porque un `showDialog` desde un `redirect` es una transición
    // dentro de otra y se pierde en cuanto cambia la ruta.
    final String? deniedArea = state.uri.queryParameters['aviso'];

    // El contenido empieza por encima del `SafeArea` que aporta
    // `AdaptiveScaffold` (esta pantalla se monta con `showAppBar: false`, así que
    // el `Scaffold` no gasta el inset superior y el shell lo protege). Aquí solo
    // se deja el margen de diseño.
    final Widget main = ListView(
      padding: EdgeInsets.fromLTRB(
        padding,
        AppSpacing.lg,
        padding,
        AppSpacing.xxl,
      ),
      children: <Widget>[
        if (deniedArea != null) ...<Widget>[
          _AccessDeniedNotice(area: deniedArea),
          const SizedBox(height: AppSpacing.lg),
        ],
        HomeGreeting(
          greeting: ref.watch(greetingProvider),
          today: ref.watch(todayLabelProvider),
          name: ref.watch(currentUserProvider)?.displayName ?? '',
        ),
        const SizedBox(height: AppSpacing.xl),
        HomeBusinessCard(value: business, cached: cached),
        const SizedBox(height: AppSpacing.lg),
        AsyncStateBuilder<List<Rental>>(
          value: rentals,
          loadingMessage: 'Buscando tu silla…',
          onRetry: () async => ref.invalidate(myRentalsProvider),
          builder: (BuildContext context, List<Rental> data) =>
              HomeActiveChairCard(rental: active),
        ),
        const SizedBox(height: AppSpacing.xl),
        const SectionHeader(
          title: AppStrings.sectionFeatured,
          subtitle: 'Lo que más pedimos',
          padding: EdgeInsets.fromLTRB(0, 0, AppSpacing.sm, AppSpacing.sm),
        ),
        HomeFeaturedSection(catalog: catalog, categories: categories),
        const SizedBox(height: AppSpacing.lg),
        const SectionHeader(
          title: AppStrings.sectionCategories,
          padding: EdgeInsets.fromLTRB(0, 0, AppSpacing.sm, AppSpacing.sm),
        ),
        HomeCategoriesSection(categories: categories),
      ],
    );

    // El chrome (navegación) es de `CustomerShell`, que además oculta la AppBar
    // en la home porque aquí ya hay un saludo gigante: una barra con el nombre de
    // la app encima robaría alto en móvil. Esta pantalla solo devuelve contenido.
    return context.breakpoint.usesSidebar
        ? Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Expanded(flex: 3, child: main),
              VerticalDivider(
                width: 1,
                color: Theme.of(context).colorScheme.outlineVariant,
              ),
              SizedBox(width: 380, child: HomeSidePanel(active: active)),
            ],
          )
        : main;
  }
}

/// Aviso de acceso denegado a una zona de personal.
///
/// Se pinta arriba de todo, antes que el saludo, porque la persona acaba de
/// escribir una dirección y quiere saber por qué no le dejó entrar. Icono + texto:
/// nunca solo color (WCAG 1.4.1).
class _AccessDeniedNotice extends StatelessWidget {
  const _AccessDeniedNotice({required this.area});

  final String area;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      liveRegion: true,
      child: Container(
        padding: const EdgeInsets.all(AppSpacing.lg),
        decoration: BoxDecoration(
          color: context.tokens.surfaceWarningSubtle,
          borderRadius: BorderRadius.circular(AppRadii.md),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Icon(Icons.lock_outline_rounded,
                size: 20, color: context.tokens.textWarning),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    AppStrings.adminRestrictedTitle,
                    style: AppTextStyles.titleSmall
                        .copyWith(color: context.tokens.textWarning),
                  ),
                  const SizedBox(height: AppSpacing.xxs),
                  Text(
                    AppStrings.adminRestrictedBody,
                    style: AppTextStyles.bodySmall
                        .copyWith(color: context.tokens.textWarning),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
