// Detalle de un pedido para el panel. MÓDULO `features/admin/domain/entities`.
//
// Va aparte de `admin_catalog.dart` (donde vive el RESUMEN) porque trae cosas que
// el resumen no tiene: líneas, pagos, reembolsos, descuentos aplicados y el
// desglose de totales con propina. Un resumen de lista y un detalle de pantalla son
// dos lecturas distintas del mismo recurso, y confundirlas obligaba a la lista a
// traer datos que no usa.

import 'package:flutter/foundation.dart';

import '../../../../data/models/json_reader.dart';
import './admin_catalog.dart';

/// Pedido completo con líneas y pagos.
@immutable
class AdminOrderDetail {
  const AdminOrderDetail({
    required this.order,
    this.items = const <AdminOrderLine>[],
    this.payments = const <AdminOrderPayment>[],
    this.refunds = const <AdminOrderRefund>[],
    this.discounts = const <AdminAppliedDiscount>[],
    this.customerName,
    this.customerPhone,
    this.chairCode,
    this.reservationCode,
    this.rentalCode,
    this.notes,
    this.customerNotes,
    this.tipMinor = 0,
    this.subtotalMinor = 0,
    this.discountMinor = 0,
    this.taxMinor = 0,
    this.serviceFeeMinor = 0,
  });

  final AdminOrder order;
  final List<AdminOrderLine> items;
  final List<AdminOrderPayment> payments;
  final List<AdminOrderRefund> refunds;
  final List<AdminAppliedDiscount> discounts;

  final String? customerName;
  final String? customerPhone;
  final String? chairCode;
  final String? reservationCode;
  final String? rentalCode;
  final String? notes;
  final String? customerNotes;

  /// Propina. NO entra en `totalMinor` (BR-MONEY-009): se cobra aparte.
  final int tipMinor;

  /// DESGLOSE del total, en centavos.
  ///
  /// Viven aquí y no en [AdminOrder] a propósito: `AdminOrder` es la proyección de
  /// LISTA (`GET /orders`), que no trae el desglose; el desglose solo existe en
  /// `GET /orders/:id`, dentro de `totals`. Ponerlos en el resumen obligaría a
  /// inventar ceros en todas las filas de la tabla.
  final int subtotalMinor;
  final int discountMinor;
  final int taxMinor;
  final int serviceFeeMinor;

  /// `true` si tiene saldo pendiente.
  bool get hasBalance => order.balanceMinor > 0;

  /// Parseo tolerante de `GET /orders/:id`.
  ///
  /// Los totales vienen DOS veces: en la raíz (`totalMinor`) y anidados en
  /// `totals`. Se lee la raíz y, si falta, `totals`; así la pantalla no muestra `0`
  /// si el backend mueve el bloque.
  static AdminOrderDetail fromJson(Map<String, dynamic> json, int orderId) {
    final Map<String, dynamic> totals =
        JsonReader.orEmpty(json['totals']);
    final Map<String, dynamic> customer = JsonReader.orEmpty(json['customer']);
    final Map<String, dynamic> chair = JsonReader.orEmpty(json['chair']);
    final Map<String, dynamic> reservation = JsonReader.orEmpty(json['reservation']);
    final Map<String, dynamic> rental = JsonReader.orEmpty(json['rental']);

    return AdminOrderDetail(
      order: AdminOrder.tryParse(json) ??
          AdminOrder(
            id: orderId,
            orderNumber: '#$orderId',
            status: 'PENDING',
            type: 'TAKEAWAY',
            totalMinor: 0,
          ),
      items: <AdminOrderLine>[
        for (final Map<String, dynamic> row in JsonReader.mapList(json['items']))
          AdminOrderLine.fromJson(row),
      ],
      payments: <AdminOrderPayment>[
        for (final Map<String, dynamic> row in JsonReader.mapList(json['payments']))
          AdminOrderPayment.fromJson(row),
      ],
      refunds: <AdminOrderRefund>[
        for (final Map<String, dynamic> row in JsonReader.mapList(json['refunds']))
          AdminOrderRefund(
            id: JsonReader.integerOr(row['id'], 0),
            amountMinor: JsonReader.integerOr(row['amountMinor'], 0),
            reason: JsonReader.string(row['reason']),
            createdAt: JsonReader.dateTime(row['createdAt']),
          ),
      ],
      discounts: <AdminAppliedDiscount>[
        for (final Map<String, dynamic> row
            in JsonReader.mapList(json['appliedDiscounts']))
          AdminAppliedDiscount(
            code: JsonReader.stringOr(row['code'], '—'),
            name: JsonReader.stringOr(row['name'], 'Descuento'),
            type: JsonReader.stringOr(row['type'], 'FIXED'),
            value: JsonReader.integerOr(row['value'], 0),
            amountMinor: JsonReader.integerOr(row['amountMinor'], 0),
          ),
      ],
      customerName: JsonReader.string(customer['fullName']),
      customerPhone: JsonReader.string(customer['phone']),
      chairCode: JsonReader.string(chair['code']),
      reservationCode: JsonReader.string(reservation['code']),
      rentalCode: JsonReader.string(rental['code']),
      notes: JsonReader.string(json['notes']),
      customerNotes: JsonReader.string(json['customerNotes']),
      tipMinor: JsonReader.integerOr(
        json['tipMinor'] ?? totals['tipMinor'],
        0,
      ),
      // El desglose solo viaja en `totals`. Se lee de la raíz como reserva por si
      // el backend lo devolviera aplanado alguna vez, que es el mismo criterio
      // que aplica [AdminOrder.tryParse] a los totales de la lista.
      subtotalMinor:
          JsonReader.integerOr(totals['subtotalMinor'] ?? json['subtotalMinor'], 0),
      discountMinor:
          JsonReader.integerOr(totals['discountMinor'] ?? json['discountMinor'], 0),
      taxMinor: JsonReader.integerOr(totals['taxMinor'] ?? json['taxMinor'], 0),
      serviceFeeMinor: JsonReader.integerOr(
        totals['serviceFeeMinor'] ?? json['serviceFeeMinor'],
        0,
      ),
    );
  }

  @override
  String toString() => 'AdminOrderDetail(${order.orderNumber})';
}

/// Línea de un pedido. Los nombres y precios son SNAPSHOTS (BR-PRICE-004): si el
/// producto cambia de precio mañana, esta línea sigue mostrando lo que se cobró.
@immutable
class AdminOrderLine {
  const AdminOrderLine({
    required this.id,
    required this.name,
    required this.quantity,
    required this.unitPriceMinor,
    required this.lineTotalMinor,
    this.sku,
    this.variantName,
    this.notes,
    this.status = 'PENDING',
    this.taxMinor = 0,
    this.discountMinor = 0,
  });

  final int id;
  final String name;
  final String? sku;
  final String? variantName;
  final double quantity;

  /// Centavos.
  final int unitPriceMinor;
  final int lineTotalMinor;
  final int taxMinor;
  final int discountMinor;
  final String? notes;

  /// `OrderItemStatus`: `PENDING`, `READY`, `CANCELLED`.
  final String status;

  static AdminOrderLine fromJson(Map<String, dynamic> json) => AdminOrderLine(
        id: JsonReader.integerOr(json['id'], 0),
        name: JsonReader.stringOr(json['nameSnapshot'], 'Ítem'),
        sku: JsonReader.string(json['skuSnapshot']),
        variantName: JsonReader.string(
          JsonReader.orEmpty(json['variant'])['name'],
        ),
        quantity: JsonReader.integerOr(json['quantity'], 1).toDouble(),
        unitPriceMinor: JsonReader.integerOr(json['unitPriceMinor'], 0),
        lineTotalMinor: JsonReader.integerOr(json['lineTotalMinor'], 0),
        taxMinor: JsonReader.integerOr(json['taxMinor'], 0),
        discountMinor: JsonReader.integerOr(json['discountMinor'], 0),
        notes: JsonReader.string(json['notes']),
        status: JsonReader.stringOr(json['status'], 'PENDING'),
      );

  @override
  String toString() => 'AdminOrderLine($name x$quantity)';
}

/// Pago asociado al pedido.
@immutable
class AdminOrderPayment {
  const AdminOrderPayment({
    required this.id,
    required this.method,
    required this.amountMinor,
    this.paymentNumber,
    this.status = 'APPROVED',
    this.provider,
    this.providerReference,
    this.approvedAt,
  });

  final int id;
  final String? paymentNumber;
  final String method;
  final String status;

  /// Centavos.
  final int amountMinor;

  final String? provider;

  /// Referencia de aprobación del datáfono. `null` en efectivo.
  final String? providerReference;

  final DateTime? approvedAt;

  static AdminOrderPayment fromJson(Map<String, dynamic> json) =>
      AdminOrderPayment(
        id: JsonReader.integerOr(json['id'], 0),
        paymentNumber: JsonReader.string(json['paymentNumber']),
        method: JsonReader.stringOr(json['method'], 'CASH'),
        status: JsonReader.stringOr(json['status'], 'APPROVED'),
        amountMinor: JsonReader.integerOr(json['amountMinor'], 0),
        provider: JsonReader.string(json['provider']),
        providerReference: JsonReader.string(json['providerReference']),
        approvedAt: JsonReader.dateTime(json['approvedAt']),
      );
}

/// Reembolso aplicado al pedido.
@immutable
class AdminOrderRefund {
  const AdminOrderRefund({
    required this.id,
    required this.amountMinor,
    this.reason,
    this.createdAt,
  });

  final int id;

  /// Centavos.
  final int amountMinor;
  final String? reason;
  final DateTime? createdAt;
}

/// Descuento aplicado, tal como lo calculó el servidor.
@immutable
class AdminAppliedDiscount {
  const AdminAppliedDiscount({
    required this.code,
    required this.name,
    required this.type,
    required this.value,
    required this.amountMinor,
  });

  final String code;
  final String name;
  final String type;

  /// Basis points si `type = PERCENT`, centavos si `FIXED`.
  final int value;

  /// Centavos aplicados de verdad.
  final int amountMinor;
}
