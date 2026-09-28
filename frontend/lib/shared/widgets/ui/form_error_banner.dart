// Banner de error de formulario.
//
// POR QUÉ EXISTE Y POR QUÉ NO ES UN `ErrorState`
// ----------------------------------------------
// `ErrorState` reemplaza la pantalla completa: es lo correcto para una lectura
// que falló. Un formulario NO puede hacer eso: si al darle a "Iniciar sesión"
// desaparece el formulario, el usuario pierde lo que escribió y tiene que
// memorizar su contraseña otra vez. Este banner mantiene el formulario visible y
// pone el error justo encima del botón, donde está la mirada.
//
// Cumple las reglas del design system: texto + ícono + color (nunca color solo),
// superficie `surfaceErrorSubtle` con texto `textError` (7.03:1, §1.4) y
// `Semantics(liveRegion: true)` para que el lector de pantalla anuncie el
// error sin que el usuario tenga que buscarlo.
//
// Uso típico:
// ```dart
// FormErrorBanner(failure: failure, onRetry: () => ref.invalidate(products))
// ```

import 'package:flutter/material.dart';

import '../../../app/theme/app_colors.dart';
import '../../../app/theme/app_radii.dart';
import '../../../app/theme/app_spacing.dart';
import '../../../app/theme/app_typography.dart';
import '../../../core/error/failures.dart';

/// Error de formulario en línea, sin reemplazar el contenido.
class FormErrorBanner extends StatelessWidget {
  const FormErrorBanner({
    required this.failure,
    this.onRetry,
    this.title,
    this.compact = false,
    super.key,
  });

  /// Fallo normalizado por `core/error/error_mapper.dart`.
  final Failure failure;

  /// Acción secundaria. Solo se pinta si el fallo es reintentable.
  final VoidCallback? onRetry;

  /// Título propio. Por defecto, el tipo de fallo.
  final String? title;

  /// `true` = versión de una línea, para espacios estrechos.
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final String heading = title ?? switch (failure) {
          OfflineFailure() => 'Sin conexión',
          UnauthorizedFailure() => 'No pudimos iniciar sesión',
          ValidationFailure() => 'Revisa los datos',
          RateLimitFailure() => 'Demasiados intentos',
          ConflictFailure() => 'Ese dato ya existe',
          ForbiddenFailure() => 'Cuenta sin acceso',
          PaymentFailure() => 'Pago no aprobado',
          _ => 'No se pudo completar',
        };

    return Semantics(
      liveRegion: true,
      container: true,
      child: Container(
        width: double.infinity,
        padding: EdgeInsets.all(compact ? AppSpacing.md : AppSpacing.lg),
        decoration: BoxDecoration(
          color: AppColors.surfaceErrorSubtle,
          borderRadius: BorderRadius.circular(AppRadii.md),
          border: Border.all(color: AppColors.stateError),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Icon(
              _icon,
              size: compact ? 18 : 20,
              color: AppColors.textError,
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    heading,
                    style: AppTextStyles.titleSmall
                        .copyWith(color: AppColors.textError),
                  ),
                  const SizedBox(height: AppSpacing.xs),
                  Text(
                    failure.message,
                    style: AppTextStyles.bodySmall
                        .copyWith(color: AppColors.textError),
                  ),
                  if (onRetry != null && failure.isRetryable) ...<Widget>[
                    const SizedBox(height: AppSpacing.sm),
                    // Target ≥ 44 dp y foco visible: es un control, no texto.
                    ConstrainedBox(
                      constraints: const BoxConstraints(minHeight: 44),
                      child: TextButton(
                        onPressed: onRetry,
                        style: TextButton.styleFrom(
                          foregroundColor: AppColors.textError,
                          padding: const EdgeInsets.symmetric(
                            horizontal: AppSpacing.sm,
                          ),
                        ),
                        child: const Text('Reintentar'),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Ícono coherente con el tipo de fallo (segundo canal, además del texto).
  IconData get _icon => switch (failure) {
        OfflineFailure() => Icons.wifi_off_rounded,
        UnauthorizedFailure() => Icons.lock_outline_rounded,
        ValidationFailure() => Icons.edit_note_rounded,
        RateLimitFailure() => Icons.hourglass_bottom_rounded,
        ConflictFailure() => Icons.person_search_rounded,
        ForbiddenFailure() => Icons.no_accounts_rounded,
        PaymentFailure() => Icons.credit_card_off_rounded,
        _ => Icons.error_outline_rounded,
      };
}
