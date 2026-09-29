/**
 * Grafo de dependencias del módulo `notifications` (DESIGN.md 3.6).
 *
 * ============================== POR QUÉ ES LOCAL ==============================
 * El contenedor oficial es `config/container.ts`, y ese fichero lo está
 * manteniendo otro agente en paralelo (lo cablea el integrador). Añadir aquí las
 * entradas de notificaciones habría creado un conflicto de edición sobre un
 * archivo compartido, así que este módulo construye SU PROPIO grafo, con las
 * mismas reglas que el contenedor general:
 *
 *  1. Se construye UNA vez por proceso y se reutiliza (perezoso).
 *  2. El repositorio NO guarda la conexión: la pide a `getConnection()` en cada
 *     llamada, así que este singletón no abre la base de datos y los tests
 *     pueden apuntarla a una base en memoria sin reconstruir nada.
 *
 * ================== CÓMO LO USA EL SIGUIENTE MÓDULO (pedidos, reservas) =====
 * Esta es la piece que falta en el enunciado de "los módulos futuros invocan
 * `enqueue`". {@link getNotificationsService} es el punto de acceso:
 *
 * ```ts
 * import { getNotificationsService } from '../notifications/notifications.container.js';
 * import { NotificationType } from '../../shared/domain/index.js';
 *
 * // DESPUÉS del commit de la transacción de negocio (BR-NOTIF-001):
 * const notificacion = getNotificationsService().enqueue({
 *   userId: pedido.customer_id,
 *   type: NotificationType.ORDER_CONFIRMED,
 *   title: 'Pedido confirmado',
 *   body: `Tu pedido ${pedido.order_number} está en preparación.`,
 *   orderId: pedido.id,
 * });
 * ```
 *
 * Es una única instancia por proceso: la bandeja (`GET /notifications`) y los
 * módulos que encolan escriben en el mismo agregado y comparten la política de
 * canales.
 *
 * ================================= MIGRACIÓN ================================
 * Cuando el integrador registre este módulo, `buildNotifications()` debe pasar a
 * `build()` de `config/container.ts` y `getNotificationsService()` debe delegar
 * en `getContainer().services.notifications`. La lista exacta de cambios está en
 * el informe de entrega.
 */
import { NotificationsService } from '../../shared/services/index.js';
import { SqliteNotificationsRepository } from './notifications.repository.sqlite.js';
import type { NotificationsRepository } from './notifications.repository.js';
import { NotificationsInboxService } from './notifications.service.js';

/** Servicios del módulo `notifications`. */
export interface NotificationsServices {
  /** Servicio COMPARTIDO de encolado (`enqueue`). Lo usan pedidos y reservas. */
  readonly notifier: NotificationsService;
  /** Servicio de la bandeja que publica los endpoints de API.md 7.17. */
  readonly inbox: NotificationsInboxService;
  /** Repositorio, por si un test necesita aserciones directas. */
  readonly repository: NotificationsRepository;
}

let services: NotificationsServices | null = null;

/** Construye el grafo del módulo con la implementación SQLite. */
function buildNotifications(): NotificationsServices {
  const repository: NotificationsRepository = new SqliteNotificationsRepository();
  const notifier = new NotificationsService(repository);
  return { notifier, inbox: new NotificationsInboxService(repository), repository };
}

/**
 * Servicios de notificaciones, construidos en la primera llamada.
 *
 * `notifications.routes.ts` lo llama UNA vez, al construir su controller, y es
 * también la puerta de entrada para los módulos que van a encolar
 * notificaciones.
 */
export function getNotificationsServices(): NotificationsServices {
  services ??= buildNotifications();
  return services;
}

/**
 * Servicio COMPARTIDO de encolado de notificaciones.
 *
 * API pública y estable para el resto de módulos (pedidos, reservas, pagos):
 *llama a `enqueue(input)` DESPUÉS del commit de la transacción de negocio. No
 * requiere ninguna otra configuración, así que un módulo futuro puede empezar a
 * encolar sin esperar a que el integrador cable `config/container.ts`.
 */
export function getNotificationsService(): NotificationsService {
  return getNotificationsServices().notifier;
}
