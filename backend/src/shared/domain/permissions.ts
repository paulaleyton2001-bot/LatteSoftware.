/**
 * Catálogo de permisos del sistema (DESIGN.md 9.2).
 *
 * Las claves `modulo:accion` son la MISMA fuente para tres cosas, y por eso
 * viven en el dominio y no duplicadas:
 *  1. Los middlewares: `requirePermission(PERMISSION.USERS_READ)`.
 *  2. La semilla `roles-permissions.seed.ts`, que inserta estas 84 filas en
 *     `permissions`.
 *  3. `GET /api/v1/meta/roles`, que las lee de la base de datos, y
 *     `GET /auth/me`, que devuelve las que el actor tiene de verdad.
 *
 * Si una clave se escribiera a mano en una ruta y no estuviera aquí, el
 * `requirePermission` no encontraría nada en `role_permissions` y el endpoint
 * quedaría cerrado para siempre: el compilador es la primera barrera y
 * `PermissionKey` es la segunda.
 */
import type { PermissionModule } from './enums.js';

/** Las 84 claves de DESIGN.md 9.2, agrupadas por módulo. */
export const PERMISSION = {
  // --- auth (7)
  AUTH_REGISTER: 'auth:register',
  AUTH_LOGIN: 'auth:login',
  AUTH_REFRESH: 'auth:refresh',
  AUTH_LOGOUT: 'auth:logout',
  AUTH_PASSWORD_RESET: 'auth:password_reset',
  AUTH_PROFILE_READ: 'auth:profile:read',
  AUTH_PROFILE_UPDATE: 'auth:profile:update',

  // --- users (7)
  USERS_READ: 'users:read',
  USERS_CREATE: 'users:create',
  USERS_UPDATE: 'users:update',
  USERS_DELETE: 'users:delete',
  USERS_ROLES_ASSIGN: 'users:roles:assign',
  USERS_STATUS_UPDATE: 'users:status:update',
  USERS_PASSWORD_RESET: 'users:password:reset',

  // --- customers (2)
  CUSTOMERS_READ: 'customers:read',
  CUSTOMERS_UPDATE: 'customers:update',

  // --- business (4)
  BUSINESS_READ: 'business:read',
  BUSINESS_UPDATE: 'business:update',
  BUSINESS_HOURS_UPDATE: 'business:hours:update',
  BUSINESS_HOLIDAYS_MANAGE: 'business:holidays:manage',

  // --- locations (3)
  LOCATIONS_READ: 'locations:read',
  LOCATIONS_CREATE: 'locations:create',
  LOCATIONS_UPDATE: 'locations:update',

  // --- zones (4)
  ZONES_READ: 'zones:read',
  ZONES_CREATE: 'zones:create',
  ZONES_UPDATE: 'zones:update',
  ZONES_DELETE: 'zones:delete',

  // --- chairs (7)
  CHAIRS_READ: 'chairs:read',
  CHAIRS_MAP: 'chairs:map',
  CHAIRS_CREATE: 'chairs:create',
  CHAIRS_UPDATE: 'chairs:update',
  CHAIRS_DELETE: 'chairs:delete',
  CHAIRS_STATUS_UPDATE: 'chairs:status:update',
  CHAIRS_HISTORY_READ: 'chairs:history:read',

  // --- reservations (8)
  RESERVATIONS_READ: 'reservations:read',
  RESERVATIONS_READ_ANY: 'reservations:read:any',
  RESERVATIONS_CREATE: 'reservations:create',
  RESERVATIONS_UPDATE: 'reservations:update',
  RESERVATIONS_CANCEL: 'reservations:cancel',
  RESERVATIONS_CHECKIN: 'reservations:checkin',
  RESERVATIONS_EXTEND: 'reservations:extend',

  // --- rentals (6)
  RENTALS_READ: 'rentals:read',
  RENTALS_READ_ANY: 'rentals:read:any',
  RENTALS_CREATE: 'rentals:create',
  RENTALS_EXTEND: 'rentals:extend',
  RENTALS_COMPLETE: 'rentals:complete',
  RENTALS_CANCEL: 'rentals:cancel',

  // --- categories (4)
  CATEGORIES_READ: 'categories:read',
  CATEGORIES_CREATE: 'categories:create',
  CATEGORIES_UPDATE: 'categories:update',
  CATEGORIES_DELETE: 'categories:delete',

  // --- products (6)
  PRODUCTS_READ: 'products:read',
  PRODUCTS_CREATE: 'products:create',
  PRODUCTS_UPDATE: 'products:update',
  PRODUCTS_DELETE: 'products:delete',
  PRODUCTS_AVAILABILITY_UPDATE: 'products:availability:update',
  PRODUCTS_DUPLICATE: 'products:duplicate',

  // --- inventory (4)
  INVENTORY_READ: 'inventory:read',
  INVENTORY_WRITE: 'inventory:write',
  INVENTORY_ADJUST: 'inventory:adjust',
  INVENTORY_MOVEMENTS_READ: 'inventory:movements:read',

  // --- discounts (5)
  DISCOUNTS_READ: 'discounts:read',
  DISCOUNTS_CREATE: 'discounts:create',
  DISCOUNTS_UPDATE: 'discounts:update',
  DISCOUNTS_DELETE: 'discounts:delete',
  DISCOUNTS_VALIDATE: 'discounts:validate',

  // --- orders (8)
  ORDERS_READ: 'orders:read',
  ORDERS_READ_ANY: 'orders:read:any',
  ORDERS_CREATE: 'orders:create',
  ORDERS_UPDATE: 'orders:update',
  ORDERS_DELETE: 'orders:delete',
  ORDERS_CANCEL: 'orders:cancel',
  ORDERS_STATUS_UPDATE: 'orders:status:update',
  ORDERS_RECEIPT_READ: 'orders:receipt:read',

  // --- payments (4)
  PAYMENTS_READ: 'payments:read',
  PAYMENTS_READ_ANY: 'payments:read:any',
  PAYMENTS_CREATE: 'payments:create',
  PAYMENTS_REFUND: 'payments:refund',

  // --- reports (2)
  REPORTS_READ: 'reports:read',
  REPORTS_EXPORT: 'reports:export',

  // --- notifications (2)
  NOTIFICATIONS_READ: 'notifications:read',
  NOTIFICATIONS_UPDATE_PREFERENCES: 'notifications:update_preferences',

  // --- audit (1)
  AUDIT_READ: 'audit:read',
} as const;

/** Una clave `modulo:accion` válida. */
export type PermissionKey = (typeof PERMISSION)[keyof typeof PERMISSION];

/** Las 84 claves, en el orden de DESIGN.md 9.2 (que es el de los módulos). */
export const PERMISSION_KEYS: readonly PermissionKey[] = Object.freeze(
  Object.values(PERMISSION) as PermissionKey[],
);

/** Descripción legible de cada permiso, para la matriz de la UI. */
export const PERMISSION_DESCRIPTION: Readonly<Record<PermissionKey, string>> = Object.freeze({
  [PERMISSION.AUTH_REGISTER]: 'Crear su propia cuenta de cliente',
  [PERMISSION.AUTH_LOGIN]: 'Iniciar sesión',
  [PERMISSION.AUTH_REFRESH]: 'Renovar el token de sesión',
  [PERMISSION.AUTH_LOGOUT]: 'Cerrar sesión',
  [PERMISSION.AUTH_PASSWORD_RESET]: 'Restablecer su contraseña',
  [PERMISSION.AUTH_PROFILE_READ]: 'Ver su propio perfil',
  [PERMISSION.AUTH_PROFILE_UPDATE]: 'Editar su propio perfil',
  [PERMISSION.USERS_READ]: 'Ver usuarios',
  [PERMISSION.USERS_CREATE]: 'Crear usuarios',
  [PERMISSION.USERS_UPDATE]: 'Editar usuarios',
  [PERMISSION.USERS_DELETE]: 'Eliminar usuarios',
  [PERMISSION.USERS_ROLES_ASSIGN]: 'Asignar y quitar roles',
  [PERMISSION.USERS_STATUS_UPDATE]: 'Activar, inactivar o bloquear usuarios',
  [PERMISSION.USERS_PASSWORD_RESET]: 'Restablecer la contraseña de un usuario',
  [PERMISSION.CUSTOMERS_READ]: 'Ver clientes',
  [PERMISSION.CUSTOMERS_UPDATE]: 'Editar clientes',
  [PERMISSION.BUSINESS_READ]: 'Ver la configuración del negocio',
  [PERMISSION.BUSINESS_UPDATE]: 'Editar la configuración del negocio',
  [PERMISSION.BUSINESS_HOURS_UPDATE]: 'Editar el horario del negocio',
  [PERMISSION.BUSINESS_HOLIDAYS_MANAGE]: 'Gestionar los días festivos',
  [PERMISSION.LOCATIONS_READ]: 'Ver sedes',
  [PERMISSION.LOCATIONS_CREATE]: 'Crear sedes',
  [PERMISSION.LOCATIONS_UPDATE]: 'Editar sedes',
  [PERMISSION.ZONES_READ]: 'Ver zonas',
  [PERMISSION.ZONES_CREATE]: 'Crear zonas',
  [PERMISSION.ZONES_UPDATE]: 'Editar zonas',
  [PERMISSION.ZONES_DELETE]: 'Eliminar zonas',
  [PERMISSION.CHAIRS_READ]: 'Ver sillas y mesas',
  [PERMISSION.CHAIRS_MAP]: 'Ver el mapa de espacios',
  [PERMISSION.CHAIRS_CREATE]: 'Crear sillas y mesas',
  [PERMISSION.CHAIRS_UPDATE]: 'Editar sillas y mesas',
  [PERMISSION.CHAIRS_DELETE]: 'Eliminar sillas y mesas',
  [PERMISSION.CHAIRS_STATUS_UPDATE]: 'Cambiar el estado de una silla',
  [PERMISSION.CHAIRS_HISTORY_READ]: 'Ver el historial de una silla',
  [PERMISSION.RESERVATIONS_READ]: 'Ver reservas propias',
  [PERMISSION.RESERVATIONS_READ_ANY]: 'Ver reservas de cualquier cliente',
  [PERMISSION.RESERVATIONS_CREATE]: 'Crear reservas',
  [PERMISSION.RESERVATIONS_UPDATE]: 'Editar reservas',
  [PERMISSION.RESERVATIONS_CANCEL]: 'Cancelar reservas',
  [PERMISSION.RESERVATIONS_CHECKIN]: 'Registrar la llegada de una reserva',
  [PERMISSION.RESERVATIONS_EXTEND]: 'Extender reservas',
  [PERMISSION.RENTALS_READ]: 'Ver alquileres propios',
  [PERMISSION.RENTALS_READ_ANY]: 'Ver alquileres de cualquier cliente',
  [PERMISSION.RENTALS_CREATE]: 'Abrir alquileres',
  [PERMISSION.RENTALS_EXTEND]: 'Extender alquileres',
  [PERMISSION.RENTALS_COMPLETE]: 'Cerrar alquileres',
  [PERMISSION.RENTALS_CANCEL]: 'Cancelar alquileres',
  [PERMISSION.CATEGORIES_READ]: 'Ver categorías',
  [PERMISSION.CATEGORIES_CREATE]: 'Crear categorías',
  [PERMISSION.CATEGORIES_UPDATE]: 'Editar categorías',
  [PERMISSION.CATEGORIES_DELETE]: 'Eliminar categorías',
  [PERMISSION.PRODUCTS_READ]: 'Ver productos',
  [PERMISSION.PRODUCTS_CREATE]: 'Crear productos',
  [PERMISSION.PRODUCTS_UPDATE]: 'Editar productos',
  [PERMISSION.PRODUCTS_DELETE]: 'Eliminar productos',
  [PERMISSION.PRODUCTS_AVAILABILITY_UPDATE]: 'Marcar un producto como disponible o no',
  [PERMISSION.PRODUCTS_DUPLICATE]: 'Duplicar un producto',
  [PERMISSION.INVENTORY_READ]: 'Ver inventario',
  [PERMISSION.INVENTORY_WRITE]: 'Crear y editar ítems de inventario',
  [PERMISSION.INVENTORY_ADJUST]: 'Ajustar existencias',
  [PERMISSION.INVENTORY_MOVEMENTS_READ]: 'Ver movimientos de inventario',
  [PERMISSION.DISCOUNTS_READ]: 'Ver descuentos',
  [PERMISSION.DISCOUNTS_CREATE]: 'Crear descuentos',
  [PERMISSION.DISCOUNTS_UPDATE]: 'Editar descuentos',
  [PERMISSION.DISCOUNTS_DELETE]: 'Eliminar descuentos',
  [PERMISSION.DISCOUNTS_VALIDATE]: 'Validar un cupón',
  [PERMISSION.ORDERS_READ]: 'Ver pedidos propios',
  [PERMISSION.ORDERS_READ_ANY]: 'Ver pedidos de cualquier cliente',
  [PERMISSION.ORDERS_CREATE]: 'Crear pedidos',
  [PERMISSION.ORDERS_UPDATE]: 'Editar pedidos propios',
  [PERMISSION.ORDERS_DELETE]: 'Eliminar pedidos',
  [PERMISSION.ORDERS_CANCEL]: 'Cancelar pedidos',
  [PERMISSION.ORDERS_STATUS_UPDATE]: 'Cambiar el estado de un pedido',
  [PERMISSION.ORDERS_RECEIPT_READ]: 'Ver el recibo de un pedido',
  [PERMISSION.PAYMENTS_READ]: 'Ver pagos propios',
  [PERMISSION.PAYMENTS_READ_ANY]: 'Ver pagos de cualquier cliente',
  [PERMISSION.PAYMENTS_CREATE]: 'Registrar pagos',
  [PERMISSION.PAYMENTS_REFUND]: 'Reembolsar pagos',
  [PERMISSION.REPORTS_READ]: 'Ver reportes operativos',
  [PERMISSION.REPORTS_EXPORT]: 'Exportar reportes',
  [PERMISSION.NOTIFICATIONS_READ]: 'Ver notificaciones',
  [PERMISSION.NOTIFICATIONS_UPDATE_PREFERENCES]: 'Cambiar preferencias de notificación',
  [PERMISSION.AUDIT_READ]: 'Consultar la auditoría',
});

/** Módulo al que pertenece cada clave: el segmento anterior a `:`. */
export const PERMISSION_MODULE_OF: Readonly<Record<PermissionKey, PermissionModule>> = Object.freeze(
  Object.fromEntries(
    PERMISSION_KEYS.map((key) => [key, key.split(':')[0] as PermissionModule]),
  ) as Record<PermissionKey, PermissionModule>,
);

/** `true` si la clave tiene el formato `modulo:accion` con módulo conocido. */
export function isPermissionKey(value: unknown): value is PermissionKey {
  return (
    typeof value === 'string' &&
    (PERMISSION_KEYS as readonly string[]).includes(value)
  );
}

/** Total de permisos declarados. Debe ser 84 (DESIGN.md 9.3). */
export const TOTAL_PERMISSIONS = PERMISSION_KEYS.length;
