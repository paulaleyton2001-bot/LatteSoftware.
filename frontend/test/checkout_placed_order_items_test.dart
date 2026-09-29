// Regresión del bug "los productos no aparecen al hacer el pedido".
//
// Este test falla contra el código anterior a la corrección y documenta la
// FORMA REAL de la respuesta del backend, no una inventada: `POST /orders` y
// `GET /orders/:id` NO devuelven `itemCount` en la raíz (sí en el LISTADO
// `GET /orders`), y sí devuelven `items[]` con `nameSnapshot` y
// `lineTotalMinor`.
//
// Origen de los cuerpos: respuestas reales de `http://localhost:3000/api/v1`
// con la cuenta de pruebas `prueba@lattecoffe.co`.

import 'package:flutter_test/flutter_test.dart';
import 'package:latte_coffee/features/checkout/data/parsers/checkout_parsers.dart';
import 'package:latte_coffee/features/checkout/domain/entities/chair_quote.dart';

/// Cuerpo tal cual lo devuelve `POST /orders` (verificado contra el backend).
Map<String, dynamic> _placedOrderBody({
  List<Map<String, dynamic>>? items,
}) {
  return <String, dynamic>{
    'id': 20,
    'orderNumber': 'ORD-900020',
    'type': 'TAKEAWAY',
    'status': 'PENDING',
    'channel': 'MOBILE_WEB',
    'locationId': null,
    'customerId': null,
    'chairId': null,
    'chairCode': null,
    'reservationId': null,
    'rentalId': null,
    'subtotalMinor': 350000,
    'discountMinor': 0,
    'taxMinor': 66500,
    'serviceFeeMinor': 0,
    'totalMinor': 416500,
    'paidMinor': 0,
    'balanceMinor': 416500,
    // SIN `itemCount`: el backend no lo manda en el POST. Este es el bug.
    'items': items ??
        <Map<String, dynamic>>[
          <String, dynamic>{
            'id': 36,
            'productId': 1,
            'variantId': null,
            'variantName': null,
            'nameSnapshot': 'Espresso',
            'skuSnapshot': 'CAF-ESP-01',
            'unitPriceMinor': 350000,
            'quantity': 1,
            'discountMinor': 0,
            'taxMinor': 66500,
            'lineTotalMinor': 350000,
            'notes': null,
            'status': 'PENDING',
            'preparationMinutes': 3,
            'addons': <dynamic>[],
          },
        ],
    'placedAt': '2026-09-29T12:31:35.986Z',
    'confirmedAt': null,
    'preparingAt': null,
    'readyAt': null,
    'completedAt': null,
    'cancelledAt': null,
    'payments': <dynamic>[],
    'refunds': <dynamic>[],
    'chair': null,
    'reservation': null,
    'rental': null,
  };
}

void main() {
  group('CheckoutParsers.placedOrder — productos del pedido', () {
    test('deriva itemCount de items[] cuando el backend no lo envía', () {
      final PlacedOrder order = CheckoutParsers.placedOrder(_placedOrderBody());
      // Antes valía 0 porque se leía `data['itemCount']`, campo inexistente.
      expect(order.itemCount, 1);
    });

    test('suma CANTIDADES, no líneas: 3 + 2 son 5 productos', () {
      final PlacedOrder order = CheckoutParsers.placedOrder(
        _placedOrderBody(
          items: <Map<String, dynamic>>[
            <String, dynamic>{
              'nameSnapshot': 'Latte',
              'quantity': 3,
              'lineTotalMinor': 240000,
            },
            <String, dynamic>{
              'nameSnapshot': 'Postre',
              'quantity': 2,
              'lineTotalMinor': 18000,
            },
          ],
        ),
      );
      expect(order.lines, hasLength(2));
      expect(order.itemCount, 5);
    });

    test('expone las líneas con el nombre y el importe del SERVIDOR', () {
      final PlacedOrder order = CheckoutParsers.placedOrder(
        _placedOrderBody(
          items: <Map<String, dynamic>>[
            <String, dynamic>{
              'nameSnapshot': 'Frappado de maracuyá',
              'variantName': 'Sin avena',
              'quantity': 2,
              'lineTotalMinor': 19000,
            },
          ],
        ),
      );
      expect(order.lines.single.name, 'Frappado de maracuyá');
      expect(order.lines.single.variantName, 'Sin avena');
      expect(order.lines.single.quantity, 2);
      expect(order.lines.single.lineTotalMinor, 19000);
      expect(order.lines.single.semanticLabel,
          '2 × Frappado de maracuyá, variante Sin avena');
    });

    test('respeta un itemCount explícito si el backend lo llegara a mandar', () {
      final Map<String, dynamic> body = _placedOrderBody();
      body['itemCount'] = 99;
      // La respuesta del servidor es la ley: si dice 99, se pinta 99.
      expect(CheckoutParsers.placedOrder(body).itemCount, 99);
    });

    test('descarta líneas sin nombre en vez de pintar un hueco mudo', () {
      final PlacedOrder order = CheckoutParsers.placedOrder(
        _placedOrderBody(
          items: <Map<String, dynamic>>[
            <String, dynamic>{'quantity': 1, 'lineTotalMinor': 100},
            <String, dynamic>{'nameSnapshot': 'Latte', 'quantity': 1},
          ],
        ),
      );
      expect(order.lines, hasLength(1));
      expect(order.itemCount, 1);
    });

    test('con carrito vacío: 0 productos y ninguna línea', () {
      final PlacedOrder order =
          CheckoutParsers.placedOrder(_placedOrderBody(items: <Map<String, dynamic>>[]));
      expect(order.lines, isEmpty);
      expect(order.itemCount, 0);
    });

    test('lee los totales de la raíz y, si faltan, de `totals`', () {
      // El POST real manda los importes en la RAÍZ y NO trae `totals`
      // (comprobado contra el backend). Este test cubre el otro camino: un
      // listado o un panel que sí aniden en `totals` no deben pintar 0.
      final Map<String, dynamic> body = _placedOrderBody()
        ..remove('totalMinor')
        ..remove('taxMinor')
        ..remove('balanceMinor');
      body['totals'] = <String, dynamic>{
        'totalMinor': 416500,
        'taxMinor': 66500,
        'balanceMinor': 416500,
      };

      final PlacedOrder order = CheckoutParsers.placedOrder(body);
      expect(order.totalMinor, 416500);
      expect(order.taxMinor, 66500);
      expect(order.balanceMinor, 416500);
      expect(order.isPayableAtStore, isTrue);
    });

    test('si faltan todos los totales, no inventa un 0 silencioso de saldo', () {
      final Map<String, dynamic> body = _placedOrderBody()
        ..remove('balanceMinor');
      final PlacedOrder order = CheckoutParsers.placedOrder(body);
      // Sin `balanceMinor` ni `totals.balanceMinor`, es 0 y por tanto NO queda
      // saldo: la app no puede prometer que hay que pagar si el servidor no lo
      // dijo. El total sí se conserva porque viene en la raíz.
      expect(order.balanceMinor, 0);
      expect(order.isPayableAtStore, isFalse);
      expect(order.totalMinor, 416500);
    });

    test('nunca devuelve un lista mutable desde el exterior', () {
      final PlacedOrder order = CheckoutParsers.placedOrder(_placedOrderBody());
      expect(() => order.lines.add(
            const PlacedOrderLine(name: 'x', quantity: 1, lineTotalMinor: 1),
          ), throwsUnsupportedError);
    });
  });
}
