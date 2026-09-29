// Rutas de la API REST v1. ÚNICO lugar donde viven los paths.
//
// El host NO está aquí: sale de `AppConfig.apiBaseUrl` (--dart-define). Estas
// constantes son relativas al `baseUrl` del `Dio`, tal como están escritas en
// `docs/API.md` §7 (la versión `v1` ya viaja en el baseUrl).
//
// Regla: ninguna feature escribe `'/auth/login'` a mano; usa `ApiEndpoints`.

/// Paths de `docs/API.md` §7, agrupados por recurso.
abstract final class ApiEndpoints {
  const ApiEndpoints._();

  // ----------------------------------------------------------------- System
  /// ÚNICO endpoint fuera de `/api/v1` (API.md §7).
  static const String health = '/health';
  static const String metaRoles = '/meta/roles';
  static const String metaEnums = '/meta/enums';

  // ------------------------------------------------------------------- Auth
  static const String authRegister = '/auth/register';
  static const String authLogin = '/auth/login';
  static const String authRefresh = '/auth/refresh';
  static const String authLogout = '/auth/logout';
  static const String authLogoutAll = '/auth/logout-all';
  static const String authForgotPassword = '/auth/forgot-password';
  static const String authResetPassword = '/auth/reset-password';
  static const String authChangePassword = '/auth/change-password';
  static const String authMe = '/auth/me';
  static const String authSessions = '/auth/sessions';

  /// `DELETE /auth/sessions/:id` — revoca una sesión concreta.
  static String authSessionById(int id) => '$authSessions/$id';

  // -------------------------------------------------------------- Catálogo
  /// Catálogo público: se consulta sin sesión para mostrar el menú como invitado.
  /// OJO: la API resuelve el producto por `id` (`GET /products/:id`), NO por
  /// `slug`. La ruta de cliente `/menu/:slug` tendrá que resolver el slug con
  /// `GET /products?q=` o con un endpoint de lookup cuando exista.
  static const String products = '/products';
  static const String categories = '/categories';

  /// `GET /menu` — carta pública: solo productos disponibles y activos, sin
  /// sesión. Es la lectura ANÓNIMA del catálogo (`API.md` §7, "Carta pública").
  static const String menu = '/menu';

  /// `GET /products/:id` — producto completo con `variants[]` y `addons[]`.
  static String productById(int id) => '$products/$id';

  /// `PATCH /products/:id/availability` — disponible / agotado. Endpoint
  /// PROPIO porque disponibilidad comercial y existencia en el catálogo no son
  /// lo mismo (BR-PRICE-006).
  static String productAvailability(int id) => '$products/$id/availability';

  /// `PATCH /products/:id/active` — activar / desactivar en el catálogo.
  static String productActive(int id) => '$products/$id/active';

  /// `POST /products/:id/duplicate` — requiere `sku` único.
  static String productDuplicate(int id) => '$products/$id/duplicate';

  static String productVariants(int id) => '$products/$id/variants';
  static String productAddons(int id) => '$products/$id/addons';
  static String productIngredients(int id) => '$products/$id/ingredients';

  /// `PATCH|DELETE /products/variants/:variantId`.
  static String productVariant(int variantId) => '$products/variants/$variantId';

  /// `PATCH|DELETE /products/addons/:addonId`.
  static String productAddon(int addonId) => '$products/addons/$addonId';

  static String categoryById(int id) => '$categories/$id';

  // ---------------------------------------------------------------- Negocio
  // `GET /business` (permiso `business:read`, que un CUSTOMER tiene completo).
  // OJO: la referencia en `api_endpoints.dart` original decía que `GET
  // /business/status` no existía; sí existe en el backend real
  // (`backend/src/modules/business/business.routes.ts` L113) y es PÚBLICA, pero
  // no está en `docs/API.md`. Ver `features/pos` y `features/home`: el estado
  // "abierto/cerrado" se toma de aquí cuando está disponible.
  static const String business = '/business';

  /// `GET /business/status` — ¿está el local abierto ahora? DESVIACIÓN
  /// DOCUMENTADA: existe en el router del backend y NO en `docs/API.md`.
  static const String businessStatus = '/business/status';
  static const String businessHours = '/business/hours';
  static const String businessHolidays = '/business/holidays';

  /// `GET /locations` (permiso `locations:read`). El mapa de sillas exige
  /// `locationId` en la query, así que hay que resolver primero la sede.
  static const String locations = '/locations';

  /// `DELETE /locations/:id` — DESVIACIÓN DOCUMENTADA: existe en
  /// `locations.routes.ts` (L141) y no está en `docs/API.md` §7.5.
  static String locationById(int id) => '$locations/$id';

  // ----------------------------------------------------------------- Sillas
  static const String chairs = '/chairs';

  /// `GET /chairs/map` — zonas + sillas + `countsByStatus` + `totals`, todo lo
  /// necesario para pintar el plano sin cálculos adicionales (API.md §7.7).
  static const String chairsMap = '/chairs/map';

  /// `GET /chairs/:id` — silla con `currentReservation` y `currentRental`, que es
  /// lo que permite decir "ocupada hasta las 16:40".
  static String chairById(int id) => '$chairs/$id';

  /// `PATCH /chairs/:id/status` — solo `AVAILABLE | BLOCKED | MAINTENANCE |
  /// CLEANING`; `OCCUPIED` y `RESERVED` los pone el flujo de alquileres.
  static String chairStatus(int id) => '$chairs/$id/status';

  /// `GET /chairs/:id/history` — historial de uso (`chairs:history:read`).
  static String chairHistory(int id) => '$chairs/$id/history';

  /// `GET /chairs/:id/availability` — ocupación por rango de fechas.
  static String chairAvailability(int id) => '$chairs/$id/availability';

  static String chairBlock(int id) => '$chairs/$id/block';
  static String chairUnblock(int id) => '$chairs/$id/unblock';
  static String chairMaintenance(int id) => '$chairs/$id/maintenance';
  static String chairCompleteMaintenance(int id) => '$chairs/$id/complete-maintenance';

  // ----------------------------------------------------------------- Zonas
  static const String zones = '/zones';
  static const String zonesReorder = '/zones/reorder';
  static String zoneById(int id) => '$zones/$id';

  // -------------------------------------------------------------- Reservas
  static const String reservations = '/reservations';

  /// `GET /reservations/quote` — cotización SIN crear nada. OJO: es un `GET` con
  /// query (`chairId`, `startAt`, `endAt`), no un `POST` (API.md §7.8).
  static const String reservationsQuote = '/reservations/quote';

  static String reservationById(int id) => '$reservations/$id';
  static String reservationConfirm(int id) => '$reservations/$id/confirm';
  static String reservationCheckIn(int id) => '$reservations/$id/check-in';
  static String reservationExtend(int id) => '$reservations/$id/extend';

  /// `POST /reservations/:id/cancel`.
  static String reservationCancel(int id) => '$reservations/$id/cancel';

  /// `POST /reservations/:id/complete` — check-out del alquiler.
  static String reservationComplete(int id) => '$reservations/$id/complete';

  // -------------------------------------------------------------- Alquileres
  static const String rentals = '/rentals';

  /// `GET /rentals/active` — alquileres en curso (los que muestran el temporizador).
  static const String rentalsActive = '/rentals/active';

  /// `GET /rentals/chair/:chairId/active` — `data: null` con `200` si no hay.
  static String rentalActiveByChair(int chairId) => '$rentals/chair/$chairId/active';

  /// `POST /rentals` — abrir alquiler walk-in. Crea el pedido `CHAIR_RENTAL`.
  static String rentalById(int id) => '$rentals/$id';
  static String rentalComplete(int id) => '$rentals/$id/complete';

  /// `POST /rentals/:id/extend` — extiende el alquiler activo. El saldo se suma
  /// a `orders.balance_minor` del pedido abierto.
  static String rentalExtend(int id) => '$rentals/$id/extend';

  // ---------------------------------------------------------------- Pedidos
  static const String orders = '/orders';

  static String orderById(int id) => '$orders/$id';

  /// `POST /orders/:id/items` — añade líneas a un pedido abierto.
  static String orderItems(int id) => '$orders/$id/items';

  /// `POST /orders/:id/status` — transición de estado (`toStatus`).
  static String orderStatus(int id) => '$orders/$id/status';

  static String orderConfirm(int id) => '$orders/$id/confirm';
  static String orderCancel(int id) => '$orders/$id/cancel';
  static String orderAssignChair(int id) => '$orders/$id/assign-chair';
  static String orderItemById(int itemId) => '$orders/items/$itemId';

  /// `GET /orders/:id/receipt` — comprobante construido solo con snapshots.
  static String orderReceipt(int id) => '$orders/$id/receipt';

  /// `GET /orders/:id/history` — línea de tiempo de estados.
  static String orderHistory(int id) => '$orders/$id/history';

  // -------------------------------------------------------------- Clientes
  static const String customers = '/customers';

  /// `GET /customers/me` — perfil del actor con `stats` agregadas.
  static const String customersMe = '/customers/me';

  static String customerById(int id) => '$customers/$id';

  /// ⚠️ `GET /customers/:id/orders | reservations | rentals | payments` NO están
  /// implementados en `backend/src/modules/customers/customers.routes.ts` (su
  /// cabecera lo documenta). El backend los calcula ya en el repositorio; cuando
  /// se expongan, estas rutas valdrán tal cual. Hasta entonces, el historial de
  /// un cliente se compone con `GET /orders?customerId=`, `GET /reservations?
  /// customerId=`, `GET /rentals?customerId=` y `GET /payments?…`, que sí
  /// existen. Ver `features/admin` (`admin_customers_controller.dart`).
  static String customerOrders(int id) => '$customers/$id/orders';
  static String customerReservations(int id) => '$customers/$id/reservations';
  static String customerRentals(int id) => '$customers/$id/rentals';
  static String customerPayments(int id) => '$customers/$id/payments';

  // ------------------------------------------------------------- Descuentos
  static const String discounts = '/discounts';

  static String discountById(int id) => '$discounts/$id';

  /// `POST /discounts/validate` — previsualización de cupón. No crea nada y
  /// devuelve `200` incluso si el cupón no es válido (`isValid: false`).
  static const String discountsValidate = '/discounts/validate';

  /// `GET /discounts/mine` — cupones del cliente autenticado.
  static const String discountsMine = '/discounts/mine';

  // ------------------------------------------------------------- Inventario
  static const String inventory = '/inventory';
  static const String inventoryItems = '$inventory/items';
  static const String inventoryMovements = '$inventory/movements';
  static const String inventoryAlerts = '$inventory/alerts';
  static const String inventorySuppliers = '$inventory/suppliers';

  static String inventoryItemById(int id) => '$inventoryItems/$id';

  /// `POST /inventory/items/:id/adjust` — ajuste con rastro (BR-INV-005).
  static String inventoryItemAdjust(int id) => '$inventoryItems/$id/adjust';

  // ---------------------------------------------------------------- Reportes
  static const String reports = '/reports';
  static const String reportDashboard = '$reports/dashboard';
  static const String reportSales = '$reports/sales';
  static const String reportSalesByHour = '$reports/sales-by-hour';
  static const String reportSalesByDay = '$reports/sales-by-day';
  static const String reportTopProducts = '$reports/top-products';
  static const String reportProductRevenue = '$reports/product-revenue';
  static const String reportChairOccupancy = '$reports/chair-occupancy';
  static const String reportRentalRevenue = '$reports/rental-revenue';
  static const String reportCustomers = '$reports/customers';
  static const String reportInventory = '$reports/inventory';
  static const String reportOrdersSummary = '$reports/orders-summary';

  /// `POST /reports/export` — CSV. ÚNICA respuesta que NO usa el envoltorio JSON.
  static const String reportExport = '$reports/export';

  // ------------------------------------------------------------- Notificaciones
  static const String notifications = '/notifications';
  static const String notificationPreferences = '/notifications/preferences';
  static const String notificationUnreadCount = '/notifications/unread-count';

  // ------------------------------------------------------------------ Pagos
  /// `POST /payments` es el ÚNICO `POST` idempotente de la API: exige cabecera
  /// `Idempotency-Key` (API.md §1). La cola offline (`core/storage`) lo usa como
  /// identificador de operación.
  ///
  /// La app DEL CLIENTE no lo llama: no hay pasarela de pagos, el cobro se hace
  /// en el local. Solo se lee el histórico (`GET /customers/:id/payments`).
  static const String payments = '/payments';

  /// `GET /payments/methods` — métodos habilitados y si exigen referencia. El POS
  /// construye su pantalla de cobro con ESTA lista y no con una propia: el
  /// backend refleja `businesses` y los adaptadores registrados (API.md §7.13).
  static const String paymentMethods = '/payments/methods';

  static String paymentById(int id) => '$payments/$id';
  static String paymentRefund(int id) => '$payments/$id/refund';

  /// Cabecera obligatoria de `POST /payments`. Sin ella el backend responde
  /// `400 VALIDATION_ERROR` con `details.code = 'IDEMPOTENCY_KEY_REQUIRED'`.
  static const String idempotencyHeader = 'Idempotency-Key';

  // ----------------------------------------------------------------- Usuarios
  static const String users = '/users';
  static String userById(int id) => '$users/$id';
  static String userStatus(int id) => '$users/$id/status';
  static String userRoles(int id) => '$users/$id/roles';
  static String userRole(int id, int roleId) => '$users/$id/roles/$roleId';
  static String userResetPassword(int id) => '$users/$id/reset-password';

  // --------------------------------------------------------------- Whites
  /// Rutas públicas de `API.md` §2 más el catálogo. No llevan `Authorization` y
  /// nunca disparan un refresco: un `401` en estas rutas es un fallo real
  /// (credenciales incorrectas), no una sesión vencida.
  ///
  /// `business` NO está aquí a propósito: `GET /business` es pública para el
  /// backend pero con token devuelve la configuración fiscal completa, y
  /// `isPublicPath` salta el Bearer entero. Marcarla pública degradaría la
  /// lectura. Lo que sí se marca es `businessStatus`, que es pública de verdad y
  /// no tiene datos sensibles.
  static const Set<String> publicPaths = <String>{
    authRegister,
    authLogin,
    authRefresh,
    authForgotPassword,
    authResetPassword,
    health,
    metaRoles,
    metaEnums,
    menu,
    businessStatus,
  };

  /// `true` si [path] no exige credenciales.
  ///
  /// Compara por coincidencia exacta o por prefijo de subrecurso: un recurso
  /// público sigue siendo público en sus hijos (`GET /menu/12` no necesita token).
  /// El prefijo exige la barra, así que `/menus` no se cuela como público.
  ///
  /// `products` y `categories` NO están aquí, y es deliberado. El catálogo del
  /// mostrador se lee con `GET /products`, que el backend cierra con
  /// `authenticate` + `products:read` (`catalog.routes.ts`). Marcarlas públicas
  /// quitaba el Bearer de la petición y el POS se comía un 401; la lectura
  /// anónima del catálogo es `GET /menu`, que sí es pública. El listado de
  /// productos del admin va con token por el mismo motivo.
  static bool isPublicPath(String path) {
    final String clean = path.split('?').first;
    for (final String public in publicPaths) {
      if (clean == public || clean.startsWith('$public/')) return true;
    }
    return false;
  }
}
