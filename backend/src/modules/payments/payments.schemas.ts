/**
 * Esquemas zod del módulo `payments` (API.md 7.13).
 *
 * TODOS son `.strict()`: un campo desconocido es `400 VALIDATION_ERROR` con
 * `code: 'UNKNOWN_FIELD'`, no se ignora en silencio (API.md 1).
 *
 * ============================================================================
 * DECISIÓN DEL CLIENTE: SOLO `CASH` Y `CARD`
 * ============================================================================
 * `POST /api/v1/payments` acepta `CASH` y `CARD` y NADA MÁS. El enum del dominio
 * (`PaymentMethod`) tiene cuatro valores porque el esquema los contempla para un
 * futuro, pero este endpoint NO los expone: el negocio cobra en el local, sin
 * pasarela, sin transferencia y sin pago en línea. `TRANSFER` y `ONLINE` son un
 * `400 VALIDATION_ERROR` con el mensaje explícito, que es mucho más útil para el
 * cajero que un 422 genérico que sugiera que el sistema lo soporta.
 *
 * Tampoco hay ningún campo de tarjeta: ni PAN, ni CVV, ni token. En `CARD` el
 * cajero anota la REFERENCIA del datáfono (`providerReference`), que es una
 * aprobación opaca, no el número de la tarjeta (BR-SEC-006).
 */
/**
 * DECISIÓN DEL CLIENTE: SOLO `CASH` Y `CARD`
 * ============================================================================
 * `POST /api/v1/payments` acepta `CASH` y `CARD` y NADA MÁS. El enum del dominio
 * (`PaymentMethod`) tiene cuatro valores porque el esquema los contempla para un
 * futuro, pero este endpoint NO los expone: el negocio cobra en el local, sin
 * pasarela, sin transferencia y sin pago en línea. `TRANSFER` y `ONLINE` son un
 * `400 VALIDATION_ERROR` con un mensaje que dice por qué, que es mucho más útil
 * para el cajero que un 422 genérico que sugiriera que el sistema lo soporta.
 *
 * Tampoco hay ningún campo de tarjeta: ni PAN, ni CVV, ni token. En `CARD` el
 * cajero anota la REFERENCIA del datáfono (`providerReference`), que es una
 * aprobación opaca, no el número de la tarjeta (BR-SEC-006).
 *
 * ============================================================================
 * POR QUÉ NO HAY UN `provider` PARA EL COBRO CON TARJETA
 * ============================================================================
 * El enunciado de esta fase habla de `CARD_TERMINAL` (el datáfono) como valor de
 * `payments.provider`. Ese valor NO existe en el esquema congelado:
 *
 *   - `shared/domain/enums.ts` declara `PaymentProvider` con `CASH_REGISTRY`,
 *     `STRIPE`, `MERCADOPAGO`, `WOMPI` y `PAYU`.
 *   - `0001_init.sql` lo refuerza con
 *     `CHECK (provider IS NULL OR provider IN ('CASH_REGISTRY','STRIPE','MERCADOPAGO','WOMPI','PAYU'))`.
 *   - `docs/DESIGN.md` 4.6 y `docs/API.md` 6.2 listan exactamente esos cinco.
 *
 * Los ficheros del enunciado que NO se pueden tocar son precisamente los tres que
 * habría que cambiar (`migrations/`, `shared/domain/enums.ts`, `docs/`). Así que
 * aquí NO se inventa un valor: el cobro con datáfono se registra con
 * `method = 'CARD'` y `provider = NULL`, y la IDENTIFICACIÓN del datáfono la da
 * el `provider_reference` OBLIGATORIO (el número de aprobación que anota el
 * cajero), que es un dato mejor que un `provider` inventado: es el que permite
 * conciliar contra el extracto del banco.
 *
 * MIGRACIÓN PENDIENTE PARA EL INTEGRADOR (no aplicada, ver el informe):
 *   ALTER TABLE payments DROP CONSTRAINT ck_payments_provider;
 *   CREATE TABLE ... provider IN ('CASH_REGISTRY','CARD_TERMINAL');
 * más `CARD_TERMINAL` en `PaymentProvider` y en `meta/enums`. Con esa migración,
 * este endpoint puede empezar a exigir `provider: 'CARD_TERMINAL'` sin tocar el
 * service, porque ya se valida por separado.
 */
import { z } from 'zod';

import { PaymentStatus } from '../../shared/domain/index.js';
import { buildListQuerySchema } from '../../shared/http/index.js';
import { resourceIdField } from '../../shared/validation/index.js';

/** Texto acotado y no vacío. */
const shortText = (max: number, label: string) =>
  z
    .string({ error: `${label} es obligatorio` })
    .trim()
    .min(1, `${label} no puede estar vacío`)
    .max(max, `${label} no puede superar ${max} caracteres`);

/** Instante ISO-8601 de la query. */
const isoInstantQuery = z
  .string()
  .datetime({ offset: true, message: 'Debe ser un instante ISO-8601' })
  .optional();

/**
 * Únicos métodos de pago del sistema.
 *
 * Es una lista explícita, no `z.enum(PaymentMethod)`: el enum del dominio incluye
 * `TRANSFER` y `ONLINE` para el esquema, y esta fase ha decidido que no se cobran.
 * Aceptarlos "por si acaso" sería documentar una capacidad que no existe.
 */
export const SUPPORTED_PAYMENT_METHODS = ['CASH', 'CARD'] as const;

/**
 * El único `provider` real del sistema: la caja.
 *
 * No se declara `CARD_TERMINAL` porque el CHECK de `payments.provider` lo
 * rechazaría; ver la nota de la cabecera de este fichero.
 */
export const SUPPORTED_PAYMENT_PROVIDERS = ['CASH_REGISTRY'] as const;

/** Columnas ordenables de `GET /api/v1/payments`. */
export const PAYMENTS_SORT_COLUMNS = ['created_at', 'amount_minor', 'approved_at'] as const;

/** Orden por defecto: los cobros más recientes primero. */
export const PAYMENTS_SORT_DEFAULT = 'created_at';

// --------------------------------------------------------------------------
// Listado y detalle
// --------------------------------------------------------------------------

/** `GET /api/v1/payments` (API.md 7.13). */
export const listPaymentsQuerySchema = buildListQuerySchema({
  orderId: resourceIdField.optional(),
  method: z.enum(SUPPORTED_PAYMENT_METHODS).optional(),
  provider: z.enum(SUPPORTED_PAYMENT_PROVIDERS).optional(),
  status: z.enum(PaymentStatus).optional(),
  from: isoInstantQuery,
  to: isoInstantQuery,
  referenceNumber: shortText(100, 'La referencia').optional(),
});

/** `GET /api/v1/payments/:id`. */
export const paymentIdParamsSchema = z.object({ id: resourceIdField }).strict();

/** Tipos inferidos del listado. */
export type ListPaymentsQuery = z.infer<typeof listPaymentsQuerySchema>;

// --------------------------------------------------------------------------
// Cobro
// --------------------------------------------------------------------------

/**
 * `POST /api/v1/payments` (API.md 7.13).
 *
 * `method` es un `enum` explícito de los dos métodos reales. El cobro con
 * datáfono EXIGE `providerReference`: es el número de aprobación que anota el
 * cajero y, sin él, la conciliación del día es imposible. En efectivo no se
 * pide referencia, porque la caja no emite ninguna.
 *
 * `amountMinor` es el importe que se IMPUTA al pedido. En efectivo, el cajero
 * manda además `receivedMinor` (lo que entregó el cliente) y la diferencia es
 * cambio: nunca se guarda como pago (BR-MONEY-007/008). `receivedMinor <
 * amountMinor` es un `422`, no un pago negativo.
 */
export const registerPaymentBodySchema = z
  .object({
    orderId: resourceIdField,
    method: z.enum(SUPPORTED_PAYMENT_METHODS, {
      error: 'El método de pago debe ser CASH o CARD',
    }),
    amountMinor: z
      .number({ error: 'El importe debe ser un número entero en centavos' })
      .int('El importe debe ser un entero en centavos')
      .positive('El importe debe ser mayor que cero')
      .max(100_000_000, 'El importe es demasiado alto'),
    /**
     * Sólo `CASH_REGISTRY`: el efectivo sale de la caja. El cobro con datáfono se
     * identifica por `method = 'CARD'` y su `providerReference` (ver la nota de la
     * cabecera del fichero).
     */
    provider: z.enum(SUPPORTED_PAYMENT_PROVIDERS).optional(),
    /**
     * Referencia que ANOTA el cajero: el número de aprobación del datáfono o los
     * últimos cuatro dígitos. NO es un PAN y no se valida como tarjeta (BR-SEC-006).
     */
    providerReference: shortText(100, 'La referencia del cobro').optional(),
    /** Referencia interna del cajero (nº de recibo del banco, etc.). */
    referenceNumber: shortText(100, 'La referencia').optional(),
    /** Efectivo entregado. Sólo tiene sentido con `CASH`. */
    receivedMinor: z
      .number()
      .int('El efectivo recibido debe ser un entero en centavos')
      .positive('El efectivo recibido debe ser mayor que cero')
      .max(100_000_000, 'El efectivo recibido es demasiado alto')
      .optional(),
    /** Secuencial de recibo fiscal impreso. */
    receiptNumber: shortText(50, 'El número de recibo').optional(),
    notes: shortText(300, 'La nota del pago').optional(),
    /**
     * Propina. NO entra en `orders.total_minor` (BR-MONEY-009): se registra
     * aparte para que el total del pedido siga siendo contablemente correcto.
     */
    tipMinor: z
      .number()
      .int('La propina debe ser un entero en centavos')
      .min(0, 'La propina no puede ser negativa')
      .max(100_000_000, 'La propina es demasiado alta')
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    // Con datáfono, sin la referencia de aprobación no hay conciliación posible
    // (el equivalente funcional de BR-PAY-003 para un cobro local).
    if (value.method === 'CARD' && value.providerReference === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['providerReference'],
        message:
          'Anote la referencia de aprobación del datáfono (no es el número de la tarjeta)',
      });
    }
    // En efectivo, el efectivo entregado nunca puede ser menor que el importe.
    if (value.method === 'CASH' && value.receivedMinor !== undefined && value.receivedMinor < value.amountMinor) {
      ctx.addIssue({
        code: 'custom',
        path: ['receivedMinor'],
        message: 'El efectivo recibido no puede ser menor que el importe del cobro',
      });
    }
    // Con datáfono no hay "entregar de más": el dinero ya entró en la cuenta.
    if (value.method === 'CARD' && value.receivedMinor !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['receivedMinor'],
        message: 'El cobro con tarjeta no lleva efectivo recibido',
      });
    }
  });

/** Tipo inferido del body de cobro. */
export type RegisterPaymentBody = z.infer<typeof registerPaymentBodySchema>;

/**
 * `POST /api/v1/payments/:id/refund` (API.md 7.13).
 *
 * `reason` es obligatorio (BR-PAY-010) y el CHECK `ck_payment_refunds_reason`
 * exige `length(reason) > 0`, así que el esquema es la primera de las dos líneas
 * de defensa.
 */
export const refundPaymentBodySchema = z
  .object({
    amountMinor: z
      .number({ error: 'El importe a reembolsar debe ser un número entero en centavos' })
      .int('El importe a reembolsar debe ser un entero en centavos')
      .positive('El importe a reembolsar debe ser mayor que cero')
      .max(100_000_000, 'El importe a reembolsar es demasiado alto'),
    reason: z
      .string({ error: 'El motivo del reembolso es obligatorio' })
      .trim()
      .min(2, 'El motivo del reembolso debe tener al menos 2 caracteres')
      .max(300, 'El motivo del reembolso no puede superar 300 caracteres'),
    /** Referencia que anota el cajero del reembolso. NO es un PAN. */
    providerReference: shortText(100, 'La referencia del reembolso').optional(),
    notifyCustomer: z.boolean().default(true),
  })
  .strict();

/** Tipo inferido del body de reembolso. */
export type RefundPaymentBody = z.infer<typeof refundPaymentBodySchema>;

/**
 * Longitud de la cabecera `Idempotency-Key`.
 *
 * `uuid` v4 tiene 36 caracteres con guiones. Se admite también la forma sin
 * guiones porque algunos clientes (y algunos proxies) la recortan; lo que NO se
 * admite es una clave arbitraria, porque un `x` repetido por error desactivaría
 * la idempotencia de todo el sistema de pagos.
 */
export const IDEMPOTENCY_KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$|^[0-9a-f]{32}$/i;

/** Nombres de las cabeceras que se leen para el cobro. */
export const IDEMPOTENCY_HEADER = 'idempotency-key';
