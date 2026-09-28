/**
 * Aritmética de alquiler y reserva.Funciones PURAS, sin base de datos, sin
 * `Date.now()` y sin excepciones de negocio.
 *
 * ============================================================================
 * POR QUÉ UN FICHERO PROPIO Y NO DENTRO DE UN SERVICE
 * ============================================================================
 * Estas fórmulas son la parte del sistema de la que depende el dinero que entra
 * por caja (criterio 1 de DESIGN.md 1.3, CORRECTNESS). Si vivieran dentro de
 * `RentalsService`, la única forma de probarlas sería montar la base de datos y
 * llamar a un endpoint: no se podría comprobar el redondeo de un caso como
 * "45 minutos a $5.000/h" sin pagar el coste de una transacción. Aquí se pueden
 * enumerar los casos en una tabla y cada uno es una línea.
 *
 * ============================================================================
 * REGLAS QUE IMPLEMENTA (DESIGN.md 7.4)
 * ============================================================================
 *  - **BR-RENTAL-001** `precio = roundHalfUp(billable_minutes / 60 * price_per_hour_minor)`
 *    con `billed_minutes = max(billed_minutes, 30)`. El mínimo de 30 min aplica
 *    SIEMPRE, aunque el cliente estuvo cuatro minutos.
 *  - **BR-RENTAL-002** La facturación es pro-rata por minuto con `ceil`:
 *    `billed = max(30, ceil((cierre - inicio) / 60000))`. Se redondea hacia arriba
 *    para que el cliente nunca pague de menos por segundos.
 *  - **BR-RENTAL-003** El overage se cobra al `price_per_hour_minor` CONGELADO
 *    al abrir el alquiler, nunca al precio vigente de la silla: subir la tarifa
 *    no modifica facturas ya abiertas (decisión D3 del documento de diseño).
 *  - **BR-RENTAL-004** `extra_minutes = max(0, billed - planned_final)` y
 *    `extra_minor = roundHalfUp(extra_minutes / 60 * precio_congelado)`, donde
 *    `planned_final` es el `end_at` vigente tras extensiones.
 *  - **BR-RENTAL-006** `total = subtotal + extensions + extra`, sumando importes
 *    YA redondeados (BR-MONEY-004), nunca recalculando desde minutos sueltos.
 *  - **BR-RES-007** `rental_total_minor` de una reserva es una PROYECCIÓN: la
 *    misma fórmula sobre `duration_minutes`. La UI debe etiquetarla como estimada.
 *
 * ============================================================================
 * DINERO
 * ============================================================================
 * Todos los importes son enteros de centavos y todo el redondeo pasa por
 * `roundHalfUp` de `shared/utils/money.ts` (BR-MONEY-002 y BR-MONEY-011): ni un
 * `Math.round` suelto, para que el resultado sea idéntico en cualquier runtime.
 */
import { RENTAL } from '../../config/index.js';
import { ceilDiffMinutes } from '../../shared/utils/datetime.js';
import { addMinor, applyTaxBp, multiplyMinor, roundHalfUp } from '../../shared/utils/money.js';

/** Desglose de un importe de alquiler, en centavos y minutos. */
export interface RentalChargeBreakdown {
  /** Minutos para los que se cobra: los reales con el mínimo de 30 aplicado. */
  readonly billedMinutes: number;
  /** `true` si el mínimo de 30 minutos se aplicó a una sesión más corta. */
  readonly minimumApplied: boolean;
  /** Minutos planificados que remain tras las extensiones. */
  readonly plannedMinutesFinal: number;
  /** Minutos de más que el cliente consumió. Cero si se fue antes. */
  readonly extraMinutes: number;
  /** Minutos planificados originales (congelados). */
  readonly plannedMinutes: number;
  /** Centavos por hora usados en TODOS los cálculos: el congelado. */
  readonly pricePerHourMinor: number;
  readonly subtotalMinor: number;
  readonly extensionsMinor: number;
  readonly extraMinutesMinor: number;
  /**
   * Centavos de overage que se habrían cobrado y no se cobraron por
   * `waiveOvertime`. Se informa para que el cobro siga siendo auditable: un 0 en
   * `extra_minutes_minor` sin este campo es indistinguible de "no se pasó de
   * hora".
   */
  readonly waivedMinor: number;
  /** `subtotal + extensions + extra` (BR-RENTAL-006). */
  readonly totalMinor: number;
  /** Impuesto calculado sobre el total, a la tasa del negocio (BR-TAX-007). */
  readonly taxMinor: number;
  /** Cargo por servicio, calculado sobre el total (BR-TAX-005). */
  readonly serviceFeeMinor: number;
  /** `total + tax + serviceFee`: lo que ve el cliente en la nota de cobro. */
  readonly grandTotalMinor: number;
  /** `true` si `businesses.tax_inclusive = 1` (el precio ya incluía impuesto). */
  readonly taxInclusive: boolean;
}

/** Parámetros de cierre de un alquiler. */
export interface RentalCloseInput {
  readonly startAt: string;
  /** `end_at` vigente tras extensiones: define los minutos planificados reales. */
  readonly plannedEndAt: string;
  /** Minutos del plan original, ya congelados en la fila. */
  readonly plannedMinutes: number;
  /** Minutos ya cobrados por extensiones (`chair_rental_extensions`). */
  readonly extensionsMinor: number;
  /** Precio CONGELADO al abrir el alquiler. */
  readonly pricePerHourMinor: number;
  /** Momento real de cierre. */
  readonly endedAt: string;
  /** `businesses.tax_rate_bp` y `service_fee_bp`. */
  readonly taxRateBp: number;
  readonly serviceFeeBp: number;
  readonly taxInclusive: boolean;
  /**
   * `true` si un MANAGER perdona el sobretiempo (API.md 7.9). El overage se pone
   * a cero pero `extraMinutes` se conserva para que el informe siga viendo que
   * el cliente se pasó de hora.
   */
  readonly waiveOvertime: boolean;
}

/** Minutos facturables de una sesión: `max(30, ceil(minutos reales))`. */
export function billedMinutesFor(startAt: string, endedAt: string): number {
  const real = ceilDiffMinutes(startAt, endedAt);
  return Math.max(RENTAL.MIN_BILLED_MINUTES, real);
}

/**
 * Proyección del importe de un alquiler de duración conocida (BR-RENTAL-001).
 *
 * Es la que usan `POST /reservations/quote` y la creación de la reserva, donde
 * todavía no hay cierre: `rental_total_minor` es una estimación y la UI la
 * etiqueta como tal (BR-RES-007).
 */
export function projectRentalMinor(durationMinutes: number, pricePerHourMinor: number): number {
  return multiplyMinor(pricePerHourMinor, billableMinutes(durationMinutes) / 60);
}

/**
 * Minutos facturables de una duración planificada: `max(duración, 30)`.
 *
 * A8 del documento de diseño deja explícito que el mínimo de 30 min también
 * aplica a la proyección de la reserva, no sólo al cobro final.
 */
export function billableMinutes(durationMinutes: number): number {
  return Math.max(durationMinutes, RENTAL.MIN_BILLED_MINUTES);
}

/**
 * Desglose completo del cobro de un alquiler (BR-RENTAL-001..007).
 *
 * El orden es fijo e innegociable (BR-MONEY-003): primero los minutos, luego el
 * importe, y sólo al final el impuesto y el cargo por servicio, cada uno
 * redondeado a centavo y aplicado sobre lo ya redondeado (BR-MONEY-004).
 */
export function computeRentalCharge(input: RentalCloseInput): RentalChargeBreakdown {
  const billedMinutes = billedMinutesFor(input.startAt, input.endedAt);
  const minimumApplied = billedMinutes > ceilDiffMinutes(input.startAt, input.endedAt);

  // Minutos planificados FINALES: los que van de `start_at` al `end_at` vigente
  // tras las extensiones (BR-RENTAL-004). Se calculan con `ceil` para que un
  // minuto de más del plan reste overage, no lo cree, y con el MISMO suelo de 30
  // minutos que la facturación (BR-RENTAL-001).
  //
  // El suelo importa: si el plan fue de 5 minutos, `billed` vale 30 y sin el suelo
  // el overage saldría de 25 minutos. Con el suelo, el desglose queda coherente
  // con el subtotal que se escribió al abrir el alquiler (250.000 = 30 min) y el
  // total no cambia al cerrar; sin él, el mismo cobro aparecería partido en
  // "41.667 de plan + 208.333 de overage", que ni el cajero ni el cliente
  // entenderían.
  const plannedMinutesFinal = Math.max(
    RENTAL.MIN_BILLED_MINUTES,
    ceilDiffMinutes(input.startAt, input.plannedEndAt),
  );

  // Los minutos de más NUNCA son negativos: si el cliente se fue antes de la
  // hora, no hay overage y los minutos no consumidos se devuelven aparte
  // (BR-RENTAL-005, que aquí no se refleja porque su importe vive en `orders`).
  const extraMinutes = Math.max(0, billedMinutes - plannedMinutesFinal);

  // El subtotal SIEMPRE sale de los minutos del plan ORIGINAL (congelados en la
  // fila) con el mismo suelo de 30 minutos que se aplicó al abrir el alquiler: es
  // lo que el cliente aceptó al sentarse. Lo que secobró de más son las
  // EXTENSIONES, que van en su propio campo, y el overage, en el suyo.
  const subtotalMinor = multiplyMinor(
    input.pricePerHourMinor,
    billableMinutes(input.plannedMinutes) / 60,
  );
  // Overage al precio CONGELADO (BR-RENTAL-003), nunca al vigente de la silla.
  // Con `waiveOvertime` el importe NO se cobra pero se conserva el cálculo, para
  // que `waivedMinor` deje constancia de lo que se perdonó.
  const rawExtraMinor = multiplyMinor(input.pricePerHourMinor, extraMinutes / 60);
  const extraMinutesMinor = input.waiveOvertime ? 0 : rawExtraMinor;
  const waivedMinor = input.waiveOvertime ? rawExtraMinor : 0;

  // `subtotal + extensions + extra`: suma de importes ya redondeados.
  const totalMinor = addMinor(subtotalMinor, input.extensionsMinor, extraMinutesMinor);

  // BR-TAX-003: con precios que ya incluyen impuesto, `tax_minor` se registra en 0.
  const taxMinor = input.taxInclusive ? 0 : applyTaxBp(totalMinor, input.taxRateBp);
  const serviceFeeMinor = applyTaxBp(totalMinor, input.serviceFeeBp);

  return {
    billedMinutes,
    minimumApplied,
    plannedMinutesFinal,
    extraMinutes,
    plannedMinutes: input.plannedMinutes,
    pricePerHourMinor: input.pricePerHourMinor,
    subtotalMinor,
    extensionsMinor: input.extensionsMinor,
    extraMinutesMinor,
    waivedMinor,
    totalMinor,
    taxMinor,
    serviceFeeMinor,
    grandTotalMinor: addMinor(totalMinor, taxMinor, serviceFeeMinor),
    taxInclusive: input.taxInclusive,
  };
}

/**
 * Importe de una extensión de alquiler (BR-RENTAL-011).
 *
 * `additional_minor = roundHalfUp(requested_minutes / 60 * precio_congelado)`.
 * No hay mínimo de 30 minutos aquí: el mínimo es de la sesión completa, y aplicar
 * un mínimo por extensión haría pagar 30 minutos por cada 5 minutos ampliados.
 */
export function computeExtensionMinor(requestedMinutes: number, pricePerHourMinor: number): number {
  return multiplyMinor(pricePerHourMinor, requestedMinutes / 60);
}

/** Utilidad de occupancy del mapa: porcentaje entero en basis points. */
export function occupancyRateBp(occupiedSeats: number, totalSeats: number): number {
  if (totalSeats <= 0) {
    return 0;
  }
  return roundHalfUp((occupiedSeats * 10_000) / totalSeats);
}

/** Utilidad de ocupación de un rango de disponibilidad. */
export function utilizationRateBp(bookedMinutes: number, totalMinutes: number): number {
  return occupancyRateBp(bookedMinutes, totalMinutes);
}
