// Estado de la pantalla de Reportes del panel.
//
// EL PRESET LO RESUELVE EL BACKEND, EL CLIENTE NO
// `docs/API.md` §5.2: `today`, `yesterday`, `last7`, `last30`, `thisMonth`,
// `lastMonth`, `custom`. El backend lo resuelve en la zona horaria del NEGOCIO, no
// en la del servidor ni en la del navegador. Por eso la app manda el LITERAL y no
// fechas calculadas a mano: si calculara "hoy" en la zona del dispositivo, un
// cliente en otra zona vería un día distinto del que ve el dueño.
//
// TODAS LAS SERIES SE PIDEN A LA VEZ
// Ventas por día, por hora y top de productos son independientes. `Future.wait`
// convierte tres idas y vueltas en una sola espera.
import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/error/failures.dart';
import '../../../core/result/result.dart';
import '../../../data/models/json_reader.dart';
import './admin_dashboard_series.dart';
import './admin_providers.dart';

/// Preset de rango activo.
final StateProvider<String> adminReportPresetProvider =
    StateProvider<String>((Ref ref) => 'last7');

/// Rango personalizado, usado solo con `preset = 'custom'`.
final StateProvider<DateRange> adminReportRangeProvider =
    StateProvider<DateRange>((Ref ref) => DateRange.lastDays(7));

/// Informe a exportar en CSV. `null` = ninguno seleccionado.
final StateProvider<String?> adminExportReportProvider =
    StateProvider<String?>((Ref ref) => null);

/// Los presets soportados, con su etiqueta. El orden es el que ve el usuario.
const List<(String, String)> kAdminReportPresets = <(String, String)>[
  ('today', 'Hoy'),
  ('yesterday', 'Ayer'),
  ('last7', 'Últimos 7 días'),
  ('last30', 'Últimos 30 días'),
  ('thisMonth', 'Este mes'),
  ('lastMonth', 'Mes anterior'),
];

/// Informes disponibles para exportar (`POST /reports/export`).
const List<(String, String)> kAdminExportReports = <(String, String)>[
  ('sales', 'Ventas'),
  ('sales-by-day', 'Ventas por día'),
  ('sales-by-hour', 'Ventas por hora'),
  ('top-products', 'Productos más vendidos'),
  ('product-revenue', 'Ingresos por producto'),
  ('chair-occupancy', 'Ocupación de sillas'),
  ('rental-revenue', 'Ingresos por alquiler'),
  ('customers', 'Clientes'),
  ('inventory', 'Inventario'),
  ('orders-summary', 'Resumen de pedidos'),
];

/// Presets con la etiqueta de la app (de `AppStrings`).
String adminPresetLabel(String preset) {
  for (final (String, String) entry in kAdminReportPresets) {
    if (entry.$1 == preset) return entry.$2;
  }
  return preset;
}

/// Rango de fechas con la etiqueta y las fechas ISO del contrato.
class DateRange {
  const DateRange({required this.from, required this.to});

  /// Los últimos [days] días, incluido hoy.
  factory DateRange.lastDays(int days) {
    final DateTime now = DateTime.now();
    final DateTime today = DateTime(now.year, now.month, now.day);
    return DateRange(
      from: today.subtract(Duration(days: days - 1)),
      to: today.add(const Duration(days: 1)),
    );
  }

  /// Rango por defecto: la última semana.
  factory DateRange.week() => DateRange.lastDays(7);

  final DateTime from;
  final DateTime to;

  /// `true` si el rango supera los 366 días que acepta `reports/*`.
  bool get isTooLarge => to.difference(from).inDays > 366;
}

/// Los tres datos del informe, cargados en paralelo.
class AdminReportsData {
  const AdminReportsData({
    required this.byDay,
    required this.byHour,
    required this.topProducts,
    required this.occupancy,
  });

  final List<DailyPoint> byDay;
  final List<HourPoint> byHour;
  final List<TopProduct> topProducts;
  final Map<String, dynamic> occupancy;

  /// `summary.utilizationPercent` de `reports/chair-occupancy`.
  ///
  /// OJO: este reporte devuelve YA un porcentaje con 2 decimales (no basis
  /// points), a diferencia de `dashboard.kpis.chairOccupancyRate`, que sí viene en
  /// basis points. La asimetría es del contrato, y por eso cada uno tiene su
  /// getter con su nombre explícito.
  double get utilizationPercent {
    final Object? value = JsonReader.map(occupancy['summary'])?['utilizationPercent'];
    return value is num ? value.toDouble() : 0;
  }
}

/// Informe completo del preset activo.
final FutureProvider<AdminReportsData> adminReportsProvider =
    FutureProvider<AdminReportsData>(
  (Ref ref) async {
    final String preset = ref.watch(adminReportPresetProvider);
    final DateRange range = ref.watch(adminReportRangeProvider);
    final String effectivePreset = preset == 'custom' ? 'custom' : preset;
    // `reports/*` acepta como mucho 366 días. Pedir más no da un error del
    // backend: da una tabla vacía que parece «no hubo ventas», que es la peor
    // respuesta posible para quien está mirando un informe.
    if (range.isTooLarge) {
      throw const BusinessRuleFailure(
        code: 'rango_demasiado_grande',
        message: 'El rango elegido supera el máximo de 366 días.',
      );
    }

    final List<Object> results = await Future.wait<Object>(<Future<Object>>[
      _rows(() => ref.read(adminOpsRepositoryProvider).salesByDay(
            preset: effectivePreset,
            from: range.from,
            to: range.to,
          )),
      _rows(() => ref.read(adminOpsRepositoryProvider).salesByHour(
            preset: effectivePreset,
            from: range.from,
            to: range.to,
          )),
      // El rango personalizado llega a los CUATRO reportes. Antes solo lo
      // recibían ventas por día y por hora, y con `preset: custom` los otros dos
      // fallaban con 400 por rango ausente: el informe mezclaba una semana
      // elegida a mano con los productos de HOY.
      _rows(() => ref.read(adminOpsRepositoryProvider).topProducts(
            preset: effectivePreset,
            limit: 10,
            from: range.from,
            to: range.to,
          )),
      _map(() => ref.read(adminOpsRepositoryProvider).chairOccupancy(
            preset: effectivePreset,
            from: range.from,
            to: range.to,
          )),
    ]);

    return AdminReportsData(
      byDay: <DailyPoint>[
        for (final Map<String, dynamic> row in results[0] as List<Map<String, dynamic>>)
          DailyPoint(
            date: JsonReader.stringOr(row['date'], ''),
            orders: JsonReader.integerOr(row['orders'], 0),
            totalMinor: JsonReader.integerOr(row['totalMinor'], 0),
          ),
      ],
      byHour: HourPoint.fromRows(
        results[1] as List<Map<String, dynamic>>,
      ),
      topProducts: TopProduct.fromRows(
        results[2] as List<Map<String, dynamic>>,
      ),
      occupancy: results[3] as Map<String, dynamic>,
    );
  },
  name: 'adminReports',
);

Future<List<Map<String, dynamic>>> _rows(
  Future<Result<List<Map<String, dynamic>>>> Function() action,
) async {
  final Result<List<Map<String, dynamic>>> result = await action();
  return switch (result) {
    Success<List<Map<String, dynamic>>>(:final List<Map<String, dynamic>> value) =>
      value,
    FailureResult<List<Map<String, dynamic>>>() => const <Map<String, dynamic>>[],
  };
}

Future<Map<String, dynamic>> _map(
  Future<Result<Map<String, dynamic>>> Function() action,
) async {
  final Result<Map<String, dynamic>> result = await action();
  return switch (result) {
    Success<Map<String, dynamic>>(:final Map<String, dynamic> value) => value,
    FailureResult<Map<String, dynamic>>() => const <String, dynamic>{},
  };
}

/// Exportación a CSV.
final AsyncNotifierProvider<AdminExportController, String?> adminExportProvider =
    AsyncNotifierProvider<AdminExportController, String?>(
  AdminExportController.new,
);

/// Controla la exportación.
///
/// `state` guarda el CSV crudo cuando la exportación se completa, para que la
/// pantalla pueda previsualizarlo. Es un `String?` y no un archivo: el producto no
/// tiene dependencia de escritura de archivos y `String` se puede mostrar y copiar
/// sin más.
class AdminExportController extends AsyncNotifier<String?> {
  @override
  FutureOr<String?> build() => null;

  /// `POST /reports/export`.
  ///
  /// Es la ÚNICA respuesta de la API que no usa el envoltorio JSON: devuelve
  /// `text/csv` con BOM UTF-8 y separador `;`. Por eso se devuelve el `String` tal
  /// cual, sin pasar por `unwrapData`.
  Future<String?> export({required String report, required String preset}) async {
    state = const AsyncLoading<String?>();
    final DateRange range = ref.read(adminReportRangeProvider);
    final Result<String> result = await ref
        .read(adminOpsRepositoryProvider)
        .exportCsv(
          report: report,
          preset: preset,
          from: range.from,
          to: range.to,
        );
    // Sin guarda de disposal: `adminExportProvider` no es `autoDispose`, así que
    // el notifier sobrevive a la descarga.
    switch (result) {
      case Success<String>(:final String value):
        state = AsyncData<String?>(value);
        return value;
      case FailureResult<String>(:final Failure failure):
        state = AsyncError<String?>(failure, StackTrace.current);
        return null;
    }
  }

  void acknowledge() => state = const AsyncData<String?>(null);
}
