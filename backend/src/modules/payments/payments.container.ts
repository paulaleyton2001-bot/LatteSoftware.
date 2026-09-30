/**
 * Grafo de dependencias del módulo `payments` (DESIGN.md 3.6).
 *
 * ============================ POR QUÉ ES LOCAL ==============================
 * El contenedor oficial es `config/container.ts`, y ese fichero lo mantiene otro
 * agente en paralelo (lo cablea el integrador al final). Añadir aquí las entradas
 * de pagos habría creado un conflicto de edición sobre un archivo compartido, así
 * que este módulo construye SU PROPIO grafo, con las mismas reglas que el
 * contenedor general:
 *
 *  1. Se construye UNA vez por proceso y se reutiliza (perezoso).
 *  2. Los repositorios NO guardan la conexión: la piden a `getConnection()` en
 *     cada llamada, así que este singletón no abre la base de datos y los tests
 *     pueden apuntarla a una base en memoria sin reconstruir nada.
 *  3. El `AuditService` se TOMA del contenedor oficial, no se crea otro: la
 *     auditoría es compartida (BR-SEC-007) y tener dos instancias significaría
 *     dos `defaultBusinessId` distintos conviviendo.
 *
 * ================================= MIGRACIÓN ================================
 * Cuando el integrador registre este módulo, el contenido de
 * {@link buildPayments} debe pasar a `build()` de `config/container.ts`, junto con
 * la composición de los dos puertos (`createOrderPaymentReader` y
 * `createOrderPaymentWriter`) que el módulo de pedidos necesita.
 */
import { getContainer } from '../../config/container.js';
import { SqlitePaymentsRepository } from './payments.repository.sqlite.js';
import type { PaymentsRepository } from './payments.repository.js';
import { PaymentsService } from './payments.service.js';

/** Servicios del módulo `payments`. */
export interface PaymentsServices {
  readonly payments: PaymentsService;
  readonly repository: PaymentsRepository;
}

let services: PaymentsServices | null = null;

/**
 * Construye el grafo del módulo con las implementaciones SQLite.
 *
 * @param appliedDiscounts Lector de los descuentos aplicados de un pedido. Lo
 *        inyecta el contenedor de la integración para que `payments` no dependa de
 *        la implementación concreta de `discounts`; si no se pasa, los
 *        descuentos aplicados se devuelven vacíos.
 * @param sessionSettlement Liquidación de sesión (BR-ORDER-015). La conecta
 *        `orders/orders.container.ts` con {@link PaymentsService.attachSessionSettlement}
 *        una vez construido este service, porque los dos módulos se necesitan
 *        mutuamente y no pueden construirse en orden.
 */
export function buildPayments(
  appliedDiscounts?: ConstructorParameters<typeof PaymentsService>[2],
): PaymentsServices {
  const audit = getContainer().services.audit;
  const repository: PaymentsRepository = new SqlitePaymentsRepository();
  return {
    payments:
      appliedDiscounts === undefined
        ? new PaymentsService(repository, audit)
        : new PaymentsService(repository, audit, appliedDiscounts),
    repository,
  };
}

/**
 * Servicios de pagos, construidos en la primera llamada.
 *
 * `payments.routes.ts` lo llama UNA vez, al construir su controller.
 */
export function getPaymentsServices(): PaymentsServices {
  services ??= buildPayments();
  return services;
}

/** Inyecta el lector de descuentos y devuelve los servicios actualizados. */
export function attachAppliedDiscountReader(
  reader: NonNullable<ConstructorParameters<typeof PaymentsService>[2]>,
): PaymentsServices {
  services = buildPayments(reader);
  return services;
}
