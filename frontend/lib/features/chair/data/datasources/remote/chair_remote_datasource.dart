// Datasource de alquileres para la pestaña «Silla`. Módulo `features/chair/data`.
//
// `GET /rentals` es el endpoint que devuelve el alquiler VIVO con
// `startAt`/`endAt`, que es lo que alimenta el temporizador. La ventana de ±7
// días recorta la respuesta: un cliente no tiene cientos de alquileres y traerlos
// todos gastaría cuota para pintar uno.
//
// Un `CUSTOMER` solo ve los suyos: el service impone `customerId = auth.userId`
// (API.md §7.9), así que la app no manda el filtro ni puede ver los de otra
// persona aunque lo intentara.


import 'package:dio/dio.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../../core/network/api_endpoints.dart';
import '../../../../orders/domain/entities/rental.dart';

/// Llamadas HTTP a `/api/v1/rentals`.
class ChairRemoteDataSource {
  const ChairRemoteDataSource(this._dio);

  final Dio _dio;

  /// `GET /rentals?from=...&to=...&order=desc`.
  ///
  /// Sin `sort`: el orden por defecto de `GET /rentals` ya es `startAt desc`
  /// (ver `core/network/README.md`, "Orden de listados").
  Future<List<Rental>> myRentals() async {
    final DateTime now = DateTime.now().toUtc();
    final Response<dynamic> response = await _dio.get<dynamic>(
      ApiEndpoints.rentals,
      queryParameters: <String, dynamic>{
        'pageSize': 50,
        'order': 'desc',
        'from': now.subtract(const Duration(days: 7)).toIso8601String(),
        'to': now.add(const Duration(days: 7)).toIso8601String(),
      },
    );
    return <Rental>[
      for (final Map<String, dynamic> row in unwrapList(response.data))
        Rental.fromJson(row),
    ];
  }
}
