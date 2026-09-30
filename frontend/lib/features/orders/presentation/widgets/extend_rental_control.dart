// Control para extender el alquiler de silla.
// Módulo `features/orders/presentation/widgets`.
//
// POR QUÉ ESTÁ EN SU PROPIO ARCHIVO
// Es un `ConsumerStatefulWidget` con un `ChoiceChip` por opción, un `AppButton`, un
// `FormErrorBanner` y un `ConfirmDialog`. Metido dentro del panel de la silla
// convertía un archivo de 330 líneas en el que la mitad era la lógica de extender y
// la otra mitad era pintar cuatro tarjetas.
//
// ─────────────────────────────────────────────────────────────────────────────
// EL PERMISO NO SE COMPRUEBA PARA OCULTAR EL BOTÓN: SE COMPRUEBA PARA APAGARLO
//
// `POST /rentals/:id/extend` exige `rentals:extend`, que un `CUSTOMER` NO tiene
// (`backend/src/shared/domain/permissions.ts`, marca `-` en la fila de `rentals`).
// Comprobado con peticiones reales el 2026-09-29:
//
//   CUSTOMER → POST /rentals/5/extend
//   HTTP/1.1 403 Forbidden
//   {"code":"AUTHORIZATION_ERROR",
//    "details":{"code":"INSUFFICIENT_PERMISSIONS","required":"rentals:extend",
//               "roles":["CUSTOMER"]}}
//
// Este archivo antes lo Ocultaba (`order_blocks.dart` hacía
// `if (canExtend) ... else <OrderNote>`). Eso deja a quien está pagando por una
// silla con una tarjeta sin ningún botón, sin ninguna pista de si la app está rota
// o de si simplemente no puede. AHORA el botón se pinta DESHABILITADO y el motivo va
// escrito DEBAJO, a la vista. Es la misma decisión que aplica
// `features/chair/presentation/widgets/active_rental_card.dart`, y a propósito
// lleva el MISMO texto: la respuesta a «¿por qué no puedo ampliar?» no puede
// depender de la pantalla desde la que se pregunta.
//
// EL SALDO SE SUMA EN EL SERVIDOR
// La extensión no se cobra aquí (no hay pasarela): se suma a
// `orders.balance_minor` del pedido abierto y se paga en el mostrador, al precio
// CONGELADO de la silla (BR-RENTAL-003).

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../core/error/failures.dart';
import '../../../../core/utils/date_formatter.dart';
import '../../../../domain/entities/user.dart';
import '../../../../shared/widgets/ui/app_button.dart';
import '../../../../shared/widgets/ui/confirm_dialog.dart';
import '../../../../shared/widgets/ui/form_error_banner.dart';
import '../../../auth/presentation/auth_controller.dart';
import '../../domain/entities/rental.dart';
import '../orders_controller.dart';

/// Extensiones ofrecidas. El backend admite de 5 a 1440 minutos (API.md §7.9);
/// estos son los tres valores que la gente pide de verdad.
const List<int> kExtendOptions = <int>[30, 60, 120];

/// Texto del motivo por el que no se puede ampliar.
///
/// Se declara UNA vez y se comparte con `active_rental_card.dart` por el motivo
/// expuesto en la cabecera: la misma duda, la misma respuesta.
const String kExtendDeniedMessage =
    'Extender un alquiler lo hace el personal («rentals:extend»). Diles que '
    'quieres alargar tu silla y os lo amplían al precio de tu silla.';

/// Selector de minutos extra + botón de confirmación.
class ExtendRentalControl extends ConsumerStatefulWidget {
  const ExtendRentalControl({
    required this.rental,
    required this.state,
    super.key,
  });

  final Rental rental;

  /// Estado de la extensión en curso (`loading` mientras va al servidor).
  final AsyncValue<Duration?> state;

  @override
  ConsumerState<ExtendRentalControl> createState() => _ExtendRentalControlState();
}

class _ExtendRentalControlState extends ConsumerState<ExtendRentalControl> {
  int _minutes = kExtendOptions.first;

  @override
  Widget build(BuildContext context) {
    final bool busy = widget.state.isLoading;
    final Object? error = widget.state.error;

    // Dos condiciones, y las dos hacen falta:
    //   · el PERMISO, que decide si la acción existe para esta cuenta;
    //   · el ESTADO DEL ALQUILER, que decide si la acción tiene sentido ahora
    //     (`canExtend` es `isLive && endAt != null`: un alquiler ya cerrado no se
    //     amplía aunque el permiso exista).
    // Se leen del token (`User.permissions`), no del rol: la matriz de RBAC vive en
    // el backend.
    final User? user = ref.watch(currentUserProvider);
    final bool hasPermission = user?.hasPermission('rentals:extend') ?? false;
    final bool enabled = hasPermission && widget.rental.canExtend;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Text('¿Cuánto más quieres?', style: AppTextStyles.titleSmall),
        const SizedBox(height: AppSpacing.sm),
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(
            children: <Widget>[
              for (final int option in kExtendOptions) ...<Widget>[
                ChoiceChip(
                  label: Text(
                    DateFormatter.durationLong(Duration(minutes: option)),
                  ),
                  selected: _minutes == option,
                  onSelected: busy || !enabled
                      ? null
                      : (bool selected) => setState(() => _minutes = option),
                ),
                const SizedBox(width: AppSpacing.sm),
              ],
            ],
          ),
        ),
        const SizedBox(height: AppSpacing.sm),
        AppButton(
          label: enabled
              ? 'Extender ${DateFormatter.durationLong(Duration(minutes: _minutes))}'
              : 'Extender tiempo',
          icon: Icons.more_time_rounded,
          variant: AppButtonVariant.secondary,
          isFullWidth: true,
          isLoading: busy,
          // Apagado, no ausente: el motivo va justo debajo.
          onPressed: enabled && !busy ? () => _confirm(context) : null,
          semanticLabel: enabled
              ? 'Extender el alquiler de mi silla'
              : 'Extender el alquiler de mi silla. No disponible: '
                  '$kExtendDeniedMessage',
        ),
        if (!enabled)
          Padding(
            padding: const EdgeInsets.only(top: AppSpacing.xs),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Icon(
                  Icons.lock_outline_rounded,
                  size: 14,
                  color: context.tokens.textTertiary,
                ),
                const SizedBox(width: AppSpacing.xs),
                Expanded(
                  child: Text(
                    // Si el permiso está pero el alquiler no admite cambios, el
                    // motivo es otro y distinto: no es un problema de cuenta.
                    hasPermission
                        ? 'Este alquiler ya no admite cambios.'
                        : kExtendDeniedMessage,
                    style: AppTextStyles.captionSmall.copyWith(
                      color: context.tokens.textTertiary,
                    ),
                  ),
                ),
              ],
            ),
          ),
        if (error != null) ...<Widget>[
          const SizedBox(height: AppSpacing.sm),
          FormErrorBanner(
            // Los providers de esta feature solo publican `Failure`, pero el
            // `AsyncValue` es genérico: si el tipo cambiara, el banner muestra el
            // texto del error en vez de romperse.
            failure: error is Failure ? error : UnknownFailure(details: '$error'),
            compact: true,
          ),
        ],
      ],
    );
  }

  Future<void> _confirm(BuildContext context) async {
    final DialogAction action = await ConfirmDialog.show(
      context,
      title: '¿Extender $_minutes minutos más?',
      message: 'Se suman a tu cuenta del local, al precio de tu silla. Aquí no se '
          'hace ningún cargo.',
      action: DialogAction.confirm,
      confirmLabel: 'Extender',
      icon: Icons.more_time_rounded,
    );
    if (action != DialogAction.confirm) return;
    await ref
        .read(extendRentalProvider(widget.rental).notifier)
        .extend(widget.rental.id, _minutes);
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('Silla ampliada $_minutes minutos.')),
    );
  }
}
