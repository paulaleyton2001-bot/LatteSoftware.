// Proveedores del inventario. MÓDULO `features/admin/presentation/widgets`.
//
// ⚠️ NO HAY "NUEVO PROVEEDOR"
// El proveedor NO es una entidad: el backend lo DERIVA de
// `inventory_items.supplier` (`GET /inventory/suppliers`, API.md §7.15) y solo
// devuelve los que tienen al menos un ítem activo. Por eso esta tarjeta no tiene
// botón de alta, y el estado vacío lo EXPLICA en vez deInvite a buscar uno que no
// debe existir.
//
// SI ALGUIEN QUISIERA DAR DE ALTA UN PROVEEDOR
// Sería escribir un `supplier` distinto en un ítem. No hace falta un endpoint.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../shared/widgets/ui/app_card.dart';
import '../../../../shared/widgets/ui/async_state_builder.dart';
import '../../../../shared/widgets/ui/price_display.dart';
import '../../domain/entities/admin_inventory.dart';
import '../admin_inventory_controller.dart';

/// Tarjeta con los proveedores, derivados de los ítems.
class AdminSuppliersCard extends ConsumerWidget {
  const AdminSuppliersCard({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<List<AdminSupplier>> suppliers =
        ref.watch(adminSuppliersProvider);

    return AsyncStateBuilder<List<AdminSupplier>>(
      value: suppliers,
      loadingMessage: 'Cargando proveedores…',
      onRetry: () async => ref.invalidate(adminSuppliersProvider),
      isEmpty: (List<AdminSupplier> data) => data.isEmpty,
      emptyIcon: Icons.local_shipping_outlined,
      emptyTitle: 'Sin proveedores',
      // El mensaje explica POR QUÉ no hay: el proveedor no se crea, se deduce del
      // campo `supplier` de cada ítem. Sin esa frase, el usuario busca un botón
      // "nuevo proveedor" que no existe porque no debe existir.
      emptyMessage: 'Los proveedores se sacan del campo "proveedor" de cada '
          'ítem de inventario. No se dan de alta aparte.',
      compactEmpty: true,
      builder: (BuildContext context, List<AdminSupplier> data) => AppCard(
        padding: EdgeInsets.zero,
        child: Column(
          children: <Widget>[
            for (int i = 0; i < data.length; i++) ...<Widget>[
              if (i > 0) const Divider(height: 1),
              _SupplierRow(supplier: data[i]),
            ],
          ],
        ),
      ),
    );
  }
}

/// Fila de un proveedor.
class _SupplierRow extends StatelessWidget {
  const _SupplierRow({required this.supplier});

  final AdminSupplier supplier;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.lg,
        vertical: AppSpacing.md,
      ),
      child: Row(
        children: <Widget>[
          Icon(Icons.local_shipping_outlined,
              size: 18, color: context.tokens.textSecondary),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  supplier.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppTextStyles.titleSmall,
                ),
                Text(
                  '${supplier.itemCount} ítems'
                  '${supplier.lowStockCount > 0 ? ' · ${supplier.lowStockCount} bajo mínimo' : ''}',
                  style: AppTextStyles.captionSmall
                      .copyWith(color: context.tokens.textTertiary),
                ),
              ],
            ),
          ),
          PriceDisplay(currentMinor: supplier.totalValueMinor),
        ],
      ),
    );
  }
}




