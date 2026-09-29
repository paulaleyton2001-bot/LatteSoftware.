// Vista del dashboard: convierte basis points en porcentajes y agrupa los KPIs.
//
// ⚠️ LA REGLA DE LOS PORCENTAJES, EN UN SOLO SITIO
// `chairOccupancyRate` y `utilizationBp` llegan como ENTEROS EN BASIS POINTS:
// 4567 = 45,67 %. Es decir, hay que DIVIDIR POR 100. Asumir que vienen en 0-100
// pinta un 4567 % que no cabe en un anillo ni en una etiqueta, y el error es
// invisible a simple vista (un `FittedBox` lo encoge y parece un número normal).
//
// Por eso TODA conversión vive en este archivo y en ningún otro: si el backend
// cambiara la unidad, se corrige un sitio. `AdminDashboardKpis` conserva el entero
// crudo, tal como llegó, y solo `DashboardKpi` lo divide para pintar.
//
// OTRAS CONVERSIONES QUE TAMBIEN SON TRAMPAS
//   - `percentChange` es un `number` con signo, no basis points: -12.5 = un 12,5 %
//     DE CAÍDA. Se pinta con signo y flecha, no como fracción.
//   - `totalMinor` es CENTAVOS. Se formatea con `CurrencyFormatter`.

import 'package:flutter/foundation.dart';

import '../../../core/utils/currency_formatter.dart';
import '../../../data/models/json_reader.dart';

/// KPIs del día, con los valores CRUDOS del backend.
@immutable
class AdminDashboardKpis {
  const AdminDashboardKpis({
    this.totalOrders = 0,
    this.totalItems = 0,
    this.grossSalesMinor = 0,
    this.netSalesMinor = 0,
    this.averageTicketMinor = 0,
    this.totalDiscountMinor = 0,
    this.totalTaxMinor = 0,
    this.totalTipsMinor = 0,
    this.refundedMinor = 0,
    this.ordersCancelled = 0,
    this.newCustomers = 0,
    this.activeRentals = 0,
    this.rentalRevenueMinor = 0,
    this.inventoryAlertsCount = 0,

    /// BASIS POINTS CRUOS. 4567 = 45,67 %. No usar sin dividir.
    this.chairOccupancyRateBp = 0,
  });

  final int totalOrders;
  final int totalItems;
  final int grossSalesMinor;
  final int netSalesMinor;
  final int averageTicketMinor;
  final int totalDiscountMinor;
  final int totalTaxMinor;
  final int totalTipsMinor;
  final int refundedMinor;
  final int ordersCancelled;
  final int newCustomers;
  final int activeRentals;
  final int rentalRevenueMinor;
  final int inventoryAlertsCount;

  /// Basis points TAL COMO LLEGAN del backend.
  final int chairOccupancyRateBp;

  /// Ocupación como porcentaje (0-100), lista para pintar.
  double get chairOccupancyPercent => bpToPercent(chairOccupancyRateBp);



  /// Parseo tolerante de `data.kpis` de `GET /reports/dashboard`.
  static AdminDashboardKpis fromJson(Map<String, dynamic> json) {
    return AdminDashboardKpis(
      totalOrders: JsonReader.integerOr(json['totalOrders'], 0),
      totalItems: JsonReader.integerOr(json['totalItems'], 0),
      grossSalesMinor: JsonReader.integerOr(json['grossSalesMinor'], 0),
      netSalesMinor: JsonReader.integerOr(json['netSalesMinor'], 0),
      averageTicketMinor: JsonReader.integerOr(json['averageTicketMinor'], 0),
      totalDiscountMinor: JsonReader.integerOr(json['totalDiscountMinor'], 0),
      totalTaxMinor: JsonReader.integerOr(json['totalTaxMinor'], 0),
      totalTipsMinor: JsonReader.integerOr(json['totalTipsMinor'], 0),
      refundedMinor: JsonReader.integerOr(json['refundedMinor'], 0),
      ordersCancelled: JsonReader.integerOr(json['ordersCancelled'], 0),
      newCustomers: JsonReader.integerOr(json['newCustomers'], 0),
      activeRentals: JsonReader.integerOr(json['activeRentals'], 0),
      rentalRevenueMinor: JsonReader.integerOr(json['rentalRevenueMinor'], 0),
      inventoryAlertsCount: JsonReader.integerOr(json['inventoryAlertsCount'], 0),
      chairOccupancyRateBp: JsonReader.integerOr(json['chairOccupancyRate'], 0),
    );
  }

  /// Datos de `currentSpaces` (`GET /reports/dashboard`).
  static SpaceCounts spacesFrom(Map<String, dynamic> data) => SpaceCounts(
        total: JsonReader.integerOr(data['total'], 0),
        available: JsonReader.integerOr(data['available'], 0),
        occupied: JsonReader.integerOr(data['occupied'], 0),
        reserved: JsonReader.integerOr(data['reserved'], 0),
        blocked: JsonReader.integerOr(data['blocked'], 0),
        maintenance: JsonReader.integerOr(data['maintenance'], 0),
        cleaning: JsonReader.integerOr(data['cleaning'], 0),
      );
}

/// Recuento de sillas por estado (`data.currentSpaces` del dashboard).
///
/// ⚠️ NO ES LO MISMO QUE `AdminSpaceCountsLegend`
/// La leyenda de `widgets/admin_space_counts.dart` lee `countsByStatus` de
/// `GET /chairs/map` (un `Map<String, int>`); estos campos vienen anidados en el
/// resumen del dashboard. Son dos formas de lo mismo en endpoints distintos, y un
/// tipo único que aceptara las dos quedaría lleno de ceros en uno de los dos.
@immutable
class SpaceCounts {
  const SpaceCounts({
    this.total = 0,
    this.available = 0,
    this.occupied = 0,
    this.reserved = 0,
    this.blocked = 0,
    this.maintenance = 0,
    this.cleaning = 0,
  });

  final int total;
  final int available;
  final int occupied;
  final int reserved;
  final int blocked;
  final int maintenance;
  final int cleaning;

  /// Las que un cliente puede tomar AHORA: libres y en limpieza. Las bloqueadas y
  /// en mantenimiento no son oferta, aunque no estén ocupadas, así que contarlas
  /// como disponíveis prometería una silla que nadie puede sentar.
  int get bookable => available + cleaning;

  /// `0-100`. Usa [total] como denominador para no prometer sobre plazas que el
  /// backend ni siquiera cuenta.
  double get occupancyPercent =>
      total == 0 ? 0 : ((occupied + reserved) / total * 100).clamp(0, 100);
}

/// Comparación contra el periodo anterior (`data.comparison.vsPreviousPeriod`).
///
/// ⚠️ `percentChange` VIENE EN 0-100 Y CON SIGNO, NO EN BASIS POINTS
/// `-12.5` significa "un 12,5 % DE CAÍDA". Por eso no se divide por 100 aquí: se
/// pinta con el signo que pone `KpiTile` y quien lo lee compara magnitudes.
@immutable
class DashboardComparison {
  const DashboardComparison({
    this.percentChange,
    this.previousNetSalesMinor = 0,
    this.currentNetSalesMinor = 0,
  });

  /// Variación en porcentaje CON signo. `null` = el backend no devolvió periodo
  /// anterior (negocio nuevo): la UI dice "sin periodo anterior", no "0 %".
  final double? percentChange;

  final int previousNetSalesMinor;
  final int currentNetSalesMinor;

  /// `false` cuando no hay con qué comparar. Un local recién abierto no tiene
  /// periodo anterior, y fingir un 0 % sería mentir sobre la tendencia.
  bool get hasData => percentChange != null;

  static DashboardComparison fromJson(Map<String, dynamic> json) {
    return DashboardComparison(
      percentChange: _percentChange(json['percentChange']),
      previousNetSalesMinor:
          JsonReader.integerOr(json['previousNetSalesMinor'], 0),
      currentNetSalesMinor:
          JsonReader.integerOr(json['currentNetSalesMinor'], 0),
    );
  }

  /// Acepta `num` o cadena numérica; cualquier otra cosa (incluido un `NaN` de
  /// una división por cero del backend) se trata como "sin dato".
  static double? _percentChange(Object? value) {
    if (value is num) {
      if (value.isNaN || value.isInfinite) return null;
      return value.toDouble();
    }
    if (value is String) return double.tryParse(value);
    return null;
  }
}

/// Formatea un porcentaje 0-100 para un KPI: `45,7 %`.
///
/// Sin decimales cuando el número es entero, que es el caso habitual y el que
/// cabe en el `KpiTile` sin que el `FittedBox` lo encoja. Un porcentaje siempre
/// lleva el símbolo: un `46` a secas junto a un `$5.000` se lee como otra moneda.
String formatPercent(double percent) {
  final double safe = percent.isNaN ? 0 : percent.clamp(0, 100);
  final String number = safe == safe.roundToDouble()
      ? safe.toStringAsFixed(0)
      : safe.toStringAsFixed(1);
  return '$number %';
}

/// Formatea centavos en COMPACTO para un KPI: `$1,2 M`.
///
/// Envuelve a [CurrencyFormatter.formatCompactMinor] para que el redondeo compacto
/// tenga un solo sitio: los KPI de ingresos son la única cifra que se muestra
/// abreviada, y abrirvia un total que el usuario tiene que pagar rompe BR-PRICE-008.
String formatCompactMoney(int minor) => CurrencyFormatter.formatCompactMinor(minor);

/// Convierte basis points a porcentaje (0-100) para PINTAR.
///
/// Se satura en 0 y en 100: un valor corrupto (`-500`, `999999`) no debe dibujar
/// un anillo al revés ni desbordar la etiqueta.
double bpToPercent(int basisPoints) {
  final double value = basisPoints / 100;
  if (value.isNaN || value < 0) return 0;
  if (value > 100) return 100;
  return value;
}
