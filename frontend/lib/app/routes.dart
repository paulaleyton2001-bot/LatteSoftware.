// Constantes de navegación. Separate de `router.dart` para que las FEATURES
// puedan leerlas sin importar el router (y así el router pueda importar las
// features sin ciclo de imports).
//
// `router.dart` reexporta este archivo: el código viejo que importa
// `app/router.dart` sigue viendo `AppRoutes` y `RouteNames`.
//
// CAMBIOS DE ESTA FASE (features de cliente)
// -------------------------------------------
// - `product`: era `/menu/:slug`. La API resuelve el producto por `id`
//   (`GET /products/:id`, API.md §7.11) y NO tiene endpoint por `slug`, así que
//   una ruta por slug obligaría a un `GET /products?q=` con slug para resolver el
//   id en cada navegación. Ahora es `/producto/:productId` y vive FUERA del
//   shell: en móvil el detalle es una página completa, no una pestaña con barra
//   de navegación (docs/DESIGN-TOKENS.md §5).
// - `orderDetail`: era `/pedidos/:numero`. `GET /orders/:id` también resuelve por
//   id, así que pasa a `/pedido/:orderId` y sale del shell por la misma razón.
// - Se añaden las subrutas del perfil y la ruta de confirmación del checkout.

/// Rutas de la app, tal como aparecen en la barra de direcciones.
abstract final class AppRoutes {
  const AppRoutes._();

  /// Raíz. No es una pantalla: solo redirige a `/home` o `/login`.
  static const String root = '/';

  /// Destino tras iniciar sesión. Primera rama del shell del cliente.
  static const String home = '/home';

  // ------------------------------------------------------------------- Auth
  static const String login = '/login';
  static const String register = '/register';
  static const String forgotPassword = '/forgot-password';
  static const String resetPassword = '/reset-password';

  // ------------------------------------------------------- Ramas del shell
  // Estas cinco son las pestañas del cliente (Inicio / Menú / Pedidos / Silla /
  // Perfil). Son las ÚNICAS que viven dentro del `StatefulShellRoute`, que es lo
  // que hace que la barra inferior conserve el estado de cada pestaña.
  static const String menu = '/menu';
  static const String orders = '/pedidos';
  static const String chairs = '/silla';
  static const String profile = '/perfil';

  // ------------------------------------------- Pantallas fuera del shell
  // Navegación de segundo nivel: se abren a pantalla completa (con `push`, no
  // `go`) sobre la pestaña desde la que se salieron. Van fuera del shell para no
  // cambiar el contexto de navegación al volver atrás.
  static const String product = '/producto/:productId';
  static const String cart = '/carrito';
  static const String checkout = '/checkout';

  /// Confirmación tras registrar el pedido. Ruta aparte (y no un `extra` del
  /// checkout) para que sobreviva a un refresco del navegador: recargar no puede
  /// dejar a nadie con una pantalla en blanco.
  static const String checkoutDone = '/checkout/confirmado';
  static const String orderDetail = '/pedido/:orderId';
  static const String chairDetail = '/silla/:chairId';
  static const String reservations = '/reservas';

  // ------------------------------------------------------------ Subperfil
  static const String profileEdit = '/perfil/editar';
  static const String profilePassword = '/perfil/contrasena';
  static const String profileSessions = '/perfil/sesiones';
  static const String profileNotifications = '/perfil/notificaciones';
  static const String profilePayments = '/perfil/pagos';

  // ------------------------------------------------- Áreas de otros agentes
  // `/pos` y `/admin` exigen rol de personal: el guard de `router.dart` comprueba
  // `isStaff` y los permisos que devuelve `GET /auth/me`, y manda a `/home` con un
  // mensaje si no los tiene. Un CUSTOMER no ve estas rutas en la navegación y, si
  // escribe la dirección a mano, tampoco entra.
  static const String pos = '/pos';

  /// Tablero Kanban de pedidos del mostrador. Vive FUERA del shell del admin
  /// porque su layout es el del POS (columnas con scroll), no el de una tabla.
  static const String posOrdersBoard = '/pos/pedidos';

  static const String admin = '/admin';

  /// Subpáginas del panel, en el orden en que aparecen en la navegación.
  /// `admin` NO es una pantalla: es la raíz del shell y redirige al resumen.
  static const String adminDashboard = '/admin';
  static const String adminOrders = '/admin/ordenes';
  static const String adminChairs = '/admin/sillas';
  static const String adminReservations = '/admin/reservas';
  static const String adminInventory = '/admin/inventario';
  static const String adminProducts = '/admin/productos';
  static const String adminPayments = '/admin/pagos';
  static const String adminCustomers = '/admin/clientes';
  static const String adminReports = '/admin/reportes';
  static const String adminDiscounts = '/admin/descuentos';
  static const String adminUsers = '/admin/usuarios';
  static const String adminSettings = '/admin/configuracion';

  /// Detalles de segundo nivel del panel. Fuera del shell de tabla: se abren con
  /// `push` para que «atrás» devuelva la lista con su scroll y su filtro.
  static const String adminOrderDetail = '/admin/ordenes/:orderId';
  static const String adminCustomerDetail = '/admin/clientes/:customerId';

  /// Prefijos de las fichas de segundo nivel, sin el segmento `:id`.
  static const String _adminOrders = '/admin/ordenes';
  static const String _adminCustomers = '/admin/clientes';

  /// Las doce rutas del panel, en el orden de la navegación.
  ///
  /// `adminDashboard` es `/admin` y va la primera a propósito: el shell indexado
  /// usa la primera rama como destino inicial, y entrar al panel tiene que llevar
  /// al resumen, no a una lista de pedidos.
  static const List<String> adminOrder = <String>[
    adminDashboard,
    adminOrders,
    adminChairs,
    adminReservations,
    adminInventory,
    adminProducts,
    adminPayments,
    adminCustomers,
    adminReports,
    adminDiscounts,
    adminUsers,
    adminSettings,
  ];

  /// `true` si [location] es una ruta del panel (o una subruta de ella).
  ///
  /// Se comparan PREFIJOS con barra, no con `startsWith` a secas: `/admin`
  /// capturaría `/administrador` sin el corte, y esa ruta no existe pero aparecería
  /// como "dentro del panel" en el guard.
  ///
  /// El corte por barra es lo que hace que `/admin` cubra también las fichas de
  /// segundo nivel (`/admin/ordenes/42`, `/admin/clientes/7`). Con comparación
  /// exacta, un cajero que tecleara la URL de un detalle se saltaría el guard:
  /// por eso se prueba también el prefijo, y no solo la lista de doce ramas.
  static bool isAdminLocation(String location) {
    for (final String path in adminOrder) {
      if (location == path) return true;
      if (path != adminDashboard && location.startsWith('$path/')) return true;
    }
    // Las fichas son de segundo nivel: viven fuera del shell de tabla, así que
    // no están en `adminOrder`. Se reconocen por su prefijo constante.
    return location.startsWith('$_adminOrders/') ||
        location.startsWith('$_adminCustomers/');
  }

  /// `true` si [location] es del mostrador.
  static bool isPosLocation(String location) =>
      location == pos || location.startsWith('$pos/');

  /// Ruta de la ficha de producto para un id concreto.
  ///
  /// Se construye aquí y no se escribe `'$product/$id'` en las pantallas: los
  /// segmentos con `:` son un contrato entre la ruta y quien la construye, y
  /// duplicarlos en tres sitios es la forma segura de romperlos.
  static String productFor(int productId) => '/producto/$productId';

  /// Ruta del detalle de un pedido.
  static String orderDetailFor(int orderId) => '/pedido/$orderId';

  /// Ruta del detalle de una silla.
  static String chairDetailFor(int chairId) => '/silla/$chairId';

  /// Ruta del detalle de un pedido en el panel (`/admin/ordenes/:id`).
  static String adminOrderDetailFor(int orderId) => '/admin/ordenes/$orderId';

  /// Ruta de la ficha de un cliente en el panel (`/admin/clientes/:id`).
  static String adminCustomerDetailFor(int customerId) => '/admin/clientes/$customerId';

  /// Rutas accesibles sin sesión. Todo lo demás exige autenticación.
  static const Set<String> publicPaths = <String>{
    login,
    register,
    forgotPassword,
    resetPassword,
  };

  /// Query param que guarda a dónde quería ir el usuario antes del login, para
  /// devolverlo allí al terminar (`?redirect=/menu`).
  static const String redirectParam = 'redirect';
}

/// Nombres de ruta para `context.goNamed` / `context.pushNamed`.
abstract final class RouteNames {
  const RouteNames._();

  static const String home = 'home';
  static const String login = 'login';
  static const String register = 'register';
  static const String forgotPassword = 'forgotPassword';
  static const String resetPassword = 'resetPassword';
  static const String menu = 'menu';
  static const String product = 'product';
  static const String cart = 'cart';
  static const String checkout = 'checkout';
  static const String checkoutDone = 'checkoutDone';
  static const String orders = 'orders';
  static const String orderDetail = 'orderDetail';
  static const String chairs = 'chairs';
  static const String chairDetail = 'chairDetail';
  static const String reservations = 'reservations';
  static const String profile = 'profile';
  static const String profileEdit = 'profileEdit';
  static const String profilePassword = 'profilePassword';
  static const String profileSessions = 'profileSessions';
  static const String profileNotifications = 'profileNotifications';
  static const String profilePayments = 'profilePayments';
  static const String pos = 'pos';
  static const String posOrdersBoard = 'posOrdersBoard';
  static const String admin = 'admin';
  static const String adminDashboard = 'adminDashboard';
  static const String adminOrders = 'adminOrders';
  static const String adminChairs = 'adminChairs';
  static const String adminReservations = 'adminReservations';
  static const String adminInventory = 'adminInventory';
  static const String adminProducts = 'adminProducts';
  static const String adminPayments = 'adminPayments';
  static const String adminCustomers = 'adminCustomers';
  static const String adminReports = 'adminReports';
  static const String adminDiscounts = 'adminDiscounts';
  static const String adminUsers = 'adminUsers';
  static const String adminSettings = 'adminSettings';
  static const String adminOrderDetail = 'adminOrderDetail';
  static const String adminCustomerDetail = 'adminCustomerDetail';
}
