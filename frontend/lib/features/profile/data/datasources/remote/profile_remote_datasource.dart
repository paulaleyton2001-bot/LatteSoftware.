// Datasource remoto del perfil. Módulo `features/profile/data`.
//
// SOLO LECTURAS Y ESCRITURAS DE CUENTA, NO DE NEGOCIO
//   - `GET /customers/me`            → estadísticas del cliente
//   - `GET /reservations?customerId=` → sus reservas
//   - `GET/PUT /notifications/preferences` → preferencias de aviso
//
// El perfil en sí (`GET /auth/me`, `PATCH /auth/me`, sesiones, cambio de
// contraseña) YA lo resuelve `features/auth` con su repositorio: duplicarlo aquí
// sería tener dos fuentes para el mismo endpoint y dos lugares donde corregir un
// cambio de contraseña.
//
// `GET /customers/me` está en el endpoint público de auth (`autenticado`), así que
// NO necesita `customers:read`: cualquier usuario con token puede leer su propio
// perfil de cliente.


import 'package:dio/dio.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../../core/network/api_endpoints.dart';
import '../../../../../data/models/json_reader.dart';
import '../../../domain/entities/customer_stats.dart';

/// Llamadas HTTP del perfil del cliente.
class ProfileRemoteDataSource {
  const ProfileRemoteDataSource(this._dio);

  final Dio _dio;

  /// `GET /customers/me` → `{ ...User, stats: {...} }`.
  ///
  /// Un `404` NO es un error de la app: el backend responde así, a propósito,
  /// cuando el actor no tiene ficha de cliente (un `ADMIN` o un empleado de
  /// mostrador la tiene en `GET /auth/me`, no en el directorio de clientes:
  /// `backend/src/modules/customers/customers.service.ts`). Sin este degradado,
  /// el perfil de cualquier cuenta de personal abría con un «El cliente no
  /// existe» en rojo encima de unos ceros que además son correctos.
  /// Cualquier otro error sube al repositorio, que lo mapea a `Failure`.
  Future<CustomerStats> myStats() async {
    try {
      final Response<dynamic> response = await _dio.get<dynamic>(
        ApiEndpoints.customersMe,
      );
      final Map<String, dynamic> data = unwrapData(response.data);
      return CustomerStats.fromJson(JsonReader.orEmpty(data['stats']));
    } on DioException catch (error) {
      if (error.response?.statusCode == 404) return const CustomerStats();
      rethrow;
    }
  }

  /// `GET /reservations?customerId=:id` — reservas del cliente.
  ///
  /// La ventana de ±(30/90) días acota la respuesta: nadie quiere ver reservas
  /// de hace dos años, y traerlas todas sería gastar cuota para pintar una lista
  /// interminable.
  ///
  /// POR QUÉ NO `GET /customers/:id/reservations`
  /// Ese endpoint está en `docs/API.md` §7.3 pero NO existe en el backend
  /// (responde `404 NOT_FOUND_ERROR`, brecha que el propio backend documenta).
  /// `GET /reservations` acepta `customerId` y el service lo sobrescribe con el
  /// id del token cuando el actor es un `CUSTOMER` (API.md §9.3). Sin `sort`,
  /// porque el defecto del endpoint ya es `startAt desc` (ver
  /// `core/network/README.md`, "Orden de listados").
  Future<List<CustomerReservation>> reservations(int customerId) async {
    final DateTime now = DateTime.now().toUtc();
    final Response<dynamic> response = await _dio.get<dynamic>(
      ApiEndpoints.reservations,
      queryParameters: <String, dynamic>{
        'pageSize': 50,
        'order': 'desc',
        'from': now.subtract(const Duration(days: 30)).toIso8601String(),
        'to': now.add(const Duration(days: 90)).toIso8601String(),
        'customerId': customerId,
      },
    );
    return <CustomerReservation>[
      for (final Map<String, dynamic> row in unwrapList(response.data))
        CustomerReservation.fromJson(row),
    ];
  }

  /// `GET /notifications/preferences` — preferencias de aviso.
  ///
  /// El backend CREA la fila con los defaults si no existe (BR-NOTIF-005), así
  /// que este GET nunca falla por "no hay preferencias": siempre hay una
  /// respuesta con valores.
  Future<NotificationPreferences> notificationPreferences() async {
    final Response<dynamic> response = await _dio.get<dynamic>(
      ApiEndpoints.notificationPreferences,
    );
    return NotificationPreferences.fromJson(unwrapData(response.data));
  }

  /// `PUT /notifications/preferences` — guarda las preferencias.
  Future<NotificationPreferences> updateNotificationPreferences(
    Map<String, dynamic> body,
  ) async {
    final Response<dynamic> response = await _dio.put<dynamic>(
      ApiEndpoints.notificationPreferences,
      data: body,
    );
    return NotificationPreferences.fromJson(unwrapData(response.data));
  }
}
