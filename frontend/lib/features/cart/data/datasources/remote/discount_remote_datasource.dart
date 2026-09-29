// Datasource y repositorio del cupón. Módulo `features/cart/data`.
//
// `POST /discounts/validate` es una consulta disfrazada de escritura: el
// backend devuelve `200` con `isValid: false` cuando el cupón no vale, así que
// un `4xx` aquí es un problema real (código inexistente, red caída) y sí se
// traduce a `Failure`. La diferencia entre "no vale" y "no se pudo consultar"
// está en la UI y es importante: en el primer caso se corrige el código, en el
// segundo se reintenta.


import 'package:dio/dio.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../../core/network/api_endpoints.dart';
import '../../../../../data/models/json_reader.dart';
import '../../../domain/entities/coupon_quote.dart';

/// Llamadas HTTP a `/api/v1/discounts`.
class DiscountRemoteDataSource {
  const DiscountRemoteDataSource(this._dio);

  final Dio _dio;

  /// `POST /discounts/validate` → `200` con `isValid` (válido o no).
  Future<CouponQuote> validate({
    required String code,
    required int subtotalMinor,
    required List<Map<String, dynamic>> items,
    int? customerId,
  }) async {
    final Response<dynamic> response = await _dio.post<dynamic>(
      ApiEndpoints.discountsValidate,
      data: <String, dynamic>{
        'code': code.trim().toUpperCase(),
        'subtotalMinor': subtotalMinor,
        if (customerId != null) 'customerId': customerId,
        if (items.isNotEmpty) 'items': items,
      },
    );
    return _parse(unwrapData(response.data));
  }

  /// Lee la respuesta. Un cuerpo sin `isValid` se trata como no válido en vez de
  /// romper: un cupón que no se puede leer no debe tumbar el carrito.
  static CouponQuote _parse(Map<String, dynamic> data) {
    final bool isValid = JsonReader.boolean(data['isValid']);
    return CouponQuote(
      isValid: isValid,
      code: JsonReader.string(data['code']),
      name: JsonReader.string(data['name']),
      type: JsonReader.string(data['type']),
      value: JsonReader.integer(data['value']),
      applicableSubtotalMinor: JsonReader.integer(data['applicableSubtotalMinor']),
      discountMinor: JsonReader.integerOr(data['discountMinor'], 0),
      cappedByMaxDiscount: JsonReader.boolean(data['cappedByMaxDiscount']),
      remainingUses: JsonReader.integer(data['remainingUses']),
      minOrderMet: JsonReader.boolean(data['minOrderMet'], fallback: true),
      reason: JsonReader.string(data['reason']),
    );
  }
}
