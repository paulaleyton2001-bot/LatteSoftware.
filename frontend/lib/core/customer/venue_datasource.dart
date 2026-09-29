// Lectura del local: sede activa y mapa de sillas. Módulo `core/customer`.
//
// POR QUÉ UN DATASOURCE EN `core/` Y NO EN UNA FEATURE
// `GET /chairs/map` lo consumen el checkout (elegir silla) y la pestaña «Silla»
// (ver el plano y mi alquiler). Las features no se importan entre sí, así que el
// datasource vive aquí, en la capa de lecturas compartidas del cliente, junto al
// modelo `ChairMap` que traduce su respuesta.
//
// Este archivo NO hace ninguna escritura: es solo lectura de referencia (sede y
// plano). Reservar, cotizar y pedir siguen en `features/checkout/data`, porque son
// acciones de negocio con sus propias reglas y sus propios fallos.
//
// No usa codegen: los `fromJson` son a mano, como en el resto del proyecto.


import 'package:dio/dio.dart';
import '../../data/models/json_reader.dart';
import '../network/api_client.dart';
import '../network/api_endpoints.dart';
import './chair_map.dart';

/// Llamadas HTTP de lectura del local.
class VenueRemoteDataSource {
  const VenueRemoteDataSource(this._dio);

  final Dio _dio;

  /// `GET /locations?isActive=true&pageSize=1&sort=name&order=asc`.
  ///
  /// Existe porque `GET /chairs/map` exige `locationId` en la query
  /// (`API.md` §7.7) y la app no lo tiene de otra parte: el `businessId` sale del
  /// token, la sede no.
  Future<int?> defaultLocationId() async {
    final Response<dynamic> response = await _dio.get<dynamic>(
      ApiEndpoints.locations,
      queryParameters: <String, dynamic>{
        'isActive': true,
        'pageSize': 1,
        'sort': 'name',
        'order': 'asc',
      },
    );
    final List<Map<String, dynamic>> rows = unwrapList(response.data);
    if (rows.isEmpty) return null;
    return JsonReader.integer(rows.first['id']);
  }

  /// `GET /chairs/map?locationId=...` — zonas, sillas, `countsByStatus` y
  /// `totals`: "todo lo necesario para pintar el plano sin cálculos adicionales".
  Future<ChairMap> chairMap(int locationId) async {
    final Response<dynamic> response = await _dio.get<dynamic>(
      ApiEndpoints.chairsMap,
      queryParameters: <String, dynamic>{'locationId': locationId},
    );
    return parseChairMap(unwrapData(response.data));
  }

  /// Mapa del local. `null` si el negocio no tiene ninguna sede activa.
  Future<ChairMap> chairMapOrEmpty() async {
    final int? locationId = await defaultLocationId();
    if (locationId == null) return const ChairMap.empty();
    return chairMap(locationId);
  }

  // ----------------------------------------------------------------- Parsers
  /// Mapa de sillas del local.
  static ChairMap parseChairMap(Map<String, dynamic> data) {
    final Map<String, dynamic> location = JsonReader.orEmpty(data['location']);
    final List<ZoneMap> zones = <ZoneMap>[];
    for (final Map<String, dynamic> row in JsonReader.mapList(data['zones'])) {
      final int? zoneId = JsonReader.integer(row['id']);
      if (zoneId == null) continue;
      final Map<String, dynamic> bounds = JsonReader.orEmpty(row['bounds']);
      final List<ChairInfo> chairs = <ChairInfo>[];
      for (final Map<String, dynamic> chairRow
          in JsonReader.mapList(row['chairs'])) {
        final ChairInfo? chair = parseChair(chairRow);
        if (chair != null) chairs.add(chair);
      }
      zones.add(ZoneMap(
        id: zoneId,
        name: JsonReader.stringOr(row['name'], 'Zona'),
        code: JsonReader.string(row['code']),
        colorHex: JsonReader.string(row['colorHex']),
        chairs: List<ChairInfo>.unmodifiable(chairs),
        minX: JsonReader.integerOr(bounds['minX'], 0),
        minY: JsonReader.integerOr(bounds['minY'], 0),
        maxX: JsonReader.integerOr(bounds['maxX'], 1),
        maxY: JsonReader.integerOr(bounds['maxY'], 1),
      ));
    }
    final Map<String, int> counts = <String, int>{};
    final Map<String, dynamic> rawCounts =
        JsonReader.orEmpty(data['countsByStatus']);
    for (final MapEntry<String, dynamic> entry in rawCounts.entries) {
      final int? value = JsonReader.integer(entry.value);
      if (value != null) counts[entry.key] = value;
    }
    return ChairMap(
      zones: List<ZoneMap>.unmodifiable(zones),
      locationId: JsonReader.integer(location['id']),
      locationName: JsonReader.string(location['name']),
      countsByStatus: Map<String, int>.unmodifiable(counts),
    );
  }

  /// Una silla del mapa. `null` si no trae `id` (obligatorio para poder
  /// seleccionarla y cotizarla).
  static ChairInfo? parseChair(Map<String, dynamic> json) {
    final int? id = JsonReader.integer(json['id']);
    if (id == null) return null;
    return ChairInfo(
      id: id,
      code: JsonReader.stringOr(json['code'], 'S$id'),
      status: JsonReader.stringOr(json['status'], 'AVAILABLE'),
      pricePerHourMinor: JsonReader.integerOr(json['pricePerHourMinor'], 0),
      zoneId: JsonReader.integer(json['zoneId']),
      zoneName: JsonReader.string(json['zoneName']),
      name: JsonReader.string(json['name']),
      numberLabel: JsonReader.string(json['numberLabel']),
      kind: JsonReader.stringOr(json['kind'], 'CHAIR'),
      capacity: JsonReader.integerOr(json['capacity'], 1),
      gridX: JsonReader.integerOr(json['gridX'], 0),
      gridY: JsonReader.integerOr(json['gridY'], 0),
      mapWidth: JsonReader.integerOr(json['mapWidth'], 1),
      mapHeight: JsonReader.integerOr(json['mapHeight'], 1),
      features: JsonReader.stringList(json['features']),
      isBookable: JsonReader.boolean(json['isBookable'], fallback: true),
      isActive: JsonReader.boolean(json['isActive'], fallback: true),
      statusChangedAt: JsonReader.dateTime(json['statusChangedAt']),
    );
  }
}
