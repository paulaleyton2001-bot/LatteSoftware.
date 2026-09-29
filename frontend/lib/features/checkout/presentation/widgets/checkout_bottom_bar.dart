// Barra inferior del checkout: aviso de pago, error de confirmación y CTA.
//
// POR QUÉ ESTÁ SEPARADA
// La barra es la parte del checkout con más lógica de estado (qué botón hay, qué
// mensaje va encima, qué acción ofrece el error) y mantenerla en el archivo de la
// página lo que hace es dos veces más largo sin ganar nada.
//
// EL 409 DE SILLA OCUPADA NO ES "REINTENTAR"
// Cuando la silla se ocupa entre que la elegiste y que confirmaste, el botón del
// banner NO es "reintentar": es "volver al mapa", porque reintentar con la misma
// silla va a fallar otra vez. `CheckoutErrorCodes.isChairConflict` decide entre
// las dos acciones, y la acción de reintentar solo aparece si el fallo además es
// reintentable (red, 5xx).
//
// AL CONFIRMAR SE VACÍA EL CARRITO
// El pedido ya está en el servidor. Dejarlo en el carrito haría que la siguiente
// pulsación de "Registrar pedido" creara un pedido DUPLICADO, que es exactamente
// el daño que un carrito persistente puede causar sin esta línea.


import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../../app/breakpoints.dart';
import '../../../../app/routes.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../core/customer/cart_providers.dart';
import '../../../../core/customer/cart_state.dart';
import '../../../../core/error/failures.dart';
import '../../../../shared/widgets/ui/app_button.dart';
import '../../../../shared/widgets/ui/form_error_banner.dart';
import '../checkout_controller.dart';
import '../checkout_state.dart';
import './pay_at_store_banner.dart';

/// Barra inferior con el CTA.
class CheckoutBottomBar extends ConsumerWidget {
  const CheckoutBottomBar({required this.cart, required this.state, super.key});

  final CartState cart;
  final CheckoutState state;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final CheckoutController controller = ref.read(checkoutProvider.notifier);
    final Failure? failure = state.placeFailure;
    final bool chairConflict = failure != null && _isChairConflict(failure);

    return Container(
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        border: Border(
          top: BorderSide(color: Theme.of(context).colorScheme.outlineVariant),
        ),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: EdgeInsets.fromLTRB(
            context.breakpoint.screenPadding,
            AppSpacing.md,
            context.breakpoint.screenPadding,
            AppSpacing.md,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              if (failure != null) ...<Widget>[
                FormErrorBanner(
                  failure: failure,
                  compact: true,
                  title: chairConflict ? 'Esa silla se ha ocupado' : null,
                  // En un conflicto de silla la acción no es reintentar a
                  // ciegas: es volver al mapa con datos frescos.
                  onRetry: chairConflict
                      ? () => controller.goToStep(CheckoutStep.chair)
                      : (failure.isRetryable ? () => _confirm(context, ref) : null),
                ),
                const SizedBox(height: AppSpacing.md),
              ],
              if (state.chairId != null) ...<Widget>[
                const PayAtStoreBanner(),
                const SizedBox(height: AppSpacing.md),
              ],
              AppButton(
                label: _label,
                icon: Icons.check_circle_outline_rounded,
                variant: AppButtonVariant.espresso,
                size: AppButtonSize.large,
                isFullWidth: true,
                isLoading: state.isPlacing,
                onPressed: state.canConfirm ? () => _confirm(context, ref) : null,
                semanticLabel: state.step == CheckoutStep.review
                    ? 'Registrar mi pedido y pagar en el local'
                    : 'Continuar al resumen',
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// El rótulo DICE QUÉ VA A PASAR, no solo "Continuar".
  String get _label {
    if (state.step == CheckoutStep.review) return 'Registrar pedido';
    if (state.needsChair && state.chairId == null) return 'Elige una silla';
    return 'Ver resumen';
  }

  Future<void> _confirm(BuildContext context, WidgetRef ref) async {
    if (state.step != CheckoutStep.review) {
      // Todavía no se está en el resumen: el botón avanza, no registra.
      ref.read(checkoutProvider.notifier).goToReview();
      return;
    }
    final CartState current = ref.read(cartStoreProvider).state;
    final bool ok = await ref.read(checkoutProvider.notifier).confirm(current);
    if (!ok || !context.mounted) return;
    // El pedido ya está en el servidor: se vacía para que no se repita.
    ref.read(cartStoreProvider).clear();
    // `pushReplacement` de go_router 14 devuelve `void`, no un `Future`: el `await`
    // sobra y el analizador lo marca como usar un resultado de tipo `void`.
    context.pushReplacement(AppRoutes.checkoutDone);
  }

  /// Códigos de `error.details.code` con los que el checkout ofrece cambiar de
  /// silla (`API.md` §8.2).
  static bool _isChairConflict(Failure failure) {
    final String? code = failure.code;
    return code == 'CHAIR_OCCUPIED' ||
        code == 'CHAIR_ALREADY_RESERVED' ||
        code == 'CHAIR_NOT_BOOKABLE';
  }
}
