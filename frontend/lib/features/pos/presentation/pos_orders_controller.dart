// Estado de los pedidos del mostrador: búsqueda, filtros, tablero y comprobante.
//
// UN SOLO ORIGEN PARA EL TABLERO Y PARA EL BUSCADOR
// El tablero Kanban y la lista de pedidos son dos vistas del MISMO conjunto, así
// que comparten un solo `FutureProvider` de pedidos recientes. Si cada pantalla
// trajera los suyos, cambiar de vista volvería a pedir datos y el contador de la
// cabecera parpadearía.
//
// `GET /orders` devuelve el RESUMEN (sin `items`), que es justo lo que una
// tarjeta de tablero necesita: número, tipo, estado, total y cuenta. Los items
// solo se piden en el detalle.

import 'package:dio/dio.dart';
// `Icons` y `IconData` son de material: las columnas del tablero se describen con
// su ícono, y por eso este controlador de ESTADO toca la librería de widgets.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/di/providers.dart';
import '../../../core/error/failures.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_endpoints.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/result/result.dart';
import '../domain/entities/pos_order_card.dart';
import '../domain/repositories/pos_repository_models.dart';
import './pos_controller.dart';

/// Pedidos recientes del mostrador (`GET /orders`).
///
/// `pageSize: 100` es el máximo del endpoint. Un turno de caja cabe de sobra y,
/// con la lista filtrada en memoria, cambiar de columna del tablero es
/// instantáneo. Sin `sort`: el defecto de `GET /orders` ya es `createdAt desc`
/// (ver `core/network/README.md`, "Orden de listados").
final FutureProvider<List<PosOrderCard>> posOrdersProvider =
    FutureProvider<List<PosOrderCard>>(
  (Ref ref) async {
    final Dio dio = ref.watch(apiClientProvider);
    try {
      final Response<dynamic> response = await dio.get<dynamic>(
        ApiEndpoints.orders,
        queryParameters: <String, dynamic>{
          'pageSize': 100,
          'order': 'desc',
        },
      );
      final List<PosOrderCard> cards = <PosOrderCard>[];
      for (final Map<String, dynamic> row in unwrapList(response.data)) {
        final PosOrderCard? card = PosOrderCard.tryParse(row);
        if (card != null) cards.add(card);
      }
      return cards;
    } on Object catch (error) {
      throw ApiException.toFailure(error);
    }
  },
  name: 'posOrders',
);

/// Texto del buscador de pedidos (número, cliente o nota).
final StateProvider<String> posOrderSearchProvider =
    StateProvider<String>((Ref ref) => '');

/// Filtro por estado. `null` = todos.
final StateProvider<String?> posOrderStatusFilterProvider =
    StateProvider<String?>((Ref ref) => null);

/// Filtro por tipo de pedido. `null` = todos.
final StateProvider<String?> posOrderTypeFilterProvider =
    StateProvider<String?>((Ref ref) => null);

/// Pedidos ya filtrados.
final Provider<List<PosOrderCard>> posVisibleOrdersProvider =
    Provider<List<PosOrderCard>>((Ref ref) {
  final List<PosOrderCard> all =
      ref.watch(posOrdersProvider).valueOrNull ?? const <PosOrderCard>[];
  final String needle = ref.watch(posOrderSearchProvider).trim().toLowerCase();
  final String? status = ref.watch(posOrderStatusFilterProvider);
  final String? type = ref.watch(posOrderTypeFilterProvider);

  return <PosOrderCard>[
    for (final PosOrderCard card in all)
      if (status == null || card.status == status)
        if (type == null || card.type == type)
          if (needle.isEmpty || card.searchHaystack.contains(needle)) card,
  ];
}, name: 'posVisibleOrders');

/// Columnas del tablero Kanban, en el orden del ciclo de vida del pedido.
const List<PosBoardColumn> kPosBoardColumns = <PosBoardColumn>[
  PosBoardColumn('PENDING', 'Nuevos', Icons.receipt_long_rounded),
  PosBoardColumn('CONFIRMED', 'Confirmados', Icons.check_circle_outline_rounded),
  PosBoardColumn('PREPARING', 'Preparando', Icons.local_cafe_rounded),
  PosBoardColumn('READY', 'Listos', Icons.room_service_rounded),
  PosBoardColumn('DELIVERED', 'Entregados', Icons.done_all_rounded),
  PosBoardColumn('CANCELLED', 'Cancelados', Icons.cancel_rounded),
];

/// Columna del tablero.
class PosBoardColumn {
  const PosBoardColumn(this.apiValue, this.label, this.icon);

  /// Estado de origen de la columna.
  ///
  /// `DELIVERED` NO es un `OrderStatus` de la API: el ciclo real termina en
  /// `COMPLETED`, que aquí se muestra como "Entregados". Es el único nombre en
  /// el que la columna y el estado no coinciden a propósito, y está anotado aquí
  /// para que nadie lo busque en `API.md` §6.2.
  final String apiValue;

  final String label;
  final IconData icon;
}

/// Estado `apiValue` al que mueve la tarjeta el "avance rápido" de cada columna.
///
/// Las columnas de entregados y cancelados aparecen igual, pero sin botón: su
/// entrada los deja en el estado terminal, así que no hay a dónde avanzar.
const Map<String, String> kPosBoardColumnStatus = <String, String>{
  'Nuevos': 'PENDING',
  'Confirmados': 'CONFIRMED',
  'Preparando': 'PREPARING',
  'Listos': 'READY',
  'Entregados': 'COMPLETED',
  'Cancelados': 'CANCELLED',
};

/// Cambio de estado de un pedido, con su resultado.
/// El estado de "avanzando" es POR TARJETA, para que tocar una no apague los
/// botones de las otras cinco del tablero. De ahí que sea `autoDispose` y no un
/// provider compartido: sin listeners, no queda ningún estado de carga colgado.
final AutoDisposeAsyncNotifierProvider<PosOrderStatusController, PosOrderCard?>
    posOrderStatusProvider =
    AutoDisposeAsyncNotifierProvider<PosOrderStatusController, PosOrderCard?>(
  PosOrderStatusController.new,
);
class PosOrderStatusController extends AutoDisposeAsyncNotifier<PosOrderCard?> {
  @override
  Future<PosOrderCard?> build() async => null;

  /// `POST /orders/:id/status`. Un toque en la tarjeta del tablero.
  ///
  /// El backend valida la transición y devuelve `409 INVALID_ORDER_TRANSITION`
  /// con `details.allowed` (la lista de destinos válidos) si no es legal; ese
  /// `409` llega como `ConflictFailure` y la tarjeta se queda como estaba.
  Future<bool> advance(PosOrderCard card) async {
    final String? next = card.nextStatus;
    if (next == null || state.isLoading) return false;
    state = const AsyncLoading<PosOrderCard?>();
    final Result<PosOrderTransitionResult> result = await ref
        .read(posRepositoryProvider)
        .changeOrderStatus(orderId: card.id, toStatus: next);
    // Sin guarda de disposal: `posOrderStatusProvider` SÍ es `autoDispose`, pero la
    // tarjeta que lo escucha sigue montada mientras la transición corre (es un
    // `onPressed` de esa misma tarjeta), así que el notifier no se destruye aquí.

    switch (result) {
      case Success<PosOrderTransitionResult>():
        // La lista de pedidos y el plano quedan desfasados: ambos se releen.
        ref.invalidate(posOrdersProvider);
        state = AsyncData<PosOrderCard?>(card);
        return true;
      case FailureResult<PosOrderTransitionResult>(:final Failure failure):
        state = AsyncError<PosOrderCard?>(failure, StackTrace.current);
        return false;
    }
  }

  /// Limpia el error tras mostrarlo, para que la tarjeta no quede en rojo.
  void acknowledge() => state = const AsyncData<PosOrderCard?>(null);
}

/// Comprobante de un pedido (`GET /orders/:id/receipt`), para reimprimir.
final FutureProviderFamily<PosReceipt, int> posReceiptProvider =
    FutureProvider.family<PosReceipt, int>(
  (Ref ref, int orderId) async {
    final Result<PosReceipt> result =
        await ref.watch(posRepositoryProvider).receipt(orderId);
    return switch (result) {
      Success<PosReceipt>(:final PosReceipt value) => value,
      FailureResult<PosReceipt>(:final Failure failure) => throw failure,
    };
  },
  name: 'posReceipt',
);
