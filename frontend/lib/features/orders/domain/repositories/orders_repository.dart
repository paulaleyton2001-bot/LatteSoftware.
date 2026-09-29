// Contrato de pedidos del cliente. Módulo `features/orders/domain`.
//
// TODAS LAS FIRMAS DEVUELVEN `Future<Result<T>>` Y NUNCA LANZAN, como el resto
// de repositorios del proyecto: el `DioException` se traduce a `Failure` en
// `data/repositories/orders_repository_impl.dart` y la UI nunca ve excepciones.
//
// NO HAY ESCRITURA DE PEDIDOS
// Un `CUSTOMER` tiene `orders:create`, `orders:update` (propio) y
// `orders:cancel` (propio), pero la app del cliente no cancela ni cambia estados:
// los hace el mostrador. Lo único que escribe el cliente es extender el alquiler
// (`POST /rentals/:id/extend`).

import '../../../../core/result/result.dart';
import '../entities/order_detail.dart';
import '../entities/order_summary.dart';
import '../entities/payment_record.dart';
import '../entities/rental.dart';

/// Lecturas de pedidos, alquileres y pagos.
abstract interface class OrdersRepository {
  /// `GET /orders` — los pedidos del cliente autenticado (el service filtra por
  /// `customerId = auth.userId`).
  Future<Result<List<OrderSummary>>> orders();

  /// `GET /orders/:id`.
  Future<Result<OrderDetail>> order(int orderId);

  /// `GET /rentals` — alquileres del cliente, en una ventana de ±7 días.
  Future<Result<List<Rental>>> rentals();

  /// `POST /rentals/:id/extend` — extiende el alquiler [additionalMinutes].
  ///
  /// Un `CUSTOMER` NO tiene el permiso `rentals:extend` (DESIGN.md §9.3 lo marca
  /// denegado para `CUSTOMER`), así que esta llamada solo funciona con personal.
  /// La UI comprueba el permiso antes de pintar el botón y, si aparece un `403`,
  /// el mensaje explica que hay que pedirlo en el mostrador. Se mantiene el
  /// método porque el mismo cliente sirve para el rol `CASHIER`+ y así la
  /// pantalla no tiene dos caminos.
  Future<Result<Rental>> extendRental(int rentalId, int additionalMinutes);

  /// `GET /customers/:id/payments` — historial de pagos hechos EN EL LOCAL.
  Future<Result<List<PaymentRecord>>> payments();
}
