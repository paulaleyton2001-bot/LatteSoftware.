// Cotización de cupón (`POST /api/v1/discounts/validate`).
//
// POR QUÉ `POST /discounts/validate` Y NO APLICAR EL CUPÓN AQUÍ
// El endpoint es una PREVISUALIZACIÓN: no crea nada y devuelve `200` incluso si
// el cupón no vale (con `isValid: false` y `reason`). El descuento real lo aplica
// el servidor dentro de `POST /orders` (BR-DISC-001). Aquí solo se muestra lo que
// el servidor responde, sin inventar aritmética de descuentos en el cliente.
//
// `items[]` es necesario cuando `appliesTo != ALL` (API.md §7.14): se envían los
// productos del carrito con su categoría, precio y cantidad para que el backend
// pueda decidir si el cupón aplica a lo que se lleva realmente el cliente.


import '../../../../core/customer/cart_state.dart';
import '../../../../core/result/result.dart';
import '../../../../core/utils/currency_formatter.dart';

/// Resultado de validar un cupón.
class CouponQuote {
  const CouponQuote({
    required this.isValid,
    this.code,
    this.name,
    this.type,
    this.value,
    this.applicableSubtotalMinor,
    this.discountMinor = 0,
    this.cappedByMaxDiscount = false,
    this.remainingUses,
    this.minOrderMet = false,
    this.reason,
  });

  /// `false` = el cupón existe pero no se puede aplicar. NO es un error: es una
  /// respuesta válida de una consulta, y por eso `reason` va en el modelo y no
  /// en un `Failure`.
  final bool isValid;

  final String? code;
  final String? name;

  /// `DiscountType`: `PERCENT` o `FIXED`.
  final String? type;

  /// Valor del descuento: puntos básicos si es `PERCENT`, centavos si es `FIXED`.
  final int? value;

  final int? applicableSubtotalMinor;

  /// Descuento en centavos que el servidor calcula.
  final int discountMinor;

  /// `true` si el descuento se recortó por `maxDiscountMinor`.
  final bool cappedByMaxDiscount;

  /// Usos que le quedan al cliente (`null` = ilimitado).
  final int? remainingUses;

  final bool minOrderMet;

  /// Motivo en español de por qué no es válido. Apto para pintar tal cual.
  final String? reason;

  /// Texto para el usuario final, sea válido o no.
  String describe() {
    if (!isValid) return reason ?? 'Ese cupón no se puede aplicar.';
    final String label = name == null || name!.isEmpty ? (code ?? '') : name!;
    final String discount = _describeValue();
    if (remainingUses != null && remainingUses! <= 0) {
      return 'Ya usaste este cupón las veces permitidas.';
    }
    return 'Cupón válido: $label$discount.';
  }

  /// `10%` o `$1.000`, según el tipo. El texto se compone con el helper de
  /// moneda para no escribir `'$' a mano`.
  String _describeValue() {
    final int? raw = value;
    if (raw == null) return '';
    if (type == 'PERCENT') {
      // `value` está en puntos básicos: 1500 = 15,00 %.
      return ' (${(raw / 100).toStringAsFixed(raw % 100 == 0 ? 0 : 2)}%)';
    }
    return ' (${CurrencyFormatter.formatMinor(raw)})';
  }
}

/// Contrato de validación de cupones.
abstract interface class DiscountRepository {
  /// `POST /discounts/validate`.
  ///
  /// [cart] se usa para mandar `items[]` (necesario si el cupón aplica a una
  /// categoría o a un producto concreto) y el subtotal ya conocido.
  Future<Result<CouponQuote>> validate({
    required String code,
    required CartState cart,
  });
}
