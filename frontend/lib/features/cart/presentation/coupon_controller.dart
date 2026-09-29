// Estado de la validación del cupón.
//
// SEPARADO DE `CartController` POR UX: el cupón es una CONSULTA lenta (ida y
// vuelta al servidor) y su respuesta cambia en el sitio. Si su estado viviera en
// el carrito, escribir en el campo de texto reconstruiría la lista entera.
//
// `AsyncValue<CouponQuote>` cubre los tres casos que la pantalla distingue:
//   loading → el botón gira y el texto anterior sigue visible
//   error   → `FormErrorBanner` (sin red, sin permiso, backend caído)
//   data    → el veredicto: válido o no, con su `reason`



import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/customer/cart_state.dart';
import '../../../core/di/providers.dart';
import '../../../core/error/failures.dart';
import '../../../core/result/result.dart';
import '../data/datasources/remote/discount_remote_datasource.dart';
import '../data/repositories/discount_repository_impl.dart';
import '../domain/entities/coupon_quote.dart';

/// Repositorio de descuentos. Punto de inyección de la feature.
final Provider<DiscountRepository> discountRepositoryProvider =
    Provider<DiscountRepository>(
  (Ref ref) => DiscountRepositoryImpl(
    DiscountRemoteDataSource(ref.watch(apiClientProvider)),
  ),
  name: 'discountRepository',
);

/// Validación del cupón escrito por el cliente.
final AsyncNotifierProvider<CouponController, CouponQuote> couponProvider =
    AsyncNotifierProvider<CouponController, CouponQuote>(CouponController.new);

/// Controlador de la validación del cupón.
class CouponController extends AsyncNotifier<CouponQuote> {
  @override
  FutureOr<CouponQuote> build() => const CouponQuote(isValid: false);

  /// `POST /discounts/validate` con el carrito actual.
  ///
  /// `customerId` NO se manda: el backend lo deduce del token, y mandarlo es
  /// opcional (`API.md` §7.14). Mandarlo está prohibido en `businessId` pero no
  /// aquí; aun así, omitirlo es lo correcto: el cliente no decide su propia
  /// identidad.
  Future<void> validate(String code, CartState cart) async {
    final String normalized = code.trim();
    if (normalized.isEmpty) {
      state = const AsyncData<CouponQuote>(CouponQuote(isValid: false));
      return;
    }
    state = const AsyncLoading<CouponQuote>();
    final Result<CouponQuote> result =
        await ref.read(discountRepositoryProvider).validate(
              code: normalized,
              cart: cart,
            );
    // Sin guarda de disposal: `couponProvider` no es `autoDispose`, así que el
    // notifier sobrevive a la validación.
    state = switch (result) {
      Success<CouponQuote>(:final CouponQuote value) =>
        AsyncData<CouponQuote>(value),
      FailureResult<CouponQuote>(:final Failure failure) =>
        AsyncError<CouponQuote>(failure, StackTrace.current),
    };
  }

  /// Limpia el veredicto (al vaciar el carrito o cambiar de código).
  void reset() => state = const AsyncData<CouponQuote>(CouponQuote(isValid: false));
}
