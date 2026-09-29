// Selector de rango personalizado. MÓDULO `features/admin/presentation/widgets`.
//
// POR QUÉ HAY QUE ELEGIR DÍA Y NO UNA HORA
// `preset: custom` manda `from`/`to` en ISO-8601 y el backend los compara contra
// ventas que registró en la zona horaria del NEGOCIO. Si el negocio está en
// America/Bogota y el navegador en Europe/Madrid, un `DateTime.now()` al final
// del día local apunta a un instante distinto del que el servidor espera, y el
// informe sale cortado por un lado. Elegir DÍAS y convertirlos a un rango
// [día 00:00, día+1 00:00) local evita que el criterio dependa de dónde esté el
// navegador.
//
// LA ZONA HORARIA LA PONE EL BACKEND
// `timezone` es opcional y no se manda: el backend la resuelve con la del
// negocio (`resolveRange`). Mandar la del navegador sería mentirle al servidor
// sobre dónde está la tienda.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/theme/app_radii.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../admin_reports_controller.dart';

/// Fila de fechas visibles solo con `preset: custom`.
///
/// Es un ConsumerWidget porque lee y escribe `adminReportRangeProvider`; el
/// diálogo de fechas es nativo (`showDateRangePicker`) y devuelve un
/// `DateTimeRange`, que se convierte a nuestro `DateRange` alineado a días.
class AdminCustomRangeBar extends ConsumerWidget {
  const AdminCustomRangeBar({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final DateRange range = ref.watch(adminReportRangeProvider);

    return Padding(
      padding: const EdgeInsets.only(top: AppSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Wrap(
            spacing: AppSpacing.sm,
            runSpacing: AppSpacing.sm,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: <Widget>[
              _DateChip(
                icon: Icons.play_arrow_rounded,
                label: 'Desde ${_label(range.from)}',
                onTap: () => _pick(context, ref, range),
              ),
              _DateChip(
                icon: Icons.stop_rounded,
                label: 'Hasta ${_label(range.to.subtract(const Duration(days: 1)))}',
                onTap: () => _pick(context, ref, range),
              ),
              if (range.isTooLarge)
                const _RangeWarning(
                  'El rango supera los 366 días que acepta el servidor. Acórtalo '
                  'o elige un preset.',
                ),
            ],
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            'Las ventas se cuentan por día natural, en la zona horaria del '
            'negocio. «Hasta» es el último día incluido.',
            style: AppTextStyles.captionSmall
                .copyWith(color: context.tokens.textTertiary),
          ),
        ],
      ),
    );
  }

  /// `dd/MM/yyyy`, sin `intl`: el informe se lee en un solo idioma y una
  /// dependencia por un formato no compensa.
  static String _label(DateTime date) {
    final String day = date.day.toString().padLeft(2, '0');
    final String month = date.month.toString().padLeft(2, '0');
    return '$day/$month/${date.year}';
  }

  Future<void> _pick(BuildContext context, WidgetRef ref, DateRange current) async {
    final DateTimeRange? picked = await showDateRangePicker(
      context: context,
      // `showDateRangePicker` trabaja en hora local; se le pasan fechas ya
      // truncadas al día para que no se cuele la hora del rango actual.
      firstDate: DateTime(current.from.year, current.from.month, current.from.day),
      lastDate: DateTime.now().add(const Duration(days: 1)),
      initialDateRange: DateTimeRange(
        // `to` es EXCLUSIVO (día siguiente), el picker espera el último día
        // INCLUIDO. Sin este -1 el calendario salía desplazado un día.
        start: current.from,
        end: current.to.subtract(const Duration(days: 1)),
      ),
      helpText: 'Rango del informe',
      saveText: 'Aplicar',
      cancelText: 'Cancelar',
      // `fieldStartLabelText` en vez de un `locale`: el calendario tiene que poder
      // escribir «Desde» y «Hasta» en el idioma de la app sin arrastrar `intl`.
      fieldStartLabelText: 'Desde',
      fieldEndLabelText: 'Hasta',
    );
    if (picked == null || !context.mounted) return;

    final DateTime start = DateTime(picked.start.year, picked.start.month, picked.start.day);
    final DateTime end = DateTime(picked.end.year, picked.end.month, picked.end.day);
    if (!end.isAfter(start)) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('El fin tiene que ser posterior al inicio.'),
          behavior: SnackBarBehavior.floating,
        ),
      );
      return;
    }
    // `to` exclusivo: el día elegido entra entero en el informe.
    ref.read(adminReportRangeProvider.notifier).state = DateRange(
          from: start,
          to: end.add(const Duration(days: 1)),
        );
  }
}

/// Chip de fecha. 44 dp de alto y con `Semantics(button: true)`.
class _DateChip extends StatelessWidget {
  const _DateChip({required this.icon, required this.label, required this.onTap});

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: 'Elegir fechas: $label',
      excludeSemantics: true,
      child: Material(
        color: context.tokens.surfaceMuted,
        borderRadius: BorderRadius.circular(AppRadii.pill),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(AppRadii.pill),
          child: Container(
            constraints: const BoxConstraints(minHeight: 44),
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Icon(icon, size: 18, color: context.tokens.brandDark),
                const SizedBox(width: AppSpacing.xs),
                Text(label, style: AppTextStyles.labelLarge),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Aviso de rango no válido. Texto + ícono, no solo color (WCAG 1.4.1).
class _RangeWarning extends StatelessWidget {
  const _RangeWarning(this.message);

  final String message;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      liveRegion: true,
      child: Container(
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.md,
          vertical: AppSpacing.sm,
        ),
        decoration: BoxDecoration(
          color: context.tokens.surfaceErrorSubtle,
          borderRadius: BorderRadius.circular(AppRadii.md),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Icon(Icons.warning_amber_rounded,
                size: 18, color: context.tokens.textError),
            const SizedBox(width: AppSpacing.xs),
            Flexible(
              child: Text(
                message,
                style: AppTextStyles.captionSmall
                    .copyWith(color: context.tokens.textError),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
