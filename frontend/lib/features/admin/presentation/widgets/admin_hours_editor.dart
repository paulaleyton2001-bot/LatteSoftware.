// Horarios de apertura y festivos. MÓDULO `features/admin/presentation/widgets`.
//
// SIETE FILAS FIJAS, UNA POR DÍA
// `PUT /business/hours` exige EXACTAMENTE 7 objetos, uno por `dayOfWeek` (0 =
// domingo), sin repetidos: con menos responde `400 INCOMPLETE_WEEK`. No hay "añadir
// día"; hay siete, y cada una se abre o se cierra. Por eso el editor se pinta SIEMPRE
// con los siete, rellenando los que falten.
//
// UNA DÍA QUE CIERRA DESPUÉS DE MEDIANOCHE ES VÁLIDA
// Si `closesAt <= opensAt`, el local cierra de madrugada y eso es legítimo
// (API.md §7.4). El editor lo avisa con una nota en lugar de impedirlo.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../shared/widgets/ui/app_button.dart';
import '../../../../shared/widgets/ui/app_card.dart';
import '../../../../shared/widgets/ui/async_state_builder.dart';
import '../../domain/entities/admin_business.dart';
import '../admin_settings_controller.dart';

/// Rellena la semana hasta tener SIETE días, en orden, sin repetir.
///
/// `GET /business/hours` promete siete filas (las crea el seed), pero un local
/// recién creado puede no tenerlas todas, y `PUT /business/hours` rechaza
/// cualquier conjunto que no sean exactamente siete. El día que falta entra ABIERTO
/// de 08:00 a 18:00, que es lo que el backend usa de relleno.
List<AdminBusinessHour> fillWeek(List<AdminBusinessHour> existing) {
  final Map<int, AdminBusinessHour> byDay = <int, AdminBusinessHour>{
    for (final AdminBusinessHour hour in existing) hour.dayOfWeek: hour,
  };
  return <AdminBusinessHour>[
    for (int day = 0; day < 7; day++)
      byDay[day] ??
          AdminBusinessHour(
            dayOfWeek: day,
            opensAt: '08:00',
            closesAt: '18:00',
            isClosed: day == 0,
          ),
  ];
}

/// Editor de la semana de apertura.
class AdminHoursEditor extends ConsumerStatefulWidget {
  const AdminHoursEditor({super.key});

  @override
  ConsumerState<AdminHoursEditor> createState() => _AdminHoursEditorState();
}

class _AdminHoursEditorState extends ConsumerState<AdminHoursEditor> {
  List<AdminBusinessHour> _draft = const <AdminBusinessHour>[];

  @override
  Widget build(BuildContext context) {
    final AsyncValue<List<AdminBusinessHour>> hours =
        ref.watch(adminBusinessHoursProvider);
    final AsyncValue<void> busy = ref.watch(adminSettingsProvider);

    return AsyncStateBuilder<List<AdminBusinessHour>>(
      value: hours,
      loadingMessage: 'Cargando los horarios…',
      onRetry: () async => ref.invalidate(adminBusinessHoursProvider),
      builder: (BuildContext context, List<AdminBusinessHour> data) {
        // El borrador se inicializa UNA vez, con los siete días garantizados.
        if (_draft.isEmpty) _draft = fillWeek(data);
        return AppCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Text('Horarios de apertura',
                  style: AppTextStyles.titleMedium),
              const SizedBox(height: AppSpacing.xs),
              Text(
                'Si la hora de cierre es anterior a la de apertura, el local cierra '
                'al día siguiente.',
                style: AppTextStyles.captionSmall
                    .copyWith(color: context.tokens.textTertiary),
              ),
              const SizedBox(height: AppSpacing.md),
              for (final AdminBusinessHour hour in _draft)
                _DayRow(
                  hour: hour,
                  enabled: !busy.isLoading,
                  onChanged: (AdminBusinessHour next) => setState(() {
                    _draft = <AdminBusinessHour>[
                      for (final AdminBusinessHour item in _draft)
                        if (item.dayOfWeek == next.dayOfWeek) next else item,
                    ];
                  }),
                ),
              const SizedBox(height: AppSpacing.md),
              AppButton(
                label: 'Guardar horarios',
                icon: Icons.save_outlined,
                variant: AppButtonVariant.primary,
                isFullWidth: true,
                isLoading: busy.isLoading,
                onPressed: busy.isLoading
                    ? null
                    : () => ref
                        .read(adminSettingsProvider.notifier)
                        .saveHours(_draft),
              ),
            ],
          ),
        );
      },
    );
  }
}

/// Fila de un día: switch de cerrado, apertura y cierre.
class _DayRow extends StatelessWidget {
  const _DayRow({
    required this.hour,
    required this.enabled,
    required this.onChanged,
  });

  final AdminBusinessHour hour;
  final bool enabled;
  final ValueChanged<AdminBusinessHour> onChanged;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.md),
      child: Row(
        children: <Widget>[
          SizedBox(
            width: 92,
            child: Text(hour.dayLabel, style: AppTextStyles.titleSmall),
          ),
          Switch.adaptive(
            value: !hour.isClosed,
            onChanged: enabled
                ? (bool open) => onChanged(AdminBusinessHour(
                      dayOfWeek: hour.dayOfWeek,
                      opensAt: hour.opensAt,
                      closesAt: hour.closesAt,
                      isClosed: !open,
                    ))
                : null,
          ),
          Expanded(
            child: Opacity(
              opacity: hour.isClosed ? 0.4 : 1,
              child: Row(
                children: <Widget>[
                  Expanded(
                    child: _TimeField(
                      label: 'Abre',
                      value: hour.opensAt,
                      enabled: enabled && !hour.isClosed,
                      onChanged: (String value) => onChanged(
                        AdminBusinessHour(
                          dayOfWeek: hour.dayOfWeek,
                          opensAt: value,
                          closesAt: hour.closesAt,
                          isClosed: hour.isClosed,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: AppSpacing.sm),
                  Expanded(
                    child: _TimeField(
                      label: 'Cierra',
                      value: hour.closesAt,
                      enabled: enabled && !hour.isClosed,
                      onChanged: (String value) => onChanged(
                        AdminBusinessHour(
                          dayOfWeek: hour.dayOfWeek,
                          opensAt: hour.opensAt,
                          closesAt: value,
                          isClosed: hour.isClosed,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Campo de hora `HH:MM`. Se valida el formato ANTES de enviar: el backend
/// responde `400 INVALID_TIME_FORMAT` y es mejor no llegar ahí.
class _TimeField extends StatefulWidget {
  const _TimeField({
    required this.label,
    required this.value,
    required this.enabled,
    required this.onChanged,
  });

  final String label;
  final String value;
  final bool enabled;
  final ValueChanged<String> onChanged;

  @override
  State<_TimeField> createState() => _TimeFieldState();
}

class _TimeFieldState extends State<_TimeField> {
  late final TextEditingController _controller;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: widget.value);
  }

  @override
  void didUpdateWidget(_TimeField oldWidget) {
    super.didUpdateWidget(oldWidget);
    // Si el valor cambia desde fuera (otra fila, un reset), el controller se
    // resincroniza; si no, seguiría mostrando el texto viejo.
    if (widget.value != _controller.text) {
      _controller.text = widget.value;
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: _controller,
      enabled: widget.enabled,
      decoration: InputDecoration(
        labelText: widget.label,
        isDense: true,
        contentPadding:
            const EdgeInsets.symmetric(horizontal: AppSpacing.sm, vertical: 12),
      ),
      onChanged: (String value) {
        if (_isValidHhMm(value)) widget.onChanged(value);
      },
    );
  }

  /// `HH:MM` con dos dígitos en cada parte.
  static bool _isValidHhMm(String value) {
    final RegExp pattern = RegExp(r'^([01]\d|2[0-3]):[0-5]\d$');
    return pattern.hasMatch(value);
  }
}
