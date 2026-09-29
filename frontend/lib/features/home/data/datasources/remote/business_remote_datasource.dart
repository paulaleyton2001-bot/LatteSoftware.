// Datasource del negocio. Módulo `features/home/data`.
//
// DOS LECTURAS Y NADA MÁS
//   - `GET /business`       → configuración (nombre, `timezone`, precios por defecto)
//   - `GET /business/hours` → los 7 días de apertura
//
// NO HAY ESCRITURAS
// Cambiar la configuración del negocio es de `MANAGER`+ y lo hace el panel de
// administración, no la app del cliente.
//
// `GET /business/holidays` existe también, pero una cafetería con días festivos
// puntuales no es el caso de uso principal de esta pantalla: se avisaría con un
// banner en la home cuando el día de hoy sea festivo. Se deja fuera para no
// meter una tercera petición en el arranque.


import 'package:dio/dio.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../../core/network/api_endpoints.dart';
import '../../../../../data/models/json_reader.dart';
import '../../../domain/entities/business_status.dart';

/// Llamadas HTTP de `/api/v1/business`.
class BusinessRemoteDataSource {
  const BusinessRemoteDataSource(this._dio);

  final Dio _dio;

  /// `GET /business` + `GET /business/hours`.
  ///
  /// Se lanzan A LA VEZ (`Future.wait`) porque son independientes: el nombre del
  /// local no espera al horario, y ponerlos en serie retrasaría la pantalla de
  /// inicio el doble sin motivo.
  Future<BusinessStatus> status() async {
    final List<Response<dynamic>> results = await Future.wait<Response<dynamic>>(
      <Future<Response<dynamic>>>[
        _dio.get<dynamic>(ApiEndpoints.business),
        _dio.get<dynamic>(ApiEndpoints.businessHours),
      ],
    );

    final Map<String, dynamic> business = unwrapData(results[0].data);
    final List<Map<String, dynamic>> hoursRows = unwrapList(results[1].data);

    final String? name = JsonReader.string(business['name']);
    if (name == null) {
      throw const FormatException(
        'El servidor no devolvió la configuración del negocio.',
      );
    }

    return BusinessStatus(
      name: name,
      timezone: JsonReader.string(business['timezone']),
      city: JsonReader.string(business['city']),
      address: _addressOf(business),
      // `currencySymbol` viene de `businesses.currency_symbol`: el símbolo del
      // dinero es configuración del local, no una constante del cliente.
      currencySymbol: JsonReader.stringOr(business['currencySymbol'], r'$'),
      chairDefaultPriceMinor:
          JsonReader.integerOr(business['chairDefaultPriceMinor'], 0),
      maxReservationMinutes:
          JsonReader.integerOr(business['maxReservationMinutes'], 1440),
      orderPrefix: JsonReader.stringOr(business['orderPrefix'], 'ORD'),
      hours: _parseHours(hoursRows),
    );
  }

  /// `addressLine1` + `addressLine2`, unidos. `null` si no hay ninguno.
  static String? _addressOf(Map<String, dynamic> business) {
    final String? line1 = JsonReader.string(business['addressLine1']);
    final String? line2 = JsonReader.string(business['addressLine2']);
    if (line1 == null && line2 == null) return null;
    return <String?>[line1, line2].whereType<String>().join(', ');
  }

  /// 7 filas (`dayOfWeek` 0-6, `opensAt`/`closesAt` "HH:MM", `isClosed`). Una
  /// fila ilegible se descarta: es preferible un día sin dato (que se pinta como
  /// "horario no disponible") a un día con un horario inventado.
  static List<BusinessHours> _parseHours(List<Map<String, dynamic>> rows) {
    final List<BusinessHours> result = <BusinessHours>[];
    for (final Map<String, dynamic> row in rows) {
      final int? day = JsonReader.integer(row['dayOfWeek']);
      final String? opens = JsonReader.string(row['opensAt']);
      final String? closes = JsonReader.string(row['closesAt']);
      if (day == null || opens == null || closes == null) continue;
      result.add(BusinessHours(
        dayOfWeek: day,
        opensAt: opens,
        closesAt: closes,
        isClosed: JsonReader.boolean(row['isClosed']),
      ));
    }
    return List<BusinessHours>.unmodifiable(result);
  }
}
