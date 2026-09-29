// Panel de detalle técnico de un error.
//
// Solo se muestra en debug (`ErrorState.showTechnicalDetails`, por defecto
// `kDebugMode`). Existe porque en release el backend nunca envía stack traces
// ni mensajes crudos (API.md §4: "un 500 nunca contiene detalles técnicos"), y
// sin `code` + `requestId` un bug es irreproducible.
//
// Uso típico: no se usa directamente; lo monta `ErrorState`.

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../app/theme/app_radii.dart';
import '../../../app/theme/app_spacing.dart';
import '../../../app/theme/app_tokens.dart';
import '../../../app/theme/app_typography.dart';
// `FieldError` llega por el `export` de `failures.dart`: importar los dos
// sería redundante.
import '../../../core/error/failures.dart';

/// Panel expandible con código, `requestId` y botón de copiar.
class ErrorDetailsPanel extends StatelessWidget {
  const ErrorDetailsPanel({required this.failure, super.key});

  final Failure failure;

  @override
  Widget build(BuildContext context) {
    final text = <String>[
      'code: ${failure.code ?? '-'}',
      if (failure.requestId != null) 'requestId: ${failure.requestId}',
      if (failure is UnknownFailure && (failure as UnknownFailure).details != null)
        'detalle: ${(failure as UnknownFailure).details}',
      for (final FieldError error in failure.fieldErrors)
        '${error.path}: ${error.message} (${error.code ?? '-'})',
    ].join('\n');

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: context.tokens.surfaceSunken,
        borderRadius: BorderRadius.circular(AppRadii.md),
        border: Border.all(color: context.tokens.borderSubtle),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          SelectableText(
            text,
            style: AppTextStyles.captionSmall.copyWith(
              color: context.tokens.textSecondary,
              fontFamily: 'monospace',
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton.icon(
              onPressed: () async {
                await Clipboard.setData(ClipboardData(text: text));
                if (!context.mounted) return;
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Detalles copiados')),
                );
              },
              icon: const Icon(Icons.copy_rounded, size: 16),
              label: const Text('Copiar detalles'),
              style: TextButton.styleFrom(
                minimumSize: const Size(0, 44),
                foregroundColor: context.tokens.actionPrimary,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
