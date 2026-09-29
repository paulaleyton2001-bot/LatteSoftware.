// Control para extender el alquiler de silla.
//
// POR QUÉ ESTÁ EN SU PROPIO ARCHIVO
// Es un `ConsumerStatefulWidget` con un `ChoiceChip` por opción, un `AppButton`, un
// `FormErrorBanner` y un `ConfirmDialog`. Metido dentro del panel de la silla
// convertía un archivo de 330 líneas en el que la mitad era la lógica de extender y
// la otra mitad era pintar cuatro tarjetas.
//
// EL PERMISO SE COMPRUEBA ANTES DE PINTAR EL BOTÓN
// `POST /rentals/:id/extend` exige `rentals:extend`, que un `CUSTOMER` NO tiene
// (DESIGN.md §9.3 lo marca denegado). Ofrecer el botón y recibir un `403` es peor
// que no ofrecerlo: la app pasa a hacer algo que no puede hacer.
//
// EL SALDO SE SUMA EN EL SERVIDOR
// La extensión no se cobra aquí (no hay pasarela): se suma a
// `orders.balance_minor` del pedido abierto y se paga en el mostrador, al precio
// CONGELADO de la silla (BR-RENTAL-003).



import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../core/error/failures.dart';
import '../../../../core/utils/date_formatter.dart';
import '../../../../shared/widgets/ui/app_button.dart';
import '../../../../shared/widgets/ui/confirm_dialog.dart';
import '../../../../shared/widgets/ui/form_error_banner.dart';
import '../../domain/entities/rental.dart';
import '../orders_controller.dart';

/// Extensiones ofrecidas. El backend admite de 5 a 1440 minutos (API.md §7.9);
/// estos son los tres valores que la gente pide de verdad.
const List<int> kExtendOptions = <int>[30, 60, 120];

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
                  onSelected: busy
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
          label:
              'Extender ${DateFormatter.durationLong(Duration(minutes: _minutes))}',
          icon: Icons.more_time_rounded,
          variant: AppButtonVariant.secondary,
          isFullWidth: true,
          isLoading: busy,
          onPressed: busy ? null : () => _confirm(context),
          semanticLabel: 'Extender el alquiler de mi silla',
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
