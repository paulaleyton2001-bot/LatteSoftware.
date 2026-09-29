// Llamadas HTTP de la configuración del negocio. MÓDULO `features/admin/data`.
//
// Verifica contra `backend/src/modules/business/business.routes.ts`.
//
// ⚠️ DISCREPANCIA CON `docs/API.md`
// `GET /business/status` EXISTE en el backend (línea 113 de `business.routes.ts`),
// es PÚBLICA y sirve para saber si el local está abierto ahora, pero API.md §7.4
// NO lo documenta. Aquí se declara como desviación, no como endpoint inventado.
//
// PERMISOS: NO INVENTADOS
// El enunciado mencionaba `business:manage`, clave que NO existe en
// `shared/domain/permissions.ts`. El catálogo real es una clave por acción:
// `business:update`, `business:hours:update`, `business:holidays:manage`. Son las
// que se comprueban aquí y las que devuelve `GET /auth/me.permissions`.

import 'package:dio/dio.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../../core/network/api_endpoints.dart';
import '../../../../../data/models/json_reader.dart';
import '../../../domain/entities/admin_business.dart';

/// Datasource de la configuración del negocio.
class AdminBusinessDataSource {
  const AdminBusinessDataSource(this._dio);

  final Dio _dio;

  /// `GET /business` — configuración completa.
  ///
  /// Sin token devuelve solo la proyección pública; con token y `business:read`
  /// llega la fiscal. Por eso esta ruta NO está en `ApiEndpoints.publicPaths`: si
  /// lo estuviera, el interceptor saltaría el Bearer y la pantalla de Ajustes
  /// mostraría campos vacíos sin avisar de por qué.
  Future<AdminBusiness> business() async {
    final Response<dynamic> response =
        await _dio.get<dynamic>(ApiEndpoints.business);
    return AdminBusiness.tryParse(unwrapData(response.data));
  }

  /// `GET /business/status` — ¿abierto ahora? DESVIACIÓN DOCUMENTADA.
  ///
  /// Devuelve algo como `{ isOpen, openedAt, closesAt, currentDayOfWeek }`. Se
  /// devuelve crudo porque la pantalla solo lo muestra; si el backend cambia la
  /// forma, la app se queda sin el aviso en vez de mentir.
  Future<Map<String, dynamic>> status() async {
    final Response<dynamic> response =
        await _dio.get<dynamic>(ApiEndpoints.businessStatus);
    return unwrapData(response.data);
  }

  /// `PATCH /business` — actualización parcial.
  ///
  /// Se manda SOLO lo que el formulario cambió. El backend rechaza `id` con `400
  /// UNKNOWN_FIELD` y bloquea cambiar `currencyCode` con pedidos ya creados
  /// (`409 CURRENCY_CHANGE_BLOCKED`), así que la moneda va de solo lectura cuando
  /// el negocio ya vendió.
  ///
  /// `defaultTipsBp` viaja como `string[]` (API.md §7.4), no como `int[]`, y el
  /// formulario ya lo entrega así. Aquí solo se filtra lo que no sea un número
  /// entero válido, porque el esquema del backend es `int` en cadena y un `"abc"`
  /// sería un `400` de la llamada entera.
  Future<AdminBusiness> updateBusiness(Map<String, dynamic> body) async {
    final Response<dynamic> response = await _dio.patch<dynamic>(
      ApiEndpoints.business,
      data: <String, dynamic>{
        for (final MapEntry<String, dynamic> entry in body.entries)
          if (entry.key == 'defaultTipsBp')
            'defaultTipsBp': <String>[
              for (final String tip in JsonReader.stringList(entry.value))
                if (int.tryParse(tip) != null) tip,
            ]
          else
            entry.key: entry.value,
      },
    );
    return AdminBusiness.tryParse(unwrapData(response.data));
  }

  /// `GET /business/hours` — SIEMPRE siete filas (las crea el seed).
  Future<List<AdminBusinessHour>> hours() async {
    final Response<dynamic> response =
        await _dio.get<dynamic>(ApiEndpoints.businessHours);
    return <AdminBusinessHour>[
      for (final Map<String, dynamic> row in unwrapList(response.data))
        AdminBusinessHour.tryParse(row),
    ]..sort((AdminBusinessHour a, AdminBusinessHour b) =>
        a.dayOfWeek.compareTo(b.dayOfWeek));
  }

  /// `PUT /business/hours` — reemplaza la semana COMPLETA.
  ///
  /// El body exige exactamente 7 objetos, uno por `dayOfWeek`, sin repetidos: con
  /// menos da `400 INCOMPLETE_WEEK`. Por eso el controlador rellena los días que
  /// faltan con un horario por defecto en vez de mandar solo los editados.
  Future<List<AdminBusinessHour>> replaceHours(
    List<AdminBusinessHour> hours,
  ) async {
    final Response<dynamic> response = await _dio.put<dynamic>(
      ApiEndpoints.businessHours,
      data: <String, dynamic>{
        'hours': <Map<String, dynamic>>[
          for (final AdminBusinessHour hour in hours) hour.toBody(),
        ],
      },
    );
    return <AdminBusinessHour>[
      for (final Map<String, dynamic> row in unwrapList(response.data))
        AdminBusinessHour.tryParse(row),
    ]..sort((AdminBusinessHour a, AdminBusinessHour b) =>
        a.dayOfWeek.compareTo(b.dayOfWeek));
  }

  /// `GET /business/holidays` — festivos.
  Future<List<AdminHoliday>> holidays({bool includePast = false}) async {
    final Response<dynamic> response = await _dio.get<dynamic>(
      ApiEndpoints.businessHolidays,
      queryParameters: <String, dynamic>{'includePast': includePast},
    );
    final List<AdminHoliday> out = <AdminHoliday>[];
    for (final Map<String, dynamic> row in unwrapList(response.data)) {
      final AdminHoliday? holiday = AdminHoliday.tryParse(row);
      if (holiday != null) out.add(holiday);
    }
    return out;
  }

  /// `POST /business/holidays` — alta de festivo. `holidayDate` es `YYYY-MM-DD`.
  Future<void> createHoliday({
    required String holidayDate,
    required String name,
    bool isClosed = true,
  }) async {
    await _dio.post<dynamic>(
      ApiEndpoints.businessHolidays,
      data: <String, dynamic>{
        'holidayDate': holidayDate,
        'name': name,
        'isClosed': isClosed,
      },
    );
  }

  /// `DELETE /business/holidays/:id` — baja de festivo.
  Future<void> deleteHoliday(int holidayId) async {
    await _dio.delete<dynamic>('${ApiEndpoints.businessHolidays}/$holidayId');
  }

  /// `GET /meta/roles` — roles con sus ids y permisos. PÚBLICA.
  ///
  /// La UI la necesita porque `POST /users/:id/roles` exige `roleId` (el ID), y
  /// `GET /users/:id` devuelve los roles por NOMBRE. Sin esta llamada no se puede
  /// asignar un rol, y sin ella la app tendría que inventar los ids.
  Future<List<Map<String, dynamic>>> roles() async {
    final Response<dynamic> response =
        await _dio.get<dynamic>(ApiEndpoints.metaRoles);
    final Map<String, dynamic> data = unwrapData(response.data);
    // El backend puede devolver `{ roles: [...] }` o el array plano; se aceptan
    // los dos sin asumir cuál es el bueno.
    final List<Map<String, dynamic>> rows = data['roles'] is List
        ? JsonReader.mapList(data['roles'])
        : unwrapList(response.data);
    return rows;
  }
}
