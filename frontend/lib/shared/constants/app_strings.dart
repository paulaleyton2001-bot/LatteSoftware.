// Textos de NEGOCIO de la app del cliente.
//
// MOTIVACIÓN (regla dura del proyecto): un texto de negocio repetido en varias
// pantallas se corrige una vez aquí y no tres veces en tres widgets. Solo viven
// aquí las cadenas que:
//   1. se repiten, o
//   2. son un requisito contractual del cliente (por ejemplo "el pago se hace en
//      el local", que NO puede variar porque es la promesa del producto).
//
// NO viven aquí: etiquetas de botones sueltas, `Semantics` de un control concreto,
// ni mensajes de error (los produce el backend en `error.message` y los
// normaliza `core/error/error_mapper.dart`).
//
// El vocabulario de estados (Disponible / Ocupada / En curso…) NO está aquí:
// vive en `shared/widgets/ui/status_badge_visuals*.dart`, que es el único lugar
// autorizado a mapear estados del backend a texto (docs/DESIGN-TOKENS.md §6.1).

/// Catálogo de textos de negocio compartidos.
abstract final class AppStrings {
  const AppStrings._();

  // -------------------------------------------------------------------- Marca
  static const String appName = 'Latte Coffee';

  // ---------------------------------------------------------------- Checkout
  /// AVISO OBLIGATORIO DEL PRODUCTO: no hay pasarela de pagos. El checkout no
  /// pide número de tarjeta, no redirige y no integra pagos: solo registra el
  /// pedido. El cobro ocurre en el local, en efectivo o con tarjeta.
  static const String payAtStore = 'El pago se realiza en el local, en efectivo o con tarjeta.';
  static const String payAtStoreLong =
      'Registramos tu pedido y lo pagas al llegar, en efectivo o con tarjeta. '
      'No necesitas tarjeta en la app.';

  /// Pregunta que el cliente pidió hacer explícita al reservar/consumir aquí.
  static const String reserveChairQuestion = '¿Quieres reservar una silla?';

  // -------------------------------------------------------------------- Menú
  static const String searchHint = 'Buscar café, comida o bebida…';
  static const String sectionFeatured = 'Destacados';
  static const String sectionPromos = 'Promociones';
  static const String sectionAll = 'Todo el menú';
  static const String sectionCategories = 'Categorías';
  static const String allCategories = 'Todo';

  /// Frase bajo el saludo del menú.
  ///
  /// Vive aquí, y no en el widget, por un motivo concreto: la cadena anterior
  /// (`'¿Qué te…amos hoy?'`) tenía letras ÁRABES intercaladas dentro de la
  /// palabra y el usuario la veía como texto roto en el móvil. Al ser un texto de
  /// negocio de la pantalla tiene un solo lugar donde se puede corregir, y
  /// `test/source_text_hygiene_test.dart` impide que vuelva a colarse un carácter
  /// de otro alfabeto en cualquier cadena del código.
  static const String menuPrompt = '¿Qué te descubrimos hoy?';

  // ------------------------------------------------------------------- Silla
  static const String chairRentalLabel = 'Alquiler de silla';
  static const String durationLabel = 'Duración';
  static const String chairMapLegend = 'Leyenda del mapa';

  // ------------------------------------------------------------------ Perfil
  static const String paymentAtStoreHistory = 'Pagos en el local';
  static const String sessionsTitle = 'Sesiones activas';
  static const String notificationsTitle = 'Notificaciones';

  // ------------------------------------------------------------- Confirmación
  static const String orderConfirmedTitle = '¡Pedido registrado!';
  static const String orderNumberLabel = 'Número de pedido';
  static const String nextStepsTitle = '¿Y ahora?';

  // --------------------------------------------------------------------- POS
  // Textos que aparecen en varias pantallas del mostrador (POS, cobro, tablero)
  // y en el panel de administración. Se corrigen una vez aquí.

  /// Subtítulo del botón grande de cobro.
  static const String chargeButton = 'Cobrar';
  static const String chargeButtonHint = 'Cobra el pedido en curso';

  /// Mensaje contractual del POS: no hay pasarela, el cobro es manual.
  static const String posNoGateway =
      'Aquí no hay pasarela: el cajero anota el pago que recibe en el local.';

  /// Aviso de cobro sin conexión. NO promete sincronización: no existe.
  static const String posOfflineChargeTitle = 'Sin conexión: cobra a mano';

  static const String posOfflineChargeBody =
      'No hay forma de registrar el cobro en el servidor ahora mismo. Anótalo en '
      'la caja registradora y escribe el número de pedido para regularizarlo '
      'cuando vuelva la red.';

  /// Atajos de teclado del POS, visibles junto a la acción que aceleran.
  static const String shortcutSearch = 'F1';
  static const String shortcutCharge = 'Enter';
  static const String shortcutNewOrder = 'F2';
  static const String shortcutCancel = 'Esc';
  static const String shortcutClose = 'Esc';

  /// Tipos de pedido (`OrderType` de `docs/API.md` §6.2).
  static const String orderTypeTakeaway = 'Para llevar';
  static const String orderTypeDineIn = 'En el local';
  static const String orderTypeChairRental = 'Alquiler de silla';

  /// Secciones del POS en móvil (una columna, por pestañas).
  static const String posTabCatalog = 'Catálogo';
  static const String posTabOrder = 'Pedido';
  static const String posTabCharge = 'Cobro';

  /// Diálogo de cobro.
  static const String paymentMethodCash = 'Efectivo';
  static const String paymentMethodCard = 'Tarjeta (datáfono)';
  static const String paymentReceivedLabel = 'Monto recibido';
  static const String paymentChangeLabel = 'Cambio';
  static const String paymentReferenceLabel = 'Referencia de aprobación';
  static const String paymentReferenceHelp =
      'Anota el número que dio el datáfono. Queda en el comprobante para la '
      'conciliación del cierre de caja.';
  static const String paymentExactAmount = 'Exacto';
  static const String paymentConfirm = 'Confirmar cobro';

  /// Pistas de los atajos, en una línea.
  static const String shortcutsHint =
      'F1 buscar · Enter cobrar · F2 nuevo pedido · Esc cerrar';

  // ------------------------------------------------------------------ Tablero
  static const String ordersBoardTitle = 'Tablero de pedidos';
  static const String ordersBoardColumnNew = 'Nuevos';
  static const String ordersBoardColumnConfirmed = 'Confirmados';
  static const String ordersBoardColumnPreparing = 'Preparando';
  static const String ordersBoardColumnReady = 'Listos';
  static const String ordersBoardColumnDelivered = 'Entregados';
  static const String ordersBoardColumnCancelled = 'Cancelados';
  static const String orderAdvanceAction = 'Avanzar';

  // ------------------------------------------------------------------- Admin
  static const String adminAreaTitle = 'Administración';
  static const String adminRestrictedTitle = 'Zona de personal';
  static const String adminRestrictedBody =
      'Esta sección es para el equipo del local. Tu cuenta de cliente no tiene '
      'acceso a ella.';

  /// Etiquetas de los destinos del panel (las de navegación, no de contenido).
  static const String navDashboard = 'Resumen';
  static const String navOrders = 'Órdenes';
  static const String navChairs = 'Sillas';
  static const String navReservations = 'Reservas';
  static const String navInventory = 'Inventario';
  static const String navProducts = 'Productos';
  static const String navPayments = 'Pagos';
  static const String navCustomers = 'Clientes';
  static const String navReports = 'Reportes';
  static const String navDiscounts = 'Descuentos';
  static const String navUsers = 'Usuarios';
  static const String navSettings = 'Configuración';

  /// Presets de rango de los reportes (`docs/API.md` §5.2).
  static const String presetToday = 'Hoy';
  static const String presetYesterday = 'Ayer';
  static const String presetLast7 = 'Últimos 7 días';
  static const String presetLast30 = 'Últimos 30 días';
  static const String presetThisMonth = 'Este mes';
  static const String presetLastMonth = 'Mes anterior';
  static const String presetCustom = 'Personalizado';

  /// Estados vacíos genéricos del panel.
  static const String adminEmptyOrders = 'No hay pedidos con estos filtros.';
  static const String adminEmptyProducts = 'No hay productos que coincidan.';
  static const String adminEmptyInventory = 'No hay ítems de inventario.';
  static const String adminEmptyPayments = 'No hay pagos con estos filtros.';
  static const String adminEmptyReservations = 'No hay reservas en este rango.';
  static const String adminEmptyDiscounts = 'No hay cupones que coincidan.';
  static const String adminEmptyCustomers = 'No hay clientes que coincidan.';
  static const String adminEmptyUsers = 'No hay usuarios que coincidan.';
  static const String adminEmptyActiveRentals = 'No hay alquileres en curso.';
}
