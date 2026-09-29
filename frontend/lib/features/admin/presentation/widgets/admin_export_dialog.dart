// Diálogo de exportación a CSV. MÓDULO `features/admin/presentation/widgets`.
//
// POR QUÉ SE MUESTRA Y NO SE GUARDA
// `POST /reports/export` devuelve `text/csv` con BOM UTF-8 y separador `;`
// (convención es-CO). Guardarlo en un archivo exigiría una dependencia de sistema
// de archivos que `pubspec.yaml` no tiene y que no se puede añadir en esta fase.
// Lo que sí se puede hacer sin dependencias es MOSTRARLO y COPIARLO al
// portapapeles, que es lo que hace falta en el 99 % de los casos (abrir en una
// hoja de cálculo y pegar).
//
// EL CSV EMPIEZA CON BOM
// `String` no lleva el BOM (son tres bytes EF BB BF que en Dart se escriben como
// `\uFEFF`). El backend lo pone para que Excel en Windows respete los acentos; al
// pegar en el portapapeles hay que conservarlo, y por eso el texto se copia tal
// cual, sin recortar espacios.
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../core/error/failures.dart';
import '../../../../shared/widgets/ui/app_button.dart';
import '../../../../shared/widgets/ui/app_text_field.dart';
import '../admin_reports_controller.dart';

/// Abre el diálogo de exportación.
Future<void> showAdminExportDialog(BuildContext context, WidgetRef ref) =>
    showDialog<void>(
      context: context,
      builder: (BuildContext dialogContext) => const AdminExportDialog(),
    );

/// Diálogo de exportación a CSV.
class AdminExportDialog extends ConsumerWidget {
  const AdminExportDialog({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<String?> export = ref.watch(adminExportProvider);
    final String preset = ref.watch(adminReportPresetProvider);
    final String? report = ref.watch(adminExportReportProvider);
    final String? csv = export.valueOrNull;

    return AlertDialog(
      title: const Text('Exportar a CSV'),
      content: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 560, maxHeight: 480),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Text('Informe', style: AppTextStyles.titleSmall),
              const SizedBox(height: AppSpacing.sm),
              Wrap(
                spacing: AppSpacing.sm,
                runSpacing: AppSpacing.sm,
                children: <Widget>[
                  for (final (String, String) option in kAdminExportReports)
                    ChoiceChip(
                      label: Text(option.$2),
                      selected: report == option.$1,
                      onSelected: (_) =>
                          ref.read(adminExportReportProvider.notifier).state =
                              option.$1,
                    ),
                ],
              ),
              const SizedBox(height: AppSpacing.lg),
              Text('Periodo: ${adminPresetLabel(preset)}', style: AppTextStyles.bodySmall),
              const SizedBox(height: AppSpacing.lg),
              if (export.isLoading)
                const Row(
                  children: <Widget>[
                    SizedBox.square(
                      dimension: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                    SizedBox(width: AppSpacing.md),
                    Text('Generando el archivo…'),
                  ],
                )
              else if (export.error != null)
                Text(
                  export.error is Failure
                      ? (export.error! as Failure).message
                      : 'No se pudo exportar.',
                  style: AppTextStyles.bodySmall
                      .copyWith(color: context.tokens.textError),
                )
              else if (csv != null)
                _CsvPreview(csv: csv)
              else
                Text(
                  'Elige un informe y pulsa "Exportar". El archivo usa coma '
                  'coma decimal y punto y coma como separador, listo para Excel.',
                  style: AppTextStyles.bodySmall
                      .copyWith(color: context.tokens.textSecondary),
                ),
            ],
          ),
        ),
      ),
      actions: <Widget>[
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cerrar'),
        ),
        if (csv != null)
          AppButton(
            label: 'Copiar',
            icon: Icons.copy_all_rounded,
            variant: AppButtonVariant.secondary,
            onPressed: () async {
              await Clipboard.setData(ClipboardData(text: csv));
              if (!context.mounted) return;
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(
                  content: Text('CSV copiado al portapapeles'),
                  behavior: SnackBarBehavior.floating,
                ),
              );
            },
          ),
        FilledButton(
          onPressed: report == null || export.isLoading
              ? null
              : () => ref
                  .read(adminExportProvider.notifier)
                  .export(report: report, preset: preset),
          child: const Text('Exportar'),
        ),
      ],
    );
  }
}

/// Vista previa del CSV: las primeras líneas, en un campo de solo lectura.
///
/// Es `StatefulWidget` y no `StatelessWidget` porque el `TextEditingController` del
/// campo de solo lectura es PROPIO: crearlo dentro de `build` lo recrea en cada
/// reconstrucción y el anterior no se libera nunca.
class _CsvPreview extends StatefulWidget {
  const _CsvPreview({required this.csv});

  final String csv;

  @override
  State<_CsvPreview> createState() => _CsvPreviewState();
}

class _CsvPreviewState extends State<_CsvPreview> {
  late final TextEditingController _controller;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(
      text: widget.csv.split('\n').take(_maxLines).join('\n'),
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  /// Cuántas líneas se muestran. Un CSV de 5.000 filas dentro de un `AlertDialog`
  /// lo bloquearía; el botón de copiar da acceso al resto.
  static const int _maxLines = 12;

  @override
  Widget build(BuildContext context) {
    final List<String> lines = widget.csv.split('\n');

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Text(
          '${lines.length} líneas · ${widget.csv.length} caracteres',
          style: AppTextStyles.captionSmall
              .copyWith(color: context.tokens.textTertiary),
        ),
        const SizedBox(height: AppSpacing.sm),
        AppTextField(
          controller: _controller,
          readOnly: true,
          maxLines: _maxLines,
          minLines: 4,
          label: 'Vista previa',
        ),
      ],
    );
  }
}
