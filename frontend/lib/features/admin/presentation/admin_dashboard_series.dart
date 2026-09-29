// Series del dashboard. MÓDULO `features/admin/presentation`.
//
// Puntos de las series por día y por hora, y el top de productos. Se separan del
// catálogo de KPIs porque son TIPOS DE GRÁFICO, no métricas: cambian cuando cambia
// `fl_chart`, no cuando cambia un KPI.
//
// LOS PORCENTAJES DE ESTAS SERIES
// Ninguno de estos tipos trae porcentajes en basis points: los porcentajes del
// panel viven en `admin_dashboard_view.dart` (`chairOccupancyRateBp`) y en el
// reporte `chair-occupancy` (`utilizationPercent`, que YA es 0-100). Esa asimetría
// está documentada en ambos sitios a propósito: es un contrato del backend, no un
// descuido.

import 'package:flutter/foundation.dart';

import '../../../data/models/json_reader.dart';

/// Un punto de la serie diaria.
@immutable
class DailyPoint {
  const DailyPoint({
    required this.date,
    required this.orders,
    required this.totalMinor,
  });

  /// `YYYY-MM-DD`.
  final String date;
  final int orders;

  /// Centavos.
  final int totalMinor;

  /// Etiqueta corta del eje: el día del mes (`dd`).
  String get dayLabel {
    if (date.length < 10) return date;
    return date.substring(8, 10);
  }

  /// Etiqueta larga, para el tooltip y la tabla.
  ///
  /// `date` viene como `YYYY-MM-DD` en la zona horaria del NEGOCIO, que no
  /// siempre es la del navegador: por eso se parte el texto y no se pasa por
  /// `DateTime.parse`, que lo interpretaría en hora local y desplazaría el día un
  /// día entero.
  String get longLabel {
    if (date.length < 10) return date;
    return '${date.substring(8, 10)}/${date.substring(5, 7)}';
  }

  static List<DailyPoint> fromRows(List<Map<String, dynamic>> rows) {
    final List<DailyPoint> out = <DailyPoint>[];
    for (final Map<String, dynamic> row in rows) {
      // El backend agrupa por `date` o por `bucket` según el `groupBy`; se leen
      // los dos y se ignora el que falte, en vez de mostrar un día en blanco.
      final String date =
          JsonReader.stringOr(row['date'], JsonReader.stringOr(row['bucket'], ''));
      if (date.isEmpty) continue;
      out.add(DailyPoint(
        date: date,
        orders: JsonReader.integerOr(row['orders'], 0),
        totalMinor: JsonReader.integerOr(row['totalMinor'], 0),
      ));
    }
    // Orden cronológico: `YYYY-MM-DD` ordena lexicográficamente igual que por
    // fecha, y no hace falta construir objetos Date para comparar.
    out.sort((DailyPoint a, DailyPoint b) => a.date.compareTo(b.date));
    return out;
  }
}

/// Un punto de la serie por hora.
@immutable
class HourPoint {
  const HourPoint({required this.hour, required this.orders, required this.totalMinor});

  final int hour;
  final int orders;

  /// Centavos.
  final int totalMinor;

  /// Etiqueta del eje: `08:00`.
  String get label => '${hour.toString().padLeft(2, '0')}:00';

  static List<HourPoint> fromRows(List<Map<String, dynamic>> rows) {
    final List<HourPoint> out = <HourPoint>[];
    for (final Map<String, dynamic> row in rows) {
      final int? hour = JsonReader.integer(row['hour']);
      if (hour == null) continue;
      out.add(HourPoint(
        hour: hour,
        orders: JsonReader.integerOr(row['orders'], 0),
        totalMinor: JsonReader.integerOr(row['totalMinor'], 0),
      ));
    }
    // El backend devuelve las 24 horas siempre (las vacías en cero), pero si
    // alguna vez no llegan, ordenar deja el gráfico sin huecos raros.
    out.sort((HourPoint a, HourPoint b) => a.hour.compareTo(b.hour));
    return out;
  }
}

/// Una fila de "top productos".
@immutable
class TopProduct {
  const TopProduct({
    required this.productId,
    required this.name,
    this.sku,
    this.categoryName,
    this.quantity = 0,
    this.orders = 0,
    this.totalMinor = 0,
    this.rank = 0,
  });

  final int productId;
  final String name;
  final String? sku;
  final String? categoryName;
  final double quantity;
  final int orders;

  /// Centavos.
  final int totalMinor;
  final int rank;

  static List<TopProduct> fromRows(List<Map<String, dynamic>> rows) {
    final List<TopProduct> out = <TopProduct>[];
    for (final Map<String, dynamic> row in rows) {
      final int? id = JsonReader.integer(row['productId']);
      if (id == null) continue;
      out.add(TopProduct(
        productId: id,
        name: JsonReader.stringOr(row['name'], 'Producto $id'),
        sku: JsonReader.string(row['sku']),
        categoryName: JsonReader.string(row['categoryName']),
        quantity: JsonReader.integerOr(row['quantity'], 0).toDouble(),
        orders: JsonReader.integerOr(row['orders'], 0),
        totalMinor: JsonReader.integerOr(row['totalMinor'], 0),
        rank: JsonReader.integerOr(row['rank'], 0),
      ));
    }
    return out;
  }
}
