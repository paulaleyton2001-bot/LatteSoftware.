// Aviso de error del cobro, con el matiz que importa en una caja.
//
// MÓDULO `pos/presentation/widgets`. Vive aparte porque es lo ÚNICO que hay que
// explicar con cuidado: un `NetworkFailure` en `POST /payments` es AMBIGUO
// (puede que el servidor sí recibiera la petición) y el texto tiene que decirlo
// para que el cajero sepa que puede reintentar SIN miedo a cobrar dos veces.

import 'package:flutter/material.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../core/error/failures.dart';

/// Error del cobro, con el matiz que importa en una caja.
///
/// Un `NetworkFailure` en `POST /payments` es AMBIGUO: puede que el servidor sí
/// lo recibiera. Se dice explícitamente que se puede reintentar con seguridad
/// (misma `Idempotency-Key`) en vez de un "reintentado" genérico que haría dudar
/// de si se cobró dos veces.
class PosChargeError extends StatelessWidget {
  const PosChargeError({required this.failure});

  final Failure failure;

  @override
  Widget build(BuildContext context) {
    final bool ambiguous = failure is NetworkFailure ||
        failure is OfflineFailure ||
        failure is ServerFailure;
    return Semantics(
      liveRegion: true,
      child: Container(
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
          color: context.tokens.surfaceErrorSubtle,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Icon(Icons.error_outline_rounded,
                size: 20, color: context.tokens.textError),
            const SizedBox(width: AppSpacing.sm),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    failure.message,
                    style: AppTextStyles.bodySmall
                        .copyWith(color: context.tokens.textError),
                  ),
                  if (ambiguous) ...<Widget>[
                    const SizedBox(height: AppSpacing.xs),
                    Text(
                      'Si no estás seguro de que se registró, vuelve a confirmar: '
                      'la misma clave de idempotencia impide que se cobre dos veces.',
                      style: AppTextStyles.captionSmall
                          .copyWith(color: context.tokens.textError),
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
}
