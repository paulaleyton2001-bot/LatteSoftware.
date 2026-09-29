// Estado de la pantalla de Descuentos del panel.
//
// EL VALOR DE UN CUPÓN SIGNIFICA DOS COSAS
// `value` es BASIS POINTS si `type = PERCENT` (1000 = 10 %) y CENTAVOS si
// `type = FIXED`. La misma palabra para dos unidades es la trampa más fácil de
// equivocar aquí: un cupón del 10 % pintado como "$10.000" hace que alguien quite
// un descuento de $10.000 a un pedido de $30.000. `AdminDiscount.percent` y
// `AdminDiscount.isPercent` son la única forma de leerlo.
//
// LA VALIDACIÓN ES UNA CONSULTA, NO UN ERROR
// `POST /discounts/validate` devuelve `200` con `isValid: false` y `reason` cuando el
// cupón no sirve, porque es una PREVISUALIZACIÓN. La app lo muestra como tal y no
// como un fallo: un cupón caducado no es un error del sistema.
import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/error/failures.dart';
import '../../../core/result/result.dart';
import '../domain/entities/admin_accounts.dart';
import './admin_providers.dart';

/// Búsqueda por código o nombre.
final StateProvider<String> adminDiscountSearchProvider =
    StateProvider<String>((Ref ref) => '');

/// Filtro por tipo. `null` = todos.
final StateProvider<String?> adminDiscountTypeProvider =
    StateProvider<String?>((Ref ref) => null);

/// Filtro de vigencia. `null` = todos.
final StateProvider<bool?> adminDiscountActiveProvider =
    StateProvider<bool?>((Ref ref) => null);

/// Listado de cupones.
final FutureProvider<List<AdminDiscount>> adminDiscountsProvider =
    FutureProvider<List<AdminDiscount>>(
  (Ref ref) async {
    final Result<List<AdminDiscount>> result =
        await ref.watch(adminDirectoryRepositoryProvider).discounts(
              type: ref.watch(adminDiscountTypeProvider),
              isActive: ref.watch(adminDiscountActiveProvider),
            );
    return switch (result) {
      Success<List<AdminDiscount>>(:final List<AdminDiscount> value) => value,
      FailureResult<List<AdminDiscount>>(:final Failure failure) => throw failure,
    };
  },
  name: 'adminDiscounts',
);

/// Cupones tras la búsqueda en memoria.
final Provider<List<AdminDiscount>> adminVisibleDiscountsProvider =
    Provider<List<AdminDiscount>>((Ref ref) {
  final List<AdminDiscount> all =
      ref.watch(adminDiscountsProvider).valueOrNull ?? const <AdminDiscount>[];
  final String needle =
      ref.watch(adminDiscountSearchProvider).trim().toLowerCase();
  if (needle.isEmpty) return all;
  return <AdminDiscount>[
    for (final AdminDiscount discount in all)
      if ('${discount.code} ${discount.name} ${discount.description ?? ''}'
          .toLowerCase()
          .contains(needle))
        discount,
  ];
}, name: 'adminVisibleDiscounts');

/// Alta, edición y baja de cupones.
final AsyncNotifierProvider<AdminDiscountController, void> adminDiscountProvider =
    AsyncNotifierProvider<AdminDiscountController, void>(
  AdminDiscountController.new,
);

/// Controla las acciones de cupón.
class AdminDiscountController extends AsyncNotifier<void> {
  @override
  FutureOr<void> build() {}

  /// `POST /discounts`.
  Future<bool> create(Map<String, dynamic> body) => _run(
        () => ref.read(adminDirectoryRepositoryProvider).createDiscount(body),
      );

  /// `PATCH /discounts/:id`. El `code` solo se cambia si nunca se usó.
  ///
  /// Se llama `updateDiscount` y no `update` a propósito: `AsyncNotifier` YA
  /// declara un `update` (el que envuelve una mutación y gestiona el error), así
  /// que un `update` propio aquí no valdría como override.
  Future<bool> updateDiscount(int discountId, Map<String, dynamic> body) => _run(
        () => ref
            .read(adminDirectoryRepositoryProvider)
            .updateDiscount(discountId, body),
      );

  /// `DELETE /discounts/:id`. Las redenciones históricas se conservan.
  Future<bool> delete(int discountId, {String? reason}) => _run(
        () => ref
            .read(adminDirectoryRepositoryProvider)
            .deleteDiscount(discountId, reason: reason),
      );

  Future<bool> _run(Future<Result<void>> Function() action) async {
    if (state.isLoading) return false;
    state = const AsyncLoading<void>();
    final Result<void> result = await action();
    // Sin guarda de disposal: `adminDiscountProvider` no es `autoDispose`, así que
    // el notifier sobrevive a cualquier `await`.
    switch (result) {
      case Success<void>():
        ref.invalidate(adminDiscountsProvider);
        state = const AsyncData<void>(null);
        return true;
      case FailureResult<void>(:final Failure failure):
        state = AsyncError<void>(failure, StackTrace.current);
        return false;
    }
  }

  void acknowledge() => state = const AsyncData<void>(null);
}

/// Resultado de `POST /discounts/validate`.
///
/// Un `isValid: false` NO es un fallo: el endpoint responde `200` porque es una
/// consulta. Por eso el resultado se modela aparte de `Result<T>` y el controlador
/// no lanza.
class DiscountValidation {
  const DiscountValidation({
    required this.isValid,
    this.name,
    this.discountMinor = 0,
    this.reason,
    this.cappedByMaxDiscount = false,
    this.remainingUses,
    this.minOrderMet = true,
  });

  final bool isValid;
  final String? name;

  /// Centavos que se aplicarían.
  final int discountMinor;

  /// Motivo de la invalidez, en texto del backend.
  final String? reason;

  final bool cappedByMaxDiscount;
  final int? remainingUses;
  final bool minOrderMet;

  /// Parseo tolerante de la respuesta de `validate`.
  static DiscountValidation fromJson(Map<String, dynamic> json) =>
      DiscountValidation(
        isValid: json['isValid'] == true,
        name: json['name'] is String ? json['name']! as String : null,
        discountMinor:
            json['discountMinor'] is int ? json['discountMinor']! as int : 0,
        reason: json['reason'] is String ? json['reason']! as String : null,
        cappedByMaxDiscount: json['cappedByMaxDiscount'] == true,
        remainingUses: json['remainingUses'] is int
            ? json['remainingUses']! as int
            : null,
        minOrderMet: json['minOrderMet'] != false,
      );
}

/// Valida un cupón contra un subtotal sin aplicarlo.
final FutureProviderFamily<DiscountValidation?, DiscountProbe>
    adminDiscountValidationProvider =
    FutureProvider.family<DiscountValidation?, DiscountProbe>(
  (Ref ref, DiscountProbe probe) async {
    if (probe.code.trim().length < 3) return null;
    final Result<Map<String, dynamic>> result = await ref
        .read(adminDirectoryRepositoryProvider)
        .validateDiscount(code: probe.code.trim().toUpperCase(),
            subtotalMinor: probe.subtotalMinor);
    return switch (result) {
      Success<Map<String, dynamic>>(:final Map<String, dynamic> value) =>
        DiscountValidation.fromJson(value),
      FailureResult<Map<String, dynamic>>() => null,
    };
  },
  name: 'adminDiscountValidation',
);

/// Parámetros de la validación: código y subtotal de referencia, en centavos.
class DiscountProbe {
  const DiscountProbe({required this.code, required this.subtotalMinor});

  final String code;
  final int subtotalMinor;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is DiscountProbe &&
          other.code == code &&
          other.subtotalMinor == subtotalMinor;

  @override
  int get hashCode => Object.hash(code, subtotalMinor);
}
