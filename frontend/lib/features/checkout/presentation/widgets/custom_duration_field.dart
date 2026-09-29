// Campo de duración personalizada, en su propio widget porque necesita un
// `TextEditingController`.
//
// POR QUÉ NO VA EN EL `AppTextField` DE INMEDIATO
// El valor del campo es la duración en curso, y la duración en curso vive en el
// `checkoutProvider`. Si el campo tuviera su propio estado, el botón de confirmar
// usaría un número y el usuario vería otro. Este widget mantiene el controller
// sincronizado con el provider en las DOS direcciones: escribe al(provider) en
// cada cambio y se realinea cuando el provider cambia desde fuera (por ejemplo,
// al volver de un chip fijo a "otro tiempo").
//
// RECORTE, NO ERROR
// Se recorta a [kMinRentalMinutes]..[kMaxRentalMinutes] en lugar de mostrar un
// error: el rango máximo real lo impone `businesses.maxReservationMinutes` y el
// servidor responde `422 RESERVATION_TOO_LONG`. Un campo que se autolimita es más
// rápido de usar que un formulario que rechaza.



import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../shared/widgets/ui/app_text_field.dart';
import '../../domain/entities/checkout_options.dart';
import '../checkout_controller.dart';

/// Campo de minutos para la duración personalizada.
class CustomDurationField extends ConsumerStatefulWidget {
  const CustomDurationField({super.key});

  @override
  ConsumerState<CustomDurationField> createState() => _CustomDurationFieldState();
}

class _CustomDurationFieldState extends ConsumerState<CustomDurationField> {
  final TextEditingController _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _write(String value) {
    final int parsed = int.tryParse(value) ?? 0;
    ref.read(checkoutProvider.notifier).setCustomMinutes(parsed);
  }

  @override
  Widget build(BuildContext context) {
    final int minutes = ref.watch(checkoutProvider).customMinutes;
    // Se realinea SOLO cuando el valor del provider no es el que muestra el
    // campo; si no, se pelearían entre sí en cada pulsación.
    if (int.tryParse(_controller.text) != minutes) {
      _controller.text = '$minutes';
    }

    return Padding(
      padding: const EdgeInsets.only(top: AppSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text('Otro tiempo', style: AppTextStyles.titleSmall),
          const SizedBox(height: AppSpacing.sm),
          AppTextField(
            controller: _controller,
            hint: '$minutes min',
            helperText: 'Entre ${kMinRentalMinutes} y ${kMaxRentalMinutes} '
                'minutos. El máximo real lo marca el local.',
            prefixIcon: Icons.timer_outlined,
            textInputType: TextInputType.number,
            textInputAction: TextInputAction.done,
            keyboardAppearance: Brightness.light,
            onChanged: _write,
            onSubmitted: _write,
            suffix: Text(
              'min',
              style: AppTextStyles.labelLarge
                  .copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant),
            ),
            semanticLabel: 'Duración personalizada en minutos',
          ),
        ],
      ),
    );
  }
}
