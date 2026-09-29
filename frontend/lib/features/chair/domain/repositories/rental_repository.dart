// Contrato de los alquileres del cliente. Módulo `features/chair/domain`.
//
// SOLO LECTURAS. La app del cliente no abre alquileres (eso es el checkout, que
// los crea junto al pedido) ni los extiende sin permiso: `rentals:extend` está
// denegado a `CUSTOMER` (DESIGN.md §9.3). Lo único que puede hacer un cliente con
// su alquiler es MIRARlo, y eso es justo lo que expone esta interfaz.

import '../../../../core/result/result.dart';
import '../../../orders/domain/entities/rental.dart';

/// Lecturas de alquileres.
abstract interface class RentalRepository {
  /// `GET /rentals` — los alquileres del cliente autenticado, en una ventana de
  /// ±7 días alrededor de ahora.
  Future<Result<List<Rental>>> myRentals();
}
