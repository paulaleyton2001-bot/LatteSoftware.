// Festivos del negocio. MÓDULO `features/admin/presentation/widgets`.
//
// Separado del editor de horarios porque los dos ToQUEAN el mismo permiso
// (`business:holidays:manage` vs `business:hours:update`) y por su relación
// uno a uno: un festivo es un renglón, un horario son siete.
//
// `holidayDate` es `YYYY-MM-DD` EN LA ZONA DEL NEGOCIO, no una fecha ISO con
// hora: el backend la interpreta en hora local del negocio (API.md §1).

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../shared/widgets/ui/app_button.dart';
import '../../../../shared/widgets/ui/app_card.dart';
import '../../../../shared/widgets/ui/app_text_field.dart';
import '../../../../shared/widgets/ui/async_state_builder.dart';
import '../../domain/entities/admin_business.dart';
import '../admin_settings_controller.dart';

/// Festivos configurados.
class AdminHolidaysSection extends ConsumerWidget {
  const AdminHolidaysSection({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<List<AdminHoliday>> holidays =
        ref.watch(adminHolidaysProvider);
    final AsyncValue<void> busy = ref.watch(adminSettingsProvider);

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text('Festivos', style: AppTextStyles.titleMedium),
                    Text(
                      'Días en los que el local cambia su horario o cierra.',
                      style: AppTextStyles.captionSmall
                          .copyWith(color: context.tokens.textTertiary),
                    ),
                  ],
                ),
              ),
              AppButton(
                label: 'Añadir',
                icon: Icons.add_rounded,
                variant: AppButtonVariant.secondary,
                size: AppButtonSize.small,
                isLoading: busy.isLoading,
                onPressed: busy.isLoading
                    ? null
                    : () => _add(context, ref),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          AsyncStateBuilder<List<AdminHoliday>>(
            value: holidays,
            loadingMessage: 'Cargando los festivos…',
            onRetry: () async => ref.invalidate(adminHolidaysProvider),
            isEmpty: (List<AdminHoliday> data) => data.isEmpty,
            emptyIcon: Icons.event_outlined,
            emptyTitle: 'Sin festivos',
            emptyMessage: 'Añade los días en los que el local cierra o cambia su '
                'horario.',
            compactEmpty: true,
            builder: (BuildContext context, List<AdminHoliday> data) => Column(
              children: <Widget>[
                for (final AdminHoliday holiday in data)
                  Padding(
                    padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                    child: Row(
                      children: <Widget>[
                        Icon(Icons.event_outlined,
                            size: 18, color: context.tokens.textSecondary),
                        const SizedBox(width: AppSpacing.md),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: <Widget>[
                              Text(holiday.name,
                                  style: AppTextStyles.bodyMedium),
                              Text(
                                holiday.isClosed ? 'Cierra' : 'Horario especial',
                                style: AppTextStyles.captionSmall.copyWith(
                                  color: context.tokens.textTertiary,
                                ),
                              ),
                            ],
                          ),
                        ),
                        Text(holiday.holidayDate,
                            style: AppTextStyles.labelMedium),
                        const SizedBox(width: AppSpacing.sm),
                        TextButton(
                          onPressed: busy.isLoading
                              ? null
                              : () => ref
                                  .read(adminSettingsProvider.notifier)
                                  .removeHoliday(holiday.id),
                          child: const Text('Quitar'),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// Alta de festivo. `holidayDate` es `YYYY-MM-DD` en la zona del negocio.
  Future<void> _add(BuildContext context, WidgetRef ref) async {
    final TextEditingController date = TextEditingController();
    final TextEditingController name = TextEditingController();
    final DateTime now = DateTime.now();

    final bool? ok = await showDialog<bool>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: const Text('Añadir festivo'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            AppTextField(
              controller: date,
              label: 'Fecha (AAAA-MM-DD)',
              hint: '${now.year}-${_two(now.month)}-${_two(now.day)}',
              maxLength: 10,
              autofocus: true,
            ),
            const SizedBox(height: AppSpacing.md),
            AppTextField(
              controller: name,
              label: 'Nombre',
              maxLength: 150,
              hint: 'Día de la Independencia',
            ),
          ],
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Añadir'),
          ),
        ],
      ),
    );
    final String dateValue = date.text.trim();
    final String nameValue = name.text.trim();
    date.dispose();
    name.dispose();
    if (ok != true || dateValue.length != 10 || nameValue.isEmpty) return;

    await ref.read(adminSettingsProvider.notifier).addHoliday(
          holidayDate: dateValue,
          name: nameValue,
        );
  }

  static String _two(int value) => value.toString().padLeft(2, '0');
}


