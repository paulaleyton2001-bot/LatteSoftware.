// Lectura de las respuestas del checkout. Módulo `features/checkout/data`.
//
// POR QUÉ ESTÁN FUERA DEL DATASOURCE
// El datasource hace las llamadas; este archivo traduce el JSON a entidades. Son
// dos responsabilidades distintas y, juntas, daban un archivo de 330 líneas donde la
// mitad era una tabla de `JsonReader.integer(...)` que solo se lee cuando un campo no
// cuadra.
//
// `fromJson` ESCRITOS A MANO
// `json_serializable` y `build_runner` están declarados en `pubspec.yaml`, pero el
// build no se puede ejecutar en este entorno y el código generado nunca se
// regeneraría. Ver `data/models/json_reader.dart`.

import '../../../../core/customer/chair_map.dart';
import '../../../../core/customer/venue_datasource.dart';
import '../../../../data/models/json_reader.dart';
import '../../domain/entities/chair_quote.dart';
import '../../domain/repositories/checkout_repository.dart';

/// Lectores de la respuesta del checkout. Sin estado y sin dependencias de red.
abstract final class CheckoutParsers {
  const CheckoutParsers._();

  /// `GET /chairs/map` → el mismo `ChairMap` que pinta el cliente y el POS.
  ///
  /// Se delega en [VenueRemoteDataSource.parseChairMap] a propósito: el plano es
  /// UN tipo en toda la app y duplicar su parser aquí haría que una silla se viera
  /// distinta en el checkout que en la pestaña «Silla».
  static ChairMap chairMap(Map<String, dynamic> data) =>
      VenueRemoteDataSource.parseChairMap(data);

  /// `GET /chairs/:id` → qué estorba a esa silla, si algo.
  ///
  /// La reserva y el alquiler llegan SIN el nombre del cliente, y un `CUSTOMER` no
  /// tiene por qué saberlo. Por eso [ChairOccupancy.occupiedByLabel] se rellena con
  /// una etiqueta neutra en vez de inventar el dato.
  static ChairOccupancy occupancy(Map<String, dynamic> data) {
    final Map<String, dynamic> reservation =
        JsonReader.orEmpty(data['currentReservation']);
    final Map<String, dynamic> rental = JsonReader.orEmpty(data['currentRental']);
    final bool hasReservation = reservation.isNotEmpty;
    final bool hasRental = rental.isNotEmpty;

    return ChairOccupancy(
      chairId: JsonReader.integerOr(data['id'], 0),
      status: JsonReader.stringOr(
        data['status'],
        hasRental ? 'OCCUPIED' : (hasReservation ? 'RESERVED' : 'AVAILABLE'),
      ),
      occupiedUntil: JsonReader.dateTime(rental['endAt']) ??
          JsonReader.dateTime(reservation['endAt']),
      occupiedByLabel: hasRental || hasReservation ? 'Otro cliente' : null,
      reservationCode: JsonReader.string(reservation['code']),
      rentalCode: JsonReader.string(rental['code']),
    );
  }

  /// `GET /reservations/quote` → cotización de la franja.
  ///
  /// La consulta devuelve `200` incluso con conflicto, así que `isAvailable` es un
  /// CAMPO y no un error. `chairId`, `startAt` y `endAt` vienen por parámetro
  /// porque son los que el cliente pidió y el backend puede omitirlos del cuerpo.
  static ChairQuote quote(
    Map<String, dynamic> data,
    int chairId,
    DateTime startAt,
    DateTime endAt,
  ) {
    final Map<String, dynamic> meta = JsonReader.orEmpty(data['meta']);
    final Map<String, dynamic> conflict = JsonReader.orEmpty(data['conflict']);
    final Map<String, dynamic> chair = JsonReader.orEmpty(data['chair']);
    // La duración la calcula el SERVIDOR (con su redondeo y su mínimo). Solo si no
    // la manda se usa la diferencia local, que es exactamente lo que se pidió.
    final int asked = endAt.difference(startAt).inMinutes;
    final int duration =
        JsonReader.integerOr(data['durationMinutes'], asked);

    return ChairQuote(
      chairId: JsonReader.integerOr(data['chairId'], chairId),
      startAt: JsonReader.dateTime(data['startAt']) ?? startAt,
      endAt: JsonReader.dateTime(data['endAt']) ?? endAt,
      durationMinutes: duration,
      // Lo FACTURABLE cae al mínimo de 30 min en el servidor; sin `billableMinutes`
      // se usa la duración pedida, nunca un 30 inventado aquí (BR-RENTAL-003).
      billableMinutes: JsonReader.integerOr(data['billableMinutes'], duration),
      pricePerHourMinor: JsonReader.integerOr(data['pricePerHourMinor'], 0),
      subtotalMinor: JsonReader.integerOr(data['subtotalMinor'], 0),
      discountMinor: JsonReader.integerOr(data['discountMinor'], 0),
      taxMinor: JsonReader.integerOr(data['taxMinor'], 0),
      serviceFeeMinor: JsonReader.integerOr(data['serviceFeeMinor'], 0),
      // `totalMinor` es el ÚNICO total válido (BR-PRICE-008). Si no llega, se
      // reconstruye con lo que sí vino para no pintar un «$0» engañoso.
      totalMinor: JsonReader.integerOr(
        data['totalMinor'],
        JsonReader.integerOr(data['subtotalMinor'], 0) -
            JsonReader.integerOr(data['discountMinor'], 0) +
            JsonReader.integerOr(data['taxMinor'], 0) +
            JsonReader.integerOr(data['serviceFeeMinor'], 0),
      ),
      minimumApplied: JsonReader.boolean(data['minimumApplied']),
      taxRateBp: JsonReader.integerOr(data['taxRateBp'], 0),
      isAvailable: JsonReader.boolean(data['isAvailable'], fallback: true),
      chairName: JsonReader.string(chair['name']),
      chairCode: JsonReader.string(chair['code']),
      zoneName: JsonReader.string(chair['zoneName']),
      conflictCode: JsonReader.string(conflict['code']),
      conflictEndAt: JsonReader.dateTime(conflict['endAt']),
      appliedRules: JsonReader.stringList(meta['appliedRules']),
    );
  }

  /// `POST /reservations` → lo mínimo para mandar el `reservationId` al pedido.
  static ReservationCreated reservation(Map<String, dynamic> data) =>
      ReservationCreated(
        id: JsonReader.integerOr(data['id'], 0),
        code: JsonReader.stringOr(data['code'], 'RES-?'),
        status: JsonReader.stringOr(data['status'], 'PENDING'),
        startAt: JsonReader.dateTime(data['startAt']),
        endAt: JsonReader.dateTime(data['endAt']),
        durationMinutes: JsonReader.integerOr(data['durationMinutes'], 0),
        rentalTotalMinor: JsonReader.integerOr(data['rentalTotalMinor'], 0),
      );

  /// `POST /orders` → cifras del servidor, sin transformar (BR-PRICE-008).
  ///
  /// ── EL BUG DE "LOS PRODUCTOS NO APARECEN AL HACER EL PEDIDO" ──────────────
  /// `POST /orders` responde con `items[]` (nombre, cantidad, precio unitario,
  /// total de línea) pero NO con un `itemCount` en la raíz. Este parser leía
  /// `data['itemCount']`, que no existe en el cuerpo del POST, así que caía al
  /// `fallback: 0` y `PlacedOrder.itemCount` SIEMPRE valía 0. Consecuencia en
  /// pantalla: la tarjeta de confirmación mostraba el número de pedido, el estado
  /// y el total, pero la línea «N productos» NO aparecía nunca, y el cliente se
  /// quedaba sin la prueba de lo que había pedido. El pedido SÍ se creaba
  /// (verificado contra el backend: `items[]` con `nameSnapshot` y
  /// `lineTotalMinor`), lo que falla es la LECTURA de lo que se devolvió.
  ///
  /// La corrección: [itemCount] se DERIVA de `items[]` cuando el servidor no lo
  /// manda, y se suman las CANTIDADES (no las líneas): un pedido de 3 cafés y
  /// 2类产品 son 5 productos, no 2. Si no viniera `items[]` tampoco, se recurre
  /// a `totalQuantity`/`itemCount` por si el backend cambia de forma, en vez de
  /// mostrar un 0 que miente.
  static PlacedOrder placedOrder(Map<String, dynamic> data) {
    // Los totales vienen dos veces: en la raíz y anidados en `totals`. Se lee la
    // raíz y, si falta, `totals`; el mismo criterio que aplica el detalle del panel.
    final Map<String, dynamic> totals = JsonReader.orEmpty(data['totals']);
    final Map<String, dynamic> chair = JsonReader.orEmpty(data['chair']);
    final Map<String, dynamic> reservation = JsonReader.orEmpty(data['reservation']);
    final Map<String, dynamic> rental = JsonReader.orEmpty(data['rental']);

    int total(String key) =>
        JsonReader.integerOr(data[key], JsonReader.integerOr(totals[key], 0));

    final List<PlacedOrderLine> lines = _orderLines(data);

    return PlacedOrder(
      id: JsonReader.integerOr(data['id'], 0),
      orderNumber: JsonReader.stringOr(data['orderNumber'], '#0'),
      status: JsonReader.stringOr(data['status'], 'PENDING'),
      type: JsonReader.stringOr(data['type'], 'TAKEAWAY'),
      subtotalMinor: total('subtotalMinor'),
      discountMinor: total('discountMinor'),
      taxMinor: total('taxMinor'),
      serviceFeeMinor: total('serviceFeeMinor'),
      totalMinor: total('totalMinor'),
      paidMinor: total('paidMinor'),
      balanceMinor: total('balanceMinor'),
      chairCode: JsonReader.string(chair['code']),
      reservationCode: JsonReader.string(reservation['code']),
      rentalCode: JsonReader.string(rental['code']),
      placedAt: JsonReader.dateTime(data['placedAt']),
      // Orden de preferencia: el `itemCount` explícito si el backend lo da; si
      // no, las líneas parseadas; y si tampoco, `totalQuantity` (nombre que usa
      // el listado). Nunca un 0 inventado con productos presentes.
      itemCount: JsonReader.integerOr(
        data['itemCount'],
        lines.isNotEmpty
            ? lines.fold<int>(
                0, (int sum, PlacedOrderLine line) => sum + line.quantity)
            : JsonReader.integerOr(
                data['totalQuantity'],
                JsonReader.integerOr(totals['itemCount'], 0),
              ),
      ),
      lines: lines,
    );
  }

  /// `items[]` de `POST /orders` → líneas legibles para la confirmación.
  ///
  /// Se leen los MISMOS nombres que devuelve el servidor (`nameSnapshot`,
  /// `lineTotalMinor`), nunca los del carrito local: la confirmación tiene que
  /// decir lo que el servidor cobró, no lo que la app creía (BR-PRICE-008).
  static List<PlacedOrderLine> _orderLines(Map<String, dynamic> data) {
    final List<PlacedOrderLine> lines = <PlacedOrderLine>[];
    for (final Map<String, dynamic> row in JsonReader.mapList(data['items'])) {
      final String? name = JsonReader.string(row['nameSnapshot']) ??
          JsonReader.string(row['name']);
      // Una línea sin nombre es basura: se descarta en lugar de pintar un hueco
      // mudo en la confirmación.
      if (name == null) continue;
      lines.add(PlacedOrderLine(
        name: name,
        variantName: JsonReader.string(row['variantName']),
        quantity: JsonReader.integerOr(row['quantity'], 1),
        lineTotalMinor: JsonReader.integerOr(
          row['lineTotalMinor'],
          JsonReader.integerOr(row['unitPriceMinor'], 0),
        ),
      ));
    }
    return List<PlacedOrderLine>.unmodifiable(lines);
  }
}
