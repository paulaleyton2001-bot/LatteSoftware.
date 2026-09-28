// Rutas de features pendientes, con la feature y los roles documentados.
//
// Este archivo es el "mapa de trabajo" de la app: cada ruta dice a qué feature
// pertenece, quién puede entrar y qué permisos exigirá. La feature llega
// cambiando solo el `builder` por la pantalla real; ni el `redirect` de sesión
// ni las rutas se tocan.
//
// Los roles NO se aplican todavía: el guard por permiso (BR-RBAC-005, sobre
// `GET /auth/me.permissions`) llega con cada feature, y hacerlo aquí duplicaría
// la matriz de permisos en el cliente, que es exactamente lo que la norma
// prohíbe.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'placeholder_screen.dart';
import 'routes.dart';

/// Rutas de la app que aún no tienen pantalla.
List<RouteBase> placeholderRoutes() => <RouteBase>[
      // ------------------------------------------------------------ Catálogo
      // Feature: features/menu. Grilla de productos con filtros por categoría.
      _placeholder(
        path: AppRoutes.menu,
        name: RouteNames.menu,
        title: 'Menú',
        feature: 'features/menu',
        allowedRoles: 'Público y autenticados',
      ),

      // Feature: features/product_detail. `:slug` es la URL de cliente; la API
      // resuelve por `id` (`GET /products/:id`), así que la feature decidirá
      // cómo pasar de slug a id (búsqueda por `q` o lookup dedicado).
      _placeholder(
        path: AppRoutes.product,
        name: RouteNames.product,
        title: 'Detalle de producto',
        feature: 'features/product_detail',
        allowedRoles: 'Público y autenticados',
      ),

      // Feature: features/cart. El carrito vive en el dispositivo, no en el
      // servidor: no exige red para abrirse.
      _placeholder(
        path: AppRoutes.cart,
        name: RouteNames.cart,
        title: 'Carrito',
        feature: 'features/cart',
        allowedRoles: 'Autenticados',
      ),

      // Feature: features/checkout. Dos columnas (carrito | resumen) en
      // desktop. `POST /payments` exige cabecera `Idempotency-Key`.
      _placeholder(
        path: AppRoutes.checkout,
        name: RouteNames.checkout,
        title: 'Checkout',
        feature: 'features/checkout',
        allowedRoles: 'Autenticados',
        requiredPermissions: <String>['orders:create', 'payments:create'],
      ),

      // Feature: features/orders. Cliente: sus pedidos. Staff: los del día.
      _placeholder(
        path: AppRoutes.orders,
        name: RouteNames.orders,
        title: 'Pedidos',
        feature: 'features/orders',
        allowedRoles: 'Autenticados',
      ),
      _placeholder(
        path: AppRoutes.orderDetail,
        name: RouteNames.orderDetail,
        title: 'Detalle del pedido',
        feature: 'features/orders',
        allowedRoles: 'Autenticados',
      ),

      // -------------------------------------------------------------- Sillas
      // Feature: features/chair. Mapa con retícula por estado y panel de
      // detalle. Estados por `StatusBadge`, nunca solo por color (§6.1).
      _placeholder(
        path: AppRoutes.chairs,
        name: RouteNames.chairs,
        title: 'Mapa de sillas',
        feature: 'features/chair',
        allowedRoles: 'STAFF, CASHIER, MANAGER, ADMIN, OWNER',
        requiredPermissions: <String>['chairs:read'],
      ),
      _placeholder(
        path: AppRoutes.chairDetail,
        name: RouteNames.chairDetail,
        title: 'Detalle de silla',
        feature: 'features/chair',
        allowedRoles: 'STAFF, CASHIER, MANAGER, ADMIN, OWNER',
        requiredPermissions: <String>['chairs:read', 'rentals:create'],
      ),

      // Feature: features/reservation. Reservas del cliente y agenda del día.
      _placeholder(
        path: AppRoutes.reservations,
        name: RouteNames.reservations,
        title: 'Reservas',
        feature: 'features/reservation',
        allowedRoles: 'Autenticados',
        requiredPermissions: <String>['reservations:read'],
      ),

      // ------------------------------------------------------------- Cuenta
      // Feature: features/profile. Datos, tema, sesiones activas y logout.
      _placeholder(
        path: AppRoutes.profile,
        name: RouteNames.profile,
        title: 'Perfil',
        feature: 'features/profile',
        allowedRoles: 'Autenticados',
        requiredPermissions: <String>['auth:profile:read'],
      ),

      // ---------------------------------------------------------------- POS
      // Feature: features/pos. Grid táctil, cobro en dos columnas y cola
      // offline (`core/storage/offline_queue.dart`).
      _placeholder(
        path: AppRoutes.pos,
        name: RouteNames.pos,
        title: 'Punto de venta',
        feature: 'features/pos',
        allowedRoles: 'CASHIER, MANAGER, ADMIN, OWNER',
        requiredPermissions: <String>['orders:create', 'payments:create'],
      ),

      // -------------------------------------------------------------- Admin
      // Feature: features/admin (shell con sidebar) más las subpantallas de
      // catálogo, inventario, reportes, usuarios y configuración.
      _placeholder(
        path: AppRoutes.admin,
        name: RouteNames.admin,
        title: 'Panel de administración',
        feature: 'features/admin',
        allowedRoles: 'ADMIN, OWNER',
        requiredPermissions: <String>['users:read'],
      ),
    ];

/// Atajo para declarar un placeholder con su documentación.
GoRoute _placeholder({
  required String path,
  required String name,
  required String title,
  required String feature,
  required String allowedRoles,
  List<String> requiredPermissions = const <String>[],
}) {
  return GoRoute(
    path: path,
    name: name,
    builder: (BuildContext context, GoRouterState state) => PlaceholderScreen(
      title: title,
      feature: feature,
      allowedRoles: allowedRoles,
      requiredPermissions: requiredPermissions,
    ),
  );
}
