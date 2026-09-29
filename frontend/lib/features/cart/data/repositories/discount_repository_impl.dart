// Repositorio del cupón. Módulo `features/cart/data`.
//
// NADA DE EXCEPCIONES: `Result<CouponQuote>` siempre. El cuerpo del POST se arma
// aquí y no en la datasource, porque necesita el carrito (un dato de la feature),
// y la datasource no debe saber qué es un carrito.

import '../../../../core/customer/cart_state.dart';
import '../../../../core/error/failures.dart';
import '../../../../core/network/api_exception.dart';
import '../../../../core/result/result.dart';
import '../../domain/entities/coupon_quote.dart';
import '../datasources/remote/discount_remote_datasource.dart';
/// Repositorio de descuentos sobre el datasource remoto.
class DiscountRepositoryImpl implements DiscountRepository {
  const DiscountRepositoryImpl(this._remote);

  final DiscountRemoteDataSource _remote;

  @override
  Future<Result<CouponQuote>> validate({
    required String code,
    required CartState cart,
  }) async {
    final String normalized = code.trim().toUpperCase();
    if (normalized.isEmpty) {
      return const FailureResult<CouponQuote>(ValidationFailure(
        message: 'Escribe un código de cupón para validarlo.',
      ));
    }
    try {
      final CouponQuote quote = await _remote.validate(
        code: normalized,
        subtotalMinor: cart.estimatedSubtotalMinor,
        items: _itemsOf(cart),
      );
      return Success<CouponQuote>(quote);
    } on Object catch (error) {
      return FailureResult<CouponQuote>(ApiException.toFailure(error));
    }
  }

  /// `items[]` con la forma que espera `POST /discounts/validate`:
  /// `{ productId, categoryId, quantity, unitPriceMinor }`.
  ///
  /// `categoryId` no puede ser `null`: el esquema es `.strict()` (API.md §1) y
  /// un `null` explícito lo rechazaría. Se omite la clave cuando no se sabe la
  /// categoría, que es lo que permite el propio `API.md` ("necesario para
  /// `appliesTo != ALL`", y dentro de cada item solo si aplica).
  static List<Map<String, dynamic>> _itemsOf(CartState cart) =>
      <Map<String, dynamic>>[
        for (final CartLine line in cart.lines)
          <String, dynamic>{
            'productId': line.productId,
            'quantity': line.quantity,
            'unitPriceMinor': line.unitPriceMinor,
          },
      ];
}
