// Pantalla de Descuentos del panel.
//
// LA TARJETA DICE SI EL CUPÓN ES DE PORCENTAJE O DE CIFRA FIJA
// Y lo dice con las dos cosas a la vez: "10 %" o "$5.000". Un cupón del 10 %
// mostrado como "$10.000" es el error más caro que puede cometer esta pantalla, así
// que el formato va explícito en la tarjeta, no solo en el formulario.
//
// `usedCount` Y `usageRemaining` VIENEN DEL BACKEND
// `isCurrentlyValid` también: la app lo muestra, no lo decide. Recalcular vigencia y
// límites en cliente duplicaría las reglas del cupón y se quedaría vieja.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../app/breakpoints.dart';
import '../../../app/theme/app_spacing.dart';
import '../../../core/error/failures.dart';
import '../../../shared/constants/app_strings.dart';
import '../../../shared/widgets/ui/async_state_builder.dart';
import '../domain/entities/admin_accounts.dart';
import './admin_discounts_controller.dart';
import './widgets/admin_detail_row.dart';
import './widgets/admin_discount_card.dart';
import './widgets/admin_discount_form_dialog.dart';
import './widgets/admin_list_and_state.dart';
import './widgets/admin_table_scaffold.dart';

/// Catálogo de cupones.
class AdminDiscountsPage extends ConsumerStatefulWidget {
  const AdminDiscountsPage({super.key});

  @override
  ConsumerState<AdminDiscountsPage> createState() => _AdminDiscountsPageState();
}

class _AdminDiscountsPageState extends ConsumerState<AdminDiscountsPage> {
  final TextEditingController _search = TextEditingController();

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<List<AdminDiscount>> discounts =
        ref.watch(adminDiscountsProvider);
    final List<AdminDiscount> visible =
        ref.watch(adminVisibleDiscountsProvider);
    final String? type = ref.watch(adminDiscountTypeProvider);
    final bool? active = ref.watch(adminDiscountActiveProvider);
    final double padding = context.breakpoint.screenPadding;

    return ListView(
      padding: EdgeInsets.fromLTRB(padding, AppSpacing.xl, padding, AppSpacing.xxl),
      children: <Widget>[
        AdminPageHeader(
          title: AppStrings.navDiscounts,
          subtitle: 'Cupones, porcentajes y descuentos de importe fijo',
          actions: <Widget>[
            AdminHeaderAction(
              icon: Icons.add_rounded,
              tooltip: 'Crear cupón',
              onPressed: () => _createOrEdit(context, ref),
            ),
          ],
        ),
        AdminFilterBar(
          controller: _search,
          searchHint: 'Código o nombre…',
          onSearch: (String value) =>
              ref.read(adminDiscountSearchProvider.notifier).state = value,
          filters: <AdminFilterOption>[
            AdminFilterOption(
              id: 'type',
              label: type == null
                  ? 'Tipo'
                  : (type == 'PERCENT' ? 'Porcentaje' : 'Importe fijo'),
              icon: Icons.percent_rounded,
              isActive: type != null,
              onTap: () => ref
                  .read(adminDiscountTypeProvider.notifier)
                  .state = type == null ? 'PERCENT' : (type == 'PERCENT' ? 'FIXED' : null),
            ),
            AdminFilterOption(
              id: 'valid',
              label: active == true ? 'Solo vigentes' : 'Todos',
              icon: Icons.verified_outlined,
              isActive: active == true,
              onTap: () =>
                  ref.read(adminDiscountActiveProvider.notifier).state = active == true ? null : true,
            ),
          ],
        ),
        AsyncStateBuilder<List<AdminDiscount>>(
          value: discounts,
          loadingMessage: 'Cargando cupones…',
          onRetry: () async => ref.invalidate(adminDiscountsProvider),
          isEmpty: (List<AdminDiscount> data) => data.isEmpty,
          emptyIcon: Icons.sell_outlined,
          emptyTitle: AppStrings.adminEmptyDiscounts,
          emptyMessage: 'Crea un cupón para aplicarlo en el mostrador y en el '
              'checkout del cliente.',
          builder: (BuildContext context, List<AdminDiscount> data) {
            if (visible.isEmpty) {
              return const AdminEmptyTable(
                icon: Icons.filter_alt_off_rounded,
                title: 'Ningún cupón coincide',
                message: 'Cambia la búsqueda o el filtro de tipo.',
              );
            }
            return ListView.separated(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
              itemCount: visible.length,
              separatorBuilder: (BuildContext context, int index) =>
                  const SizedBox(height: AppSpacing.sm),
              itemBuilder: (BuildContext context, int index) =>
                  AdminDiscountCard(discount: visible[index]),
            );
          },
        ),
      ],
    );
  }

  /// Alta o edición de un cupón.
  ///
  /// Comparte diálogo con la edición porque el formulario es el mismo: lo único
  /// que cambia es si el código viaja en el cuerpo (`POST`) o no (`PATCH`, donde
  /// el backend no lo acepta).
  Future<void> _createOrEdit(BuildContext context, WidgetRef ref,
      [AdminDiscount? discount]) async {
    final AdminDiscountDraft? draft =
        await AdminDiscountFormDialog.show(context, discount: discount);
    if (draft == null || !context.mounted) return;

    final bool ok = discount == null
        ? await ref.read(adminDiscountProvider.notifier).create(draft.body)
        : await ref
            .read(adminDiscountProvider.notifier)
            .updateDiscount(discount.id, draft.body);
    if (!context.mounted) return;

    if (!ok) {
      final Object? error = ref.read(adminDiscountProvider).error;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(error is Failure ? error.message : 'No se pudo guardar.'),
          behavior: SnackBarBehavior.floating,
        ),
      );
      return;
    }
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(discount == null
            ? 'Cupón ${draft.code} creado.'
            : 'Cupón ${draft.code} actualizado.'),
        behavior: SnackBarBehavior.floating,
      ),
    );
  }
}

