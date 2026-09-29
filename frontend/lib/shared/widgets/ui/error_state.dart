// Estado de error de una pantalla.
//
// Muestra: qué pasó (en español), el código estable del backend para soporte,
// y una acción de reintento. En modo debug permite copiar los detalles técnicos
// al portapapeles, porque en release el backend nunca los envía (API.md §4) y
// sin ellos el bug es irreproducible.
//
// Uso típico:
// ```dart
// ErrorState(
//   failure: failure,
//   onRetry: () => ref.invalidate(productsProvider),
//   showTechnicalDetails: kDebugMode,
// );
// ```


import 'package:flutter/foundation.dart' show kDebugMode;
import 'package:flutter/material.dart';

import '../../../app/theme/app_spacing.dart';
import '../../../app/theme/app_tokens.dart';
import '../../../core/error/failures.dart';
import './error_details_panel.dart';

/// Pantalla de error con reintento y detalle técnico opcional.
class ErrorState extends StatelessWidget {
  const ErrorState({
    required this.failure,
    this.onRetry,
    this.onSignIn,
    this.title,
    this.showTechnicalDetails = kDebugMode,
    this.compact = false,
    super.key,
  });

  /// Fallo ya normalizado por `core/error/error_mapper.dart`.
  final Failure failure;

  /// Callback de reintento. `null` = no se ofrece (p. ej. 403).
  final VoidCallback? onRetry;

  /// Callback del botón "Iniciar sesión" de un `UnauthorizedFailure`.
  ///
  /// El widget no navega por su cuenta (no depende de `go_router`): quien lo
  /// usa le pasa `() => context.goNamed(RouteNames.login)`. Si es `null`, el
  /// botón no se pinta porque el flujo real (el `redirect` del router) ya
  /// mandó al usuario a `/login`.
  final VoidCallback? onSignIn;

  /// Sobrescribe el título por defecto.
  final String? title;

  /// Muestra el panel expandible con código y `requestId`.
  final bool showTechnicalDetails;

  /// `true` = versión dentro de una card.
  final bool compact;

  /// Título por defecto según el tipo de fallo.
  String get _title => title ?? switch (failure) {
        OfflineFailure() => 'Sin conexión',
        UnauthorizedFailure() => 'Sesión expirada',
        ForbiddenFailure() => 'Sin permisos',
        NotFoundFailure() => 'No encontrado',
        ValidationFailure() => 'Revisa los datos',
        ConflictFailure() => 'Conflicto',
        BusinessRuleFailure() => 'No se puede completar',
        PaymentFailure() => 'Pago no aprobado',
        RateLimitFailure() => 'Demasiados intentos',
        NetworkFailure() || ServerFailure() => 'Algo salió mal',
        UnknownFailure() => 'Error inesperado',
      };

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Center(
      child: SingleChildScrollView(
        padding: EdgeInsets.all(compact ? AppSpacing.lg : AppSpacing.xl),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 440),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Icon(
                _icon,
                size: compact ? 32 : 44,
                color: context.tokens.stateErrorStrong,
              ),
              SizedBox(height: compact ? AppSpacing.md : AppSpacing.lg),
              Text(_title, textAlign: TextAlign.center, style: text.titleLarge),
              const SizedBox(height: AppSpacing.sm),
              Text(
                failure.message,
                textAlign: TextAlign.center,
                style: text.bodyMedium?.copyWith(color: context.tokens.textSecondary),
              ),
              if (showTechnicalDetails) ...<Widget>[
                const SizedBox(height: AppSpacing.md),
                ErrorDetailsPanel(failure: failure),
              ],
              const SizedBox(height: AppSpacing.lg),
              Wrap(
                spacing: AppSpacing.md,
                runSpacing: AppSpacing.sm,
                alignment: WrapAlignment.center,
                children: <Widget>[
                  if (onRetry != null && failure.isRetryable)
                    FilledButton.icon(
                      onPressed: onRetry,
                      icon: const Icon(Icons.refresh_rounded, size: 18),
                      label: const Text('Reintentar'),
                      style: FilledButton.styleFrom(
                        backgroundColor: context.tokens.actionPrimary,
                        foregroundColor: context.tokens.onActionPrimary,
                        minimumSize: const Size(0, 48),
                      ),
                    ),
                  if (failure.requiresAuth && onSignIn != null)
                    FilledButton(
                      onPressed: onSignIn,
                      style: FilledButton.styleFrom(
                        backgroundColor: context.tokens.actionPrimary,
                        foregroundColor: context.tokens.onActionPrimary,
                        minimumSize: const Size(0, 48),
                      ),
                      child: const Text('Iniciar sesión'),
                    ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// Ícono coherente con el tipo de fallo (segundo canal, además del texto).
  IconData get _icon => switch (failure) {
        OfflineFailure() => Icons.wifi_off_rounded,
        UnauthorizedFailure() => Icons.lock_outline_rounded,
        ForbiddenFailure() => Icons.no_accounts_rounded,
        NotFoundFailure() => Icons.search_off_rounded,
        ValidationFailure() => Icons.edit_note_rounded,
        ConflictFailure() => Icons.sync_problem_rounded,
        BusinessRuleFailure() => Icons.rule_rounded,
        PaymentFailure() => Icons.credit_card_off_rounded,
        RateLimitFailure() => Icons.hourglass_bottom_rounded,
        NetworkFailure() || ServerFailure() => Icons.cloud_off_rounded,
        UnknownFailure() => Icons.error_outline_rounded,
      };
}
