// Tarjeta de un cupón. MÓDULO `features/admin/presentation/widgets`.
//
// LA TARJETA DICE SI EL CUPÓN ES DE PORCENTAJE O DE CIFRA FIJA
// Y lo dice con las dos cosas a la vez: "10 %" o "$5.000". Un cupón del 10 %
// mostrado como "$10.000" es el error más caro que puede cometer esta pantalla, así
// que el formato va explícito en la tarjeta y no solo en el formulario.
//
// `value` SIGNIFICA DOS COSAS SEGÚN `type`
// Basis points si `type = PERCENT` (1000 = 10 %) y centavos si `type = FIXED`.
// `AdminDiscount.isPercent` y `.percent` son la única forma de leerlo.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../core/error/failures.dart';
import '../../../../core/utils/currency_formatter.dart';
import '../../../../shared/widgets/ui/app_card.dart';
import '../../domain/entities/admin_accounts.dart';
import '../admin_discounts_controller.dart';
import './admin_discount_form_dialog.dart';

/// Tarjeta de un cupón.
class AdminDiscountCard extends ConsumerWidget {
  const AdminDiscountCard({required this.discount});

  final AdminDiscount discount;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<void> busy = ref.watch(adminDiscountProvider);

    return AppCard(
      padding: const EdgeInsets.all(AppSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  discount.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppTextStyles.titleSmall,
                ),
              ),
              AdminDiscountValidityTag(discount: discount),
            ],
          ),
          const SizedBox(height: AppSpacing.xs),
          Row(
            children: <Widget>[
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: AppSpacing.sm,
                  vertical: AppSpacing.xxs,
                ),
                decoration: BoxDecoration(
                  color: context.tokens.surfaceMuted,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  discount.code,
                  style: AppTextStyles.labelMedium
                      .copyWith(color: context.tokens.textStrong),
                ),
              ),
              const Spacer(),
              // Formato explícito: "10 %" o "$5.000". Nunca ambiguo.
              Text(
                discount.isPercent
                    ? '${discount.percent.toStringAsFixed(discount.percent % 1 == 0 ? 0 : 1)} %'
                    : CurrencyFormatter.formatMinor(discount.value),
                style: AppTextStyles.titleMedium
                    .copyWith(color: context.tokens.textSuccess),
              ),
            ],
          ),
          if (discount.description != null) ...<Widget>[
            const SizedBox(height: AppSpacing.xs),
            Text(
              discount.description!,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: AppTextStyles.captionMedium
                  .copyWith(color: context.tokens.textSecondary),
            ),
          ],
          const SizedBox(height: AppSpacing.sm),
          Row(
            children: <Widget>[
              Text(
                '${discount.usedCount} usados'
                '${discount.usageLimit == null ? '' : ' de ${discount.usageLimit}'}',
                style: AppTextStyles.captionSmall
                    .copyWith(color: context.tokens.textTertiary),
              ),
              if (discount.minOrderMinor > 0) ...<Widget>[
                const SizedBox(width: AppSpacing.md),
                Text(
                  'Mínimo ${CurrencyFormatter.formatMinor(discount.minOrderMinor)}',
                  style: AppTextStyles.captionSmall
                      .copyWith(color: context.tokens.textTertiary),
                ),
              ],
              if (discount.maxDiscountMinor != null) ...<Widget>[
                const SizedBox(width: AppSpacing.md),
                Text(
                  'Tope ${CurrencyFormatter.formatMinor(discount.maxDiscountMinor!)}',
                  style: AppTextStyles.captionSmall
                      .copyWith(color: context.tokens.textTertiary),
                ),
              ],
              const Spacer(),
              // Editar y dar de baja van juntos: son las dos únicas acciones de
              // un cupón, y una sin la otra deja al gestor recurriendo a la
              // ficha de cada uno para cambiar un porcentaje.
              TextButton(
                onPressed: busy.isLoading
                    ? null
                    : () => showAdminDiscountEditor(context, ref, discount),
                child: const Text('Editar'),
              ),
              TextButton(
                onPressed: busy.isLoading
                    ? null
                    : () => ref
                        .read(adminDiscountProvider.notifier)
                        .delete(discount.id),
                child: const Text('Dar de baja'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Distintivo de vigencia del cupón. Icono + palabra + color.
class AdminDiscountValidityTag extends StatelessWidget {
  const AdminDiscountValidityTag({required this.discount});

  final AdminDiscount discount;

  @override
  Widget build(BuildContext context) {
    final String label = discount.isCurrentlyValid
        ? 'Vigente'
        : (discount.isActive ? 'No vigente' : 'Inactivo');
    final Color color = discount.isCurrentlyValid
        ? context.tokens.textSuccess
        : (discount.isActive ? context.tokens.textWarning : context.tokens.textTertiary);
    final IconData icon = discount.isCurrentlyValid
        ? Icons.verified_rounded
        : Icons.schedule_rounded;

    return Semantics(
      label: label,
      excludeSemantics: true,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Icon(icon, size: 16, color: color),
          const SizedBox(width: AppSpacing.xxs),
          Text(label, style: AppTextStyles.labelMedium.copyWith(color: color)),
        ],
      ),
    );
  }
}

/// Abre el formulario para editar [discount] y encadena la escritura.
///
/// Vive aquí, y no en la página, porque la tarjeta es la que sabe qué cupón se
/// está tocando: la página solo tiene la lista. Así la tarjeta no necesita
/// recibir un callback de guardado por cada acción quetenga tenga.
Future<void> showAdminDiscountEditor(
  BuildContext context,
  WidgetRef ref,
  AdminDiscount discount,
) async {
  final AdminDiscountDraft? draft =
      await AdminDiscountFormDialog.show(context, discount: discount);
  if (draft == null || !context.mounted) return;

  final bool ok =
      await ref
          .read(adminDiscountProvider.notifier)
          .updateDiscount(discount.id, draft.body);
  if (!context.mounted) return;

  final Object? error = ok ? null : ref.read(adminDiscountProvider).error;
  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(
      content: Text(ok
          ? 'Cupón ${discount.code} actualizado.'
          : error is Failure
              ? error.message
              : 'No se pudo guardar el cupón.'),
      behavior: SnackBarBehavior.floating,
    ),
  );
}
