// Bloques de la pantalla de inicio. Módulo `features/home/presentation/widgets`.
//
// Se separan del `home_page.dart` para que la página sea solo la ESTRUCTURA
// (saludo + bloques + rejilla) y cada bloque tenga su archivo, su doc y su
// estado.
//
// COMPARTEN EL CATÁLOGO DEL MENÚ
// `_FeaturedSection` y `_CategoriesSection` leen `menuProductsProvider` y
// `menuCategoriesProvider`, los MISMOS providers que la pantalla del menú. No hay
// una segunda descarga: si el menú ya se cargó, la home lo pinta al instante, y si
// la home se abrió primero, el menú reutiliza el resultado. Dos catálogos en
// memoria serían la fuente de "la home muestra un precio y el menú otro".
//
// LA CACHÉ DEL LOCAL SE PINTA DE INMEDIATO
// El nombre y el horario del local son los mismos de ayer; esperar un round-trip
// para ellos retrasa la pantalla sin ganar información. `cachedBusinessStatusProvider`
// da esa copia y, si la lectura de red falla, se avisa de que es información
// guardada en vez de fingir que es de ahora.



import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../shared/constants/app_strings.dart';
import '../../../../shared/constants/greeting.dart';
import '../../../../shared/widgets/ui/app_card.dart';
import '../../../../shared/widgets/ui/shimmer.dart';
import '../../domain/entities/business_status.dart';

/// Saludo con el nombre del cliente, el momento del día y la fecha.
///
/// El texto lo compone `shared/constants/greeting.dart` —el MISMO módulo que
/// usa la pantalla de Menú— para que las dos cabeceras no puedan discrepar.
class HomeGreeting extends StatelessWidget {
  const HomeGreeting({
    required this.greeting,
    required this.today,
    required this.name,
    super.key,
  });

  final String greeting;
  final String today;
  final String name;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      header: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            greetingWithName(greeting: greeting, name: name),
            style: AppTextStyles.displaySmall,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            today,
            style: AppTextStyles.bodyMedium
                .copyWith(color: context.tokens.textSecondary),
          ),
        ],
      ),
    );
  }
}

/// Tarjeta del estado del local: nombre, abierto/cerrado, horario y aviso de pago.
///
/// `OfflineState` NO se usa aquí a propósito: el nombre y el horario no son un
/// fallo, son información que ya tenemos de la caché. Un "estás sin conexión" a
/// pantalla completa en la home taparía el saludo y el producto, que es justo lo
/// que la persona viene a ver.
class HomeBusinessCard extends StatelessWidget {
  const HomeBusinessCard({required this.value, required this.cached, super.key});

  final AsyncValue<BusinessStatus> value;
  final BusinessStatus? cached;

  @override
  Widget build(BuildContext context) {
    final BusinessStatus? status = value.valueOrNull ?? cached;
    if (status == null) {
      return const ShimmerBox(height: 96, borderRadius: 16);
    }
    final bool open = status.isOpenNow();
    final bool stale = value.hasError;

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  status.name,
                  style: AppTextStyles.titleLarge,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              HomeOpenBadge(isOpen: open),
            ],
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            status.headline(),
            style: AppTextStyles.bodyMedium
                .copyWith(color: context.tokens.textSecondary),
          ),
          if (status.address != null) ...<Widget>[
            const SizedBox(height: AppSpacing.xxs),
            Text(
              status.address!,
              style: AppTextStyles.captionMedium
                  .copyWith(color: context.tokens.textTertiary),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ],
          if (stale) ...<Widget>[
            const SizedBox(height: AppSpacing.xs),
            Text(
              'Información guardada; el horario puede haber cambiado.',
              style: AppTextStyles.captionSmall
                  .copyWith(color: context.tokens.textWarning),
            ),
          ],
          const SizedBox(height: AppSpacing.md),
          // Sin pasarela: el pago se hace en el local. Es la primera vez que la
          // persona lo ve en la home, así que está visible desde el principio.
          Row(
            children: <Widget>[
              Icon(
                Icons.payments_rounded,
                size: 16,
                color: context.tokens.textSuccess,
              ),
              const SizedBox(width: AppSpacing.xs),
              Expanded(
                child: Text(
                  AppStrings.payAtStore,
                  style: AppTextStyles.captionMedium
                      .copyWith(color: context.tokens.textSuccess),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Badge de abierto/cerrado: ícono + texto + color, nunca solo color.
class HomeOpenBadge extends StatelessWidget {
  const HomeOpenBadge({required this.isOpen, super.key});

  final bool isOpen;

  @override
  Widget build(BuildContext context) {
    final Color background =
        isOpen ? context.tokens.surfaceSuccessSubtle : context.tokens.surfaceWarningSubtle;
    final Color foreground =
        isOpen ? context.tokens.textSuccess : context.tokens.textWarning;
    return Semantics(
      label: isOpen ? 'El local está abierto' : 'El local está cerrado',
      excludeSemantics: true,
      child: Container(
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.md,
          vertical: AppSpacing.xs,
        ),
        decoration: BoxDecoration(
          color: background,
          borderRadius: BorderRadius.circular(999),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Icon(
              isOpen ? Icons.storefront_rounded : Icons.nightlight_round,
              size: 14,
              color: foreground,
            ),
            const SizedBox(width: AppSpacing.xs),
            Text(
              isOpen ? 'Abierto' : 'Cerrado',
              style: AppTextStyles.labelMedium.copyWith(color: foreground),
            ),
          ],
        ),
      ),
    );
  }
}
