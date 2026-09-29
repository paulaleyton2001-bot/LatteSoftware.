// Sillas y mapa del local. Módulo `core/customer`.

import 'package:flutter/foundation.dart';
//
// POR QUÉ VIVE EN `core/` Y NO EN UNA FEATURE
// El mapa lo necesitan el checkout (elegir silla) y la pestaña «Silla» (ver qué
// hay libre y cuál es la tuya), y las features no se importan entre sí. Es el
// mismo argumento que el carrito: si el modelo vive en la feature que lo pintó
// primero, la segunda tiene que duplicarlo o importarla, y las dos opciones están
// mal. `core/customer` es la capa de lecturas del cliente que comparten varias
// features; no conoce widgets ni el dominio del pedido.
//
// El mapa se pinta con lo que devuelve `GET /chairs/map` (API.md §7.7), que trae
// `zones[]` con `bounds` y `chairs[]`, más `countsByStatus` y `totals`: "todo lo
// necesario para pintar el plano sin cálculos adicionales en el cliente".
//
// EL ESTADO NUNCA SE COMUNICA SOLO CON COLOR
// Cada silla lleva texto + ícono + color (`StatusBadge.chair` y, en la celda del
// mapa, la superficie del estado con la etiqueta dentro). Con ~8 % de hombres
// con daltonismo rojo/verde, "ocupada" y "disponible" son indistinguibles sin
// forma, y leer mal significa cobrar o no cobrar (docs/DESIGN-TOKENS §6.1).


/// Silla del mapa (`Chair` de API.md §6.3).
@immutable
class ChairInfo {
  const ChairInfo({
    required this.id,
    required this.code,
    required this.status,
    required this.pricePerHourMinor,
    this.zoneId,
    this.zoneName,
    this.name,
    this.numberLabel,
    this.kind = 'CHAIR',
    this.capacity = 1,
    this.gridX = 0,
    this.gridY = 0,
    this.mapWidth = 1,
    this.mapHeight = 1,
    this.features = const <String>[],
    this.isBookable = true,
    this.isActive = true,
    this.statusChangedAt,
  });

  final int id;

  /// Código único global (`CHAIR_CODE_IMMUTABLE`).
  final String code;

  /// `ChairStatus` (API.md §6.2).
  final String status;

  /// Precio por hora en centavos. Lo congela el servidor al crear el alquiler
  /// (BR-PRICE-010), así que este valor es solo para mostrarlo.
  final int pricePerHourMinor;

  final int? zoneId;
  final String? zoneName;
  final String? name;

  /// Etiqueta corta para pintar en la celda (`"A3"`, `"Barra 2"`).
  final String? numberLabel;

  /// `ChairKind`: `CHAIR`, `TABLE`, `COUNTER`, `AREA`.
  final String kind;

  final int capacity;

  /// Coordenadas en la grilla normalizada (0-1000 en la API).
  final int gridX;
  final int gridY;
  final int mapWidth;
  final int mapHeight;

  final List<String> features;
  final bool isBookable;
  final bool isActive;
  final DateTime? statusChangedAt;

  /// Etiqueta visible en la celda del mapa: la del negocio si existe, si no el
  /// código. Nunca vacío: una celda sin nombre es un rompecabezas.
  String get cellLabel {
    final String? label = numberLabel?.trim();
    if (label != null && label.isNotEmpty) return label;
    final String? chairName = name?.trim();
    if (chairName != null && chairName.isNotEmpty) return chairName;
    return code;
  }

  /// `true` si se puede seleccionar en el checkout: activa, reservable y libre.
  ///
  /// `RESERVED` se EXCLUYE a propósito: hay una reserva confirmada para otra
  /// franja y el cliente no puede tomar esa ventana. Si el servidor dice que hay
  /// hueco, es porque la reserva es de otro horario.
  bool get isSelectable =>
      isActive && isBookable && (status == 'AVAILABLE' || status == 'RESERVED');

  /// `true` si se puede walking-in (usar la silla ahora mismo).
  bool get isFreeNow => isActive && status == 'AVAILABLE';

  /// `true` si está ocupada ahora mismo (ocupa la silla, no la tiene reservada
  /// para más tarde).
  bool get isOccupiedNow => status == 'OCCUPIED';

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ChairInfo &&
          other.id == id &&
          other.status == status &&
          other.pricePerHourMinor == pricePerHourMinor;

  @override
  int get hashCode => Object.hash(id, status, pricePerHourMinor);

  @override
  String toString() => 'ChairInfo($code, $status)';
}

/// Zona con sus sillas y sus límites en la grilla.
@immutable
class ZoneMap {
  const ZoneMap({
    required this.id,
    required this.name,
    required this.chairs,
    this.code,
    this.colorHex,
    this.minX = 0,
    this.minY = 0,
    this.maxX = 1,
    this.maxY = 1,
  });

  final int id;
  final String name;
  final String? code;

  /// `colorHex` del negocio (`^#[0-9A-Fa-f]{6}$`). NO se pinta: el color de una
  /// zona lo elige el negocio y la app no puede garantizar contraste con texto
  /// encima. Se usa solo como dato, no como estilo.
  final String? colorHex;

  final List<ChairInfo> chairs;

  final int minX;
  final int minY;
  final int maxX;
  final int maxY;

  /// Sillas libres ahora mismo en la zona.
  int get availableCount => chairs.where((ChairInfo c) => c.isFreeNow).length;

  @override
  String toString() => 'ZoneMap($id, $name, ${chairs.length} sillas)';
}

/// Mapa completo del local (`GET /chairs/map`).
@immutable
class ChairMap {
  const ChairMap({
    required this.zones,
    this.locationId,
    this.locationName,
    this.countsByStatus = const <String, int>{},
  });

  const ChairMap.empty()
      : zones = const <ZoneMap>[],
        locationId = null,
        locationName = null,
        countsByStatus = const <String, int>{};

  final List<ZoneMap> zones;
  final int? locationId;
  final String? locationName;

  /// `{ AVAILABLE: 12, OCCUPIED: 3, ... }`.
  final Map<String, int> countsByStatus;

  bool get isEmpty => zones.isEmpty;

  /// Todas las sillas, en orden de aparición.
  List<ChairInfo> get allChairs => <ChairInfo>[
        for (final ZoneMap zone in zones) ...zone.chairs,
      ];

  /// Ancho y alto de la grilla normalizada del conjunto (para escalar el mapa).
  int get maxX {
    int value = 1;
    for (final ZoneMap zone in zones) {
      if (zone.maxX > value) value = zone.maxX;
    }
    return value;
  }

  int get maxY {
    int value = 1;
    for (final ZoneMap zone in zones) {
      if (zone.maxY > value) value = zone.maxY;
    }
    return value;
  }

  /// Sillas libres ahora mismo, para el titular "N disponibles".
  int get availableCount => allChairs.where((ChairInfo c) => c.isFreeNow).length;

  ChairInfo? byId(int chairId) {
    for (final ChairInfo chair in allChairs) {
      if (chair.id == chairId) return chair;
    }
    return null;
  }

  @override
  String toString() =>
      'ChairMap(${zones.length} zonas, ${allChairs.length} sillas)';
}
