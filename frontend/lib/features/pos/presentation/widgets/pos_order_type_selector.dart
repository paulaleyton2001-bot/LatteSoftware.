// Selector de tipo de pedido. MÓDULO `pos/presentation/widgets`.
//
// Un `SegmentedButton` de Material no cabe con tres etiquetas largas en 300 dp, y
// un `Row` de `CategoryChip` sugeriría "filtro acumulable" cuando esto es una
// decisión EXCLUYENTE. Aquí se usa un `Material` + `InkWell` con tokens del
// design system, que es el mismo patrón que `CategoryChip` pero con la forma
// correcta: check + fondo + barra.
//
// Al cambiar a `CHAIR_RENTAL` el panel de cobro muestra el selector de silla y
// avisa de que hace falta una reserva asociada; al cambiar a `TAKEAWAY` se
// suelta la silla (ver `PosDraftController.setType`).

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/theme/app_radii.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../shared/constants/app_strings.dart';
import '../../domain/entities/pos_order_type.dart';
import '../pos_controller.dart';

/// Selector de `OrderType` del pedido en curso.
class PosOrderTypeSelector extends ConsumerWidget {
  const PosOrderTypeSelector({this.compact = false, super.key});

  /// `true` en móvil: solo ícono y tooltip, para no comerse el ancho.
  final bool compact;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final PosOrderType current = ref.watch(posDraftProvider).type;

    return Semantics(
      container: true,
      label: 'Tipo de pedido',
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
        child: Row(
          children: <Widget>[
            for (final PosOrderType type in PosOrderType.values)
              Padding(
                padding: const EdgeInsets.only(right: AppSpacing.sm),
                child: _TypeButton(
                  type: type,
                  selected: type == current,
                  compact: compact,
                  onTap: () =>
                      ref.read(posDraftProvider.notifier).setType(type),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// Botón de un tipo de pedido. Alto mínimo 44 dp (WCAG 2.5.5).
class _TypeButton extends StatelessWidget {
  const _TypeButton({
    required this.type,
    required this.selected,
    required this.compact,
    required this.onTap,
  });

  final PosOrderType type;
  final bool selected;
  final bool compact;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final Color foreground =
        selected ? context.tokens.textSuccess : context.tokens.textSecondary;
    return Semantics(
      button: true,
      selected: selected,
      label: 'Pedido para ${type.label.toLowerCase()}',
      excludeSemantics: true,
      child: Tooltip(
        message: type.label,
        child: Material(
          color: selected ? context.tokens.surfaceGreenSubtle : context.tokens.surfaceMuted,
          borderRadius: BorderRadius.circular(AppRadii.md),
          child: InkWell(
            onTap: onTap,
            borderRadius: BorderRadius.circular(AppRadii.md),
            splashColor: context.tokens.focusRingSurface,
            child: Container(
              constraints: const BoxConstraints(minHeight: 44),
              padding: EdgeInsets.symmetric(
                horizontal: compact ? AppSpacing.md : AppSpacing.lg,
                vertical: AppSpacing.sm,
              ),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(AppRadii.md),
                border: Border.all(
                  color: selected ? context.tokens.brandDark : context.tokens.borderDefault,
                ),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  if (selected) ...<Widget>[
                    Icon(Icons.check_rounded,
                        size: 16, color: context.tokens.actionPrimary),
                    const SizedBox(width: AppSpacing.xs),
                  ],
                  Icon(type.icon, size: 18, color: foreground),
                  if (!compact) ...<Widget>[
                    const SizedBox(width: AppSpacing.sm),
                    Text(
                      type.label,
                      style: AppTextStyles.labelLarge.copyWith(color: foreground),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Aviso de los requisitos del tipo elegido.
///
/// Sin esto, el cajero elige "alquiler de silla", cobra, y el backend responde
/// `422 RENTAL_REQUIRES_CHAIR_AND_RESERVATION`. Es más barato decirlo antes.
class PosOrderTypeHint extends ConsumerWidget {
  const PosOrderTypeHint({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final String? reason = ref.watch(posDraftProvider).blockingReason;
    if (reason == null) return const SizedBox.shrink();
    return PosInlineNotice(
      icon: Icons.info_outline_rounded,
      text: reason,
    );
  }
}

/// Banner informativo corto del POS. Ícono + texto, nunca solo color.
///
/// Reutilizable por el aviso de sin conexión y por el de idempotencia, para que
/// los tres se vean iguales.
class PosInlineNotice extends StatelessWidget {
  const PosInlineNotice({
    required this.icon,
    required this.text,
    this.tone = PosNoticeTone.info,
    this.action,
    super.key,
  });

  final IconData icon;
  final String text;
  final PosNoticeTone tone;

  /// Acción opcional a la derecha (el aviso de "sin conexión" ofrece reintentar).
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final Color surface = switch (tone) {
      PosNoticeTone.info => context.tokens.surfaceInfoSubtle,
      PosNoticeTone.warning => context.tokens.surfaceWarningSubtle,
      PosNoticeTone.error => context.tokens.surfaceErrorSubtle,
      PosNoticeTone.success => context.tokens.surfaceSuccessSubtle,
    };
    final Color foreground = switch (tone) {
      PosNoticeTone.info => context.tokens.textInfo,
      PosNoticeTone.warning => context.tokens.textWarning,
      PosNoticeTone.error => context.tokens.textError,
      PosNoticeTone.success => context.tokens.textSuccess,
    };

    return Semantics(
      liveRegion: true,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
          color: surface,
          borderRadius: BorderRadius.circular(AppRadii.md),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Icon(icon, size: 18, color: foreground),
            const SizedBox(width: AppSpacing.sm),
            Expanded(
              child: Text(
                text,
                style: AppTextStyles.bodySmall.copyWith(color: foreground),
              ),
            ),
            if (action != null) ...<Widget>[
              const SizedBox(width: AppSpacing.sm),
              action!,
            ],
          ],
        ),
      ),
    );
  }
}

/// Tono del aviso, para no repetir `switch` en cada pantalla.
enum PosNoticeTone { info, warning, error, success }

/// Etiquetas de los tipos por literal, para cabeceras y `Semantics`.
const Map<String, String> kPosOrderTypeLabels = <String, String>{
  'TAKEAWAY': AppStrings.orderTypeTakeaway,
  'DINE_IN': AppStrings.orderTypeDineIn,
  'CHAIR_RENTAL': AppStrings.orderTypeChairRental,
};
