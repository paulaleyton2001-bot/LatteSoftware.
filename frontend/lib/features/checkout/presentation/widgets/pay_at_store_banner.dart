// Banner de pago en el local. Módulo `features/checkout/presentation/widgets`.
//
// ESTE WIDGET ES EL RECUERDO DE UN REQUISITO DE PRODUCTO
// La cafetería NO tiene pasarela de pagos. El checkout no pide número de tarjeta,
// no redirige a ningún sitio y no llama a ningún proveedor: solo registra el pedido.
// El cobro ocurre en el mostrador, en efectivo o con tarjeta.
//
// Por eso el aviso aparece en TRES sitios y no en uno:
//   - el carrito (al final del resumen),
//   - el resumen del checkout (antes de confirmar),
//   - la barra inferior cuando hay silla.
// En cualquiera de los tres, quien lee tiene que entender que no hay un paso que
// se le esté olvidando.
//
// `liveRegion: true` porque aparece en el momento de cambiar de pantalla y es la
// información que evita el susto de ir a buscar una pantalla de pago que no existe.



import 'package:flutter/material.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../shared/constants/app_strings.dart';

/// Aviso de que el pago se hace en el local, en efectivo o con tarjeta.
class PayAtStoreBanner extends StatelessWidget {
  const PayAtStoreBanner({this.compact = false, super.key});

  /// `true` = versión de una línea, para la barra inferior.
  final bool compact;

  @override
  Widget build(BuildContext context) {
    if (compact) return const _CompactNotice();

    return Semantics(
      liveRegion: true,
      container: true,
      child: Container(
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
          color: context.tokens.surfaceGreenSubtle,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                Icon(
                  Icons.storefront_rounded,
                  size: 20,
                  color: context.tokens.textSuccess,
                ),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: Text(
                    'Pagas en el local',
                    style: AppTextStyles.titleSmall
                        .copyWith(color: context.tokens.textSuccess),
                  ),
                ),
              ],
            ),
            const SizedBox(height: AppSpacing.xs),
            Text(
              AppStrings.payAtStoreLong,
              style: AppTextStyles.bodySmall
                  .copyWith(color: context.tokens.textSuccess),
            ),
            const SizedBox(height: AppSpacing.sm),
            Row(
              children: <Widget>[
                Icon(
                  Icons.payments_rounded,
                  size: 16,
                  color: context.tokens.textSuccess,
                ),
                const SizedBox(width: AppSpacing.xs),
                Text(
                  'Efectivo o tarjeta',
                  style: AppTextStyles.captionMedium
                      .copyWith(color: context.tokens.textSuccess),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// Versión de una línea, para la barra inferior del checkout.
class _CompactNotice extends StatelessWidget {
  const _CompactNotice();

  @override
  Widget build(BuildContext context) {
    return Semantics(
      liveRegion: true,
      container: true,
      child: Container(
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
          color: context.tokens.surfaceGreenSubtle,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Row(
          children: <Widget>[
            Icon(
              Icons.storefront_rounded,
              size: 18,
              color: context.tokens.textSuccess,
            ),
            const SizedBox(width: AppSpacing.sm),
            Expanded(
              child: Text(
                AppStrings.payAtStore,
                style: AppTextStyles.captionMedium
                    .copyWith(color: context.tokens.textSuccess),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
