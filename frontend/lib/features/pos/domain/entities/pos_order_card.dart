// Tarjeta de pedido del mostrador. MÓDULO `pos/domain/entities`.
//
// Proyección del RESUMEN de `GET /orders` (API.md §7.12): sin `items`, que es lo
// que una tarjeta de tablero necesita (número, tipo, estado, total y cuenta). Los
// ítems solo se piden en el detalle.
//
// Es una entidad y no un `Map` porque el tablero compara, ordena y pinta
// documentos idénticos miles de veces por turno: sin `==` por valor, Riverpod
// reconstruiría la columna entera en cada respuesta.

import '../../../../data/models/json_reader.dart';

/// Tarjeta de pedido del mostrador.
///
/// Proyección del RESUMEN de `GET /orders` (API.md §7.12): sin `items`. Los
/// dinero van en centavos y se formatean con `PriceDisplay`.
class PosOrderCard {
  const PosOrderCard({
    required this.id,
    required this.orderNumber,
    required this.status,
    required this.type,
    required this.totalMinor,
    this.paidMinor = 0,
    this.balanceMinor = 0,
    this.itemCount = 0,
    this.customerName,
    this.chairCode,
    this.placedAt,
  });

  final int id;
  final String orderNumber;
  final String status;
  final String type;
  final int totalMinor;
  final int paidMinor;
  final int balanceMinor;
  final int itemCount;
  final String? customerName;
  final String? chairCode;
  final DateTime? placedAt;

  /// `true` si el pedido tiene saldo pendiente (se puede cobrar más).
  bool get hasBalance => balanceMinor > 0;

  /// `true` si ya está en un estado terminal.
  bool get isClosed =>
      status == 'COMPLETED' || status == 'CANCELLED' || status == 'REFUNDED';

  /// `true` si se le puede aplicar el botón de avance rápido.
  bool get canAdvance => kPosOrderNextStatus.containsKey(status);

  /// Estado siguiente del botón de avance, o `null`.
  String? get nextStatus => kPosOrderNextStatus[status];
  /// Texto que busca el filtro del mostrador: número, cliente, silla y notas.
  String get searchHaystack =>
      '$orderNumber ${customerName ?? ''} ${chairCode ?? ''} $orderNumber'
          .toLowerCase();

  /// Parseo tolerante del resumen de `GET /orders`.
  static PosOrderCard? tryParse(Map<String, dynamic> json) {
    final int? id = JsonReader.integer(json['id']);
    final String? number = JsonReader.string(json['orderNumber']);
    if (id == null || number == null) return null;
    return PosOrderCard(
      id: id,
      orderNumber: number,
      status: JsonReader.stringOr(json['status'], 'PENDING'),
      type: JsonReader.stringOr(json['type'], 'TAKEAWAY'),
      totalMinor: JsonReader.integerOr(json['totalMinor'], 0),
      paidMinor: JsonReader.integerOr(json['paidMinor'], 0),
      balanceMinor: JsonReader.integerOr(json['balanceMinor'], 0),
      itemCount: JsonReader.integerOr(json['itemCount'], 0),
      customerName: JsonReader.string(json['customerName']),
      chairCode: JsonReader.string(json['chairCode']),
      placedAt: JsonReader.dateTime(json['placedAt']),
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is PosOrderCard &&
          other.id == id &&
          other.status == status &&
          other.totalMinor == totalMinor &&
          other.paidMinor == paidMinor &&
          other.balanceMinor == balanceMinor;

  @override
  int get hashCode => Object.hash(id, status, totalMinor, paidMinor, balanceMinor);

  @override
  String toString() => 'PosOrderCard($orderNumber, $status)';
}

/// Ciclo de `OrderStatus` del mostrador (API.md §6.3), de un estado al
/// siguiente: `PENDING → CONFIRMED → PREPARING → READY → COMPLETED`.
///
/// Vive en el DOMINIO y no en el controlador porque describe el CONTRATO de
/// estados del pedido, no cómo se pinta el tablero. `presentation` lo importa; al
/// revés, una entidad no puede depender de la capa que la dibuja.
///
/// Volver atrás NO está en este mapa a propósito: el botón rápido solo avanza.
/// Deshacer un estado lo sabe hacer el cajero con el diálogo de estados, y un
/// botón "atrás" al lado del de "adelante" se pulsa por error.
const Map<String, String> kPosOrderNextStatus = <String, String>{
  'DRAFT': 'PENDING',
  'PENDING': 'CONFIRMED',
  'CONFIRMED': 'PREPARING',
  'PREPARING': 'READY',
  'READY': 'COMPLETED',
};
