// Modelos de entrada y salida del repositorio del mostrador.
//
// Se separan de `pos_repository.dart` por tamaño, no por responsabilidad: los
// tipos de la interfaz (`PosOrderDraftRequest`, `PosReceipt`…) son lo que
// devuelve el repositorio, y mezclarlos con la firma de los métodos dejaba un
// archivo de casi 300 líneas donde no se distinguía el contrato de los datos.

import '../entities/pos_catalog_item.dart';

/// `POST /orders` resuelto: lo que el servidor dice que vale el pedido.
class PosOrderResult {
  const PosOrderResult({
    required this.orderId,
    required this.orderNumber,
    required this.status,
    required this.subtotalMinor,
    required this.taxMinor,
    required this.serviceFeeMinor,
    required this.discountMinor,
    required this.totalMinor,
    required this.paidMinor,
    required this.balanceMinor,
  });

  final int orderId;
  final String orderNumber;
  final String status;
  final int subtotalMinor;
  final int taxMinor;
  final int serviceFeeMinor;
  final int discountMinor;

  /// Total REAL. Este es el número que se cobra, sin transformarlo.
  final int totalMinor;

  final int paidMinor;

  /// Saldo pendiente. Con `place: true` suele ser igual a [totalMinor].
  final int balanceMinor;

  @override
  String toString() => 'PosOrderResult($orderNumber, $totalMinor centavos)';
}

/// `POST /orders/:id/status` resuelto.
class PosOrderTransitionResult {
  const PosOrderTransitionResult({
    required this.orderId,
    required this.status,
    required this.orderNumber,
    this.warning,
  });

  final int orderId;
  final String status;
  final String orderNumber;

  /// `meta.warnings` del backend, p. ej. `ALREADY_APPLIED` (API.md §6.4).
  final String? warning;

  @override
  String toString() => 'PosOrderTransitionResult($orderNumber -> $status)';
}

/// Opción de método de pago publicada por `GET /payments/methods`.
class PosPaymentMethodOption {
  const PosPaymentMethodOption({
    required this.method,
    required this.enabled,
    required this.providers,
    this.requiresReference = false,
    this.allowsPartial = true,
    this.allowsOverpayment = false,
    this.minAmountMinor = 0,
  });

  /// `PaymentMethod` del backend (`CASH`, `CARD`, `TRANSFER`, `ONLINE`).
  final String method;

  /// `false` = el negocio lo tiene deshabilitado; el POS no lo ofrece.
  final bool enabled;

  /// Lista de `PaymentProvider` habilitada para el método.
  final List<String> providers;

  /// `true` si el proveedor exige `referenceNumber`.
  final bool requiresReference;

  final bool allowsPartial;
  final bool allowsOverpayment;
  final int minAmountMinor;

  @override
  String toString() => 'PosPaymentMethodOption($method, enabled: $enabled)';
}

/// Comprobante listo para reimprimir (`GET /orders/:id/receipt`).
class PosReceipt {
  const PosReceipt({
    required this.orderNumber,
    required this.businessName,
    required this.businessAddress,
    required this.items,
    required this.totalMinor,
    required this.paidMinor,
    required this.balanceMinor,
    this.status,
    this.customerName,
    this.chairCode,
    this.subtotalMinor = 0,
    this.discountMinor = 0,
    this.taxMinor = 0,
    this.placedAt,
  });

  final String orderNumber;
  final String? status;
  final String businessName;
  final String businessAddress;
  final String? customerName;
  final String? chairCode;
  final int subtotalMinor;
  final int discountMinor;
  final int taxMinor;
  final int totalMinor;
  final int paidMinor;
  final int balanceMinor;
  final DateTime? placedAt;
  final List<PosReceiptLine> items;

  @override
  String toString() => 'PosReceipt($orderNumber)';
}

/// Una línea del comprobante.
class PosReceiptLine {
  const PosReceiptLine({
    required this.name,
    required this.quantity,
    required this.lineTotalMinor,
    this.variantName,
    this.notes,
  });

  final String name;
  final String? variantName;
  final double quantity;
  final int lineTotalMinor;
  final String? notes;

  @override
  String toString() => 'PosReceiptLine($name x$quantity)';
}

/// `GET /products?fields=basic`: la rejilla del mostrador y el índice de
/// categorías que viaja en la MISMA respuesta.
///
/// Se devuelven juntos y no en dos providers porque el backend manda las
/// categorías en `meta.categories` (`docs/API.md` §7.11: `meta: { …,
/// categories?: [{ id, name, count }] }`) precisamente en la proyección ligera
/// que existe para el POS. Pedirlas aparte sería una petición de más para
/// mostrar el mismo dato.
class PosCatalog {
  const PosCatalog({this.items = const <PosCatalogItem>[], this.categories = const <PosCatalogCategory>[]});

  final List<PosCatalogItem> items;

  /// Categorías con nombre y conteo, tal cual las publica el backend.
  final List<PosCatalogCategory> categories;
}

/// Categoría del catálogo (`meta.categories[].name`).
class PosCatalogCategory {
  const PosCatalogCategory({required this.id, required this.count, this.name});

  final int id;

  /// Nombre real ("Cafés"). `null` solo si el backend no lo publica: la fila de
  /// la proyección `fields=basic` no lo trae, pero sí `meta.categories`.
  final String? name;

  /// Productos activos de la categoría, según el servidor.
  final int count;

  /// Etiqueta lista para pintar: el nombre, y `Cat. <id>` como degradado.
  String get label => name ?? 'Cat. $id';

  @override
  String toString() => 'PosCatalogCategory($id, $name, $count)';
}

// ------------------------------------------------------- Alquiler de sillas

/// Una reserva que el cajero puede activar YA en el mostrador.
///
/// El tipo `CHAIR_RENTAL` de `POST /orders` exige `chairId` Y
/// `reservationId` (API.md §7.12, regla BR-ORDER-008, y el CHECK de la tabla
/// `orders`), así que sin una reserva REAL el backend devuelve
/// `422 RENTAL_REQUIRES_CHAIR_AND_RESERVATION`. Esta clase es lo que la UI
/// muestra para que el cajero elija una en vez de encontrarse con ese 422.
class PosReservation {
  const PosReservation({
    required this.id,
    required this.code,
    required this.status,
    required this.startAt,
    required this.endAt,
    this.customerName,
    this.totalMinor = 0,
  });

  final int id;

  /// Código de la reserva (`RES-900015`).
  final String code;

  /// `ReservationStatus`: `PENDING`, `CONFIRMED`, `ACTIVE`, `COMPLETED`,
  /// `CANCELLED`, `EXPIRED`, `NO_SHOW`.
  final String status;

  final DateTime? startAt;
  final DateTime? endAt;

  /// Nombre del cliente, si la reserva es de alguien concreto.
  final String? customerName;

  /// Proyección del coste del alquiler (`rentalTotalMinor`). Es un dato de
  /// ayuda: el importe que se cobra lo calcula el servidor al cerrar.
  final int totalMinor;

  /// `true` si el mostrador puede arrancar el alquiler con esta reserva.
  ///
  /// `POST /rentals` con `reservationId` exige que esté `CONFIRMED`
  /// (`422 RESERVATION_NOT_ACTIVE` si no, con la pista «Confirme la reserva
  /// antes de abrir el alquiler»), y `ACTIVE` ya tiene alquiler abierto, así que
  /// el cajero no tiene nada que arrancar.
  bool get isStartable => status == 'PENDING' || status == 'CONFIRMED';

  /// Etiqueta corta para el botón: hora de inicio y cliente.
  String get label => customerName == null || customerName!.isEmpty
      ? code
      : '$code · $customerName';

  @override
  String toString() => 'PosReservation($code, $status)';
}

/// `POST /rentals` resuelto: qué alquiler se abrió y sobre qué silla.
///
/// IMPORTANTE — POR QUÉ NO DEVUELVE UN PEDIDO
/// `docs/API.md` §7.9 dice que `POST /rentals` materializa el pedido
/// `CHAIR_RENTAL`. Se comprobó contra el backend y NO es así: la respuesta real
/// es `{ rental, chairStatus, chairStatusChangedAt }` y en la tabla `orders` no
/// aparece ninguna fila nueva. Por eso el parser de este flujo devuelve el
/// alquiler, y el pedido se crea después con `POST /orders`, que sí sabe
/// calcular el importe del alquiler a partir de la silla y de la reserva.
class PosRentalStart {
  const PosRentalStart({
    required this.rentalId,
    required this.rentalCode,
    required this.chairStatus,
  });

  final int rentalId;
  final String rentalCode;

  /// Estado en que queda la silla: `OCCUPIED` cuando el alquiler arranca bien.
  final String chairStatus;

  @override
  String toString() => 'PosRentalStart($rentalCode, silla $chairStatus)';
}
