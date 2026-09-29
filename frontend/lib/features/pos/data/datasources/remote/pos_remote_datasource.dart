// Llamadas HTTP del mostrador. Módulo `features/pos/data`.
//
// Este es el ÚNICO archivo que conoce las rutas del POS. Todo lo que sale de aquí
// pasa por `core/network/api_endpoints.dart`, y todo lo que vuelve se estrecha
// con `JsonReader` / `is`: un campo que llega con otro tipo NO revienta la app,
// se descarta y se sigue pintando el resto.
//
// Cada ruta se verificó contra `backend/src/modules/*/*.routes.ts` (el código
// real), no solo contra `docs/API.md`. Ver `REPORTE` en la entrega.

import 'package:dio/dio.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../../core/network/api_endpoints.dart';
import '../../../../../data/models/json_reader.dart';
import '../../../domain/entities/pos_catalog_item.dart';
import '../../../domain/entities/pos_charge.dart';
import '../../../domain/repositories/pos_repository.dart';
import '../../../domain/repositories/pos_repository_models.dart';

/// Datasource remoto del punto de venta.
///
/// NO implementa `PosRepository`: el datasource devuelve el valor CRUDO y es
/// `PosRepositoryImpl` (en `data/repositories/pos_repository_impl.dart`) quien lo
/// envuelve en `Result<T>` con su `_guard`. Declarar `implements PosRepository`
/// aquí obligaría a devolver `Success`/`FailureResult` desde la capa HTTP, que es
/// justo lo que el resto del proyecto no hace.
class PosRemoteDataSource {
  const PosRemoteDataSource(this._dio);

  final Dio _dio;

  // ------------------------------------------------------------------ Catálogo
  /// `GET /products?fields=basic&order=asc`.
  ///
  /// Sin `sort`: el defecto de `GET /products` ya es `sortOrder asc` (ver
  /// `core/network/README.md`, "Orden de listados").
  ///
  /// Además de la rejilla se leen `meta.categories` (`docs/API.md` §7.11:
  /// `meta: { …, categories?: [{ id, name, count }] }`): la proyección `fields=basic`
  /// no trae el nombre de la categoría en cada fila, pero sí el índice con nombre
  /// y conteo, que es lo que pintan los filtros. Sin leerlo, los botones salían
  /// como «Cat. 1», «Cat. 2»… porque el comentario anterior daba por hecho que
  /// ese dato noviajaba.
  Future<PosCatalog> catalog() async {
    final Response<dynamic> response = await _dio.get<dynamic>(
      ApiEndpoints.products,
      queryParameters: <String, dynamic>{
        // Proyección ligera: 10 columnas en vez del producto completo con
        // variantes, complementos e historial de precio (API.md §7.11).
        'fields': 'basic',
        'pageSize': 100,
        'order': 'asc',
        'includeInactive': false,
      },
    );
    final List<PosCatalogItem> items = <PosCatalogItem>[];
    for (final Map<String, dynamic> row in unwrapList(response.data)) {
      final PosCatalogItem? item = PosCatalogItem.tryParse(row);
      if (item != null) items.add(item);
    }
    return PosCatalog(
      items: List<PosCatalogItem>.unmodifiable(items),
      categories: _categories(response.data),
    );
  }

  /// `meta.categories` del envoltorio, o lista vacía si no viene.
  static List<PosCatalogCategory> _categories(Object? responseData) {
    final Map<String, dynamic> meta =
        JsonReader.map(JsonReader.map(responseData)?['meta']) ??
            const <String, dynamic>{};
    final List<PosCatalogCategory> categories = <PosCatalogCategory>[];
    for (final Map<String, dynamic> row in JsonReader.mapList(meta['categories'])) {
      final int? id = JsonReader.integer(row['id']);
      if (id == null) continue;
      categories.add(PosCatalogCategory(
        id: id,
        name: JsonReader.string(row['name']),
        count: JsonReader.integerOr(row['count'], 0),
      ));
    }
    return List<PosCatalogCategory>.unmodifiable(categories);
  }

  // -------------------------------------------------------------------- Pedido
  Future<PosOrderResult> createOrder(PosOrderDraftRequest request) async {
    final Response<dynamic> response = await _dio.post<dynamic>(
      ApiEndpoints.orders,
      // `place: true` (el default del servidor) deja el pedido en `PENDING` y
      // listo para cobrar; `false` lo dejaría en `DRAFT`, que la caja no usa.
      data: <String, dynamic>{...request.toBody(), 'place': true},
    );
    return _parseOrder(unwrapData(response.data), 0);
  }

  /// Parseo común de un pedido, venga de `POST /orders` o de `POST /rentals`.
  ///
  /// Los saldos de un alquiler fresco vienen en cero: el cobro ocurre al cerrar el
  /// alquiler, no al abrirlo. Por eso `balanceMinor` cae al total si el backend no
  /// lo manda, que es el estado real de un pedido recién creado.
  static PosOrderResult _parseOrder(Map<String, dynamic> data, int fallbackId) {
    final int total = JsonReader.integerOr(data['totalMinor'], 0);
    return PosOrderResult(
      orderId: JsonReader.integer(data['id']) ?? fallbackId,
      orderNumber: JsonReader.stringOr(data['orderNumber'], 'ORD-000000'),
      status: JsonReader.stringOr(data['status'], 'PENDING'),
      subtotalMinor: JsonReader.integerOr(data['subtotalMinor'], 0),
      taxMinor: JsonReader.integerOr(data['taxMinor'], 0),
      serviceFeeMinor: JsonReader.integerOr(data['serviceFeeMinor'], 0),
      discountMinor: JsonReader.integerOr(data['discountMinor'], 0),
      totalMinor: total,
      paidMinor: JsonReader.integerOr(data['paidMinor'], 0),
      balanceMinor: JsonReader.integerOr(data['balanceMinor'], total),
    );
  }

  Future<PosOrderTransitionResult> changeOrderStatus({
    required int orderId,
    required String toStatus,
    String? reason,
  }) async {
    final Response<dynamic> response = await _dio.post<dynamic>(
      ApiEndpoints.orderStatus(orderId),
      data: <String, dynamic>{
        'toStatus': toStatus,
        if (reason != null && reason.isNotEmpty) 'reason': reason,
      },
    );
    final Map<String, dynamic> data = unwrapData(response.data);
    return PosOrderTransitionResult(
      orderId: JsonReader.integer(data['id']) ?? orderId,
      status: JsonReader.stringOr(data['status'], toStatus),
      orderNumber: JsonReader.stringOr(data['orderNumber'], '#$orderId'),
    );
  }

  // ------------------------------------------------------------------- Cobro
  Future<PosChargeResult> charge({
    required PosChargeRequest request,
    required int orderId,
    required String idempotencyKey,
  }) async {
    final Response<dynamic> response = await _dio.post<dynamic>(
      ApiEndpoints.payments,
      data: request.toPaymentBody(orderId),
      options: Options(
        // OBLIGATORIO: sin esta cabecera el backend responde `400` con
        // `details.code = 'IDEMPOTENCY_KEY_REQUIRED'` (API.md §7.13).
        headers: <String, dynamic>{
          ApiEndpoints.idempotencyHeader: idempotencyKey,
        },
      ),
    );
    final Map<String, dynamic> data = unwrapData(response.data);
    final Map<String, dynamic> payment = JsonReader.orEmpty(data['payment']);
    final Map<String, dynamic> order = JsonReader.orEmpty(data['order']);
    return PosChargeResult(
      paymentId: JsonReader.integer(payment['id']) ?? 0,
      orderId: JsonReader.integerOr(order['id'], orderId),
      amountMinor: JsonReader.integerOr(payment['amountMinor'], request.amountMinor),
      balanceMinor: JsonReader.integerOr(order['balanceMinor'], 0),
      changeDueMinor: JsonReader.integerOr(data['changeDueMinor'], 0),
      orderNumber: JsonReader.string(order['orderNumber']),
      orderStatus: JsonReader.string(order['status']),
    );
  }

  Future<List<PosPaymentMethodOption>> paymentMethods() async {
    final Response<dynamic> response =
        await _dio.get<dynamic>(ApiEndpoints.paymentMethods);
    return <PosPaymentMethodOption>[
      for (final Map<String, dynamic> row in unwrapList(response.data))
        _parseMethodOption(row),
    ];
  }

  // ------------------------------------------------------------ Alquiler walk-in
  /// `POST /rentals` — abre el alquiler y devuelve el pedido que materializa.
  Future<PosOrderResult> createWalkInRental({
    required int chairId,
    required int plannedMinutes,
  }) async {
    final Response<dynamic> response = await _dio.post<dynamic>(
      ApiEndpoints.rentals,
      data: <String, dynamic>{
        'chairId': chairId,
        'plannedMinutes': plannedMinutes.clamp(1, 1440),
      },
    );
    final Map<String, dynamic> data = unwrapData(response.data);
    return _parseOrder(JsonReader.orEmpty(data['order']), chairId);
  }

  // ---------------------------------------------------------------- Comprobante
  Future<PosReceipt> receipt(int orderId) async {
    final Response<dynamic> response =
        await _dio.get<dynamic>(ApiEndpoints.orderReceipt(orderId));
    return _parseReceipt(unwrapData(response.data), orderId);
  }

  // ------------------------------------------------------------------- Parsers
  static PosPaymentMethodOption _parseMethodOption(Map<String, dynamic> row) {
    return PosPaymentMethodOption(
      method: JsonReader.stringOr(row['method'], 'CASH'),
      enabled: JsonReader.boolean(row['enabled'], fallback: true),
      providers: <String>[
        for (final Map<String, dynamic> provider in JsonReader.mapList(row['providers']))
          if (JsonReader.string(provider['code']) case final String code) code,
      ],
      requiresReference: JsonReader.boolean(row['requiresReference']),
      allowsPartial: JsonReader.boolean(row['allowsPartial'], fallback: true),
      allowsOverpayment: JsonReader.boolean(row['allowsOverpayment']),
      minAmountMinor: JsonReader.integerOr(row['minAmountMinor'], 0),
    );
  }

  static PosReceipt _parseReceipt(Map<String, dynamic> data, int orderId) {
    final Map<String, dynamic> business = JsonReader.orEmpty(data['business']);
    final Map<String, dynamic> customer = JsonReader.orEmpty(data['customer']);
    final Map<String, dynamic> chair = JsonReader.orEmpty(data['chair']);
    final Map<String, dynamic> totals = JsonReader.orEmpty(data['totals']);
    return PosReceipt(
      orderNumber: JsonReader.stringOr(data['orderNumber'], '#$orderId'),
      status: JsonReader.string(data['status']),
      businessName: JsonReader.stringOr(business['name'], 'Latte Coffee'),
      businessAddress: JsonReader.string(business['addressLine1']) ?? '',
      customerName: JsonReader.string(customer['fullName']),
      chairCode: JsonReader.string(chair['code']),
      subtotalMinor: JsonReader.integerOr(totals['subtotalMinor'], 0),
      discountMinor: JsonReader.integerOr(totals['discountMinor'], 0),
      taxMinor: JsonReader.integerOr(totals['taxMinor'], 0),
      totalMinor: JsonReader.integerOr(totals['totalMinor'], 0),
      paidMinor: JsonReader.integerOr(totals['paidMinor'], 0),
      balanceMinor: JsonReader.integerOr(totals['balanceMinor'], 0),
      placedAt: JsonReader.dateTime(data['placedAt']),
      items: <PosReceiptLine>[
        for (final Map<String, dynamic> row in JsonReader.mapList(data['items']))
          PosReceiptLine(
            name: JsonReader.stringOr(row['name'], 'Ítem'),
            variantName: JsonReader.string(row['variantName']),
            quantity: _toDouble(row['quantity']) ?? 1,
            lineTotalMinor: JsonReader.integerOr(row['lineTotalMinor'], 0),
            notes: JsonReader.string(row['notes']),
          ),
      ],
    );
  }

  static double? _toDouble(Object? value) {
    if (value is num) return value.toDouble();
    if (value is String) return double.tryParse(value);
    return null;
  }
}
