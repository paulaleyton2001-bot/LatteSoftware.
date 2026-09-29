// Destinos del panel de administración. MÓDULO `app/admin`.
//
// QUIÉN VE QUÉ
// Cada destino declara el PERMISO que necesita, y la lista se filtra contra
// `user.permissions` — que es la unión COMPLETA de permisos que devuelve
// `GET /auth/me` (BR-RBAC-005). La app NO mantiene una matriz rol × permiso:
// duplicarla es justo lo que la norma prohíbe, y se quedaría vieja en cuanto el
// backend añadiera un rol.
//
// PERMISOS REALES, NO INVENTADOS
//   `/meta/roles` y `shared/domain/permissions.ts` del backend son la verdad.
//   `business:manage` NO existe: el catálogo real es una clave por acción
//   (`business:update`, `business:hours:update`, `business:holidays:manage`).
//   `orders:manage` NO existe: es `orders:create`, `orders:status:update`,
//   `orders:cancel` y `orders:receipt:read`.
//
// PARA EL POS SOLO HAY UN PERMISO NECESARIO
// `orders:create`. Lo demás (avanzar estados, cobrar, imprimir) viene con él en los
// roles de caja, y el backend responde `403` si falta alguno.

import 'package:flutter/material.dart';

import '../../domain/entities/user.dart';
import '../../shared/constants/app_destination.dart';
import '../../shared/constants/app_strings.dart';
import '../routes.dart';

/// Permiso que habilita el acceso al POS. `STAFF` y superiores lo tienen; un
/// `CUSTOMER` no, y con él el guard lo manda a `/home` con un aviso.
const String kPosPermission = 'orders:create';

/// Permiso mínimo para ver el panel de administración.
///
/// No es un permiso único: la navegación completa la pantalla. Lo que este
/// predicado decide es si un usuario puede ENTRAR o no, y con qué mensaje.
const String kAdminEntryPermission = 'users:read';

/// `true` si el usuario puede operar el mostrador.
///
/// Se combinan DOS señales del backend y ninguna más:
///   - `isStaff`: marca explícita de empleado del negocio.
///   - `orders:create`: el permiso que de verdad necesita el POS para crear un
///     pedido.
///
/// Con las dos, un `CUSTOMER` con un permiso suelto no entra, y un empleado sin el
/// permiso tampoco: en los dos casos el backend lo rechazaría.
bool canUsePos(User? user) {
  if (user == null) return false;
  return user.isStaff || user.hasPermission(kPosPermission);
}

/// `true` si el usuario puede entrar al panel.
///
/// `users:read` es el permiso de gestión de personas: es el que distingue a un
/// cajero de un encargado. Un `MANAGER` lo tiene; un `CASHIER`, no.
bool canUseAdmin(User? user) {
  if (user == null) return false;
  return user.isStaff && user.hasPermission(kAdminEntryPermission);
}

/// Permiso que cada subpantalla del panel necesita para MOSTRARSE.
///
/// `null` = visible para cualquiera que haya entrado al panel.
const Map<String, String?> kAdminDestinationPermissions = <String, String?>{
  AppRoutes.adminDashboard: null,
  AppRoutes.adminOrders: 'orders:read',
  AppRoutes.adminChairs: 'chairs:read',
  AppRoutes.adminReservations: 'reservations:read',
  AppRoutes.adminInventory: 'inventory:read',
  AppRoutes.adminProducts: 'products:read',
  AppRoutes.adminPayments: 'payments:read',
  AppRoutes.adminCustomers: 'customers:read',
  AppRoutes.adminReports: 'reports:read',
  AppRoutes.adminDiscounts: 'discounts:read',
  AppRoutes.adminUsers: 'users:read',
  AppRoutes.adminSettings: 'business:read',
};

/// Destinos visibles para [user], con los permisos ya aplicados.
///
/// Se calcula en cada construcción (es una lista de doce elementos y un `any`) en
/// vez de cachearse: cachear un resultado que depende de `user.permissions`
/// obligaría a invalidarlo a mano en cada cambio de sesión, y el error de
/// olvidar un `invalidate` es una navegación que muestra una pantalla prohibida.
List<AppDestination> adminDestinations(User? user) {
  final List<AppDestination> all = <AppDestination>[
    const AppDestination(
      label: AppStrings.navDashboard,
      icon: Icons.dashboard_outlined,
      selectedIcon: Icons.dashboard_rounded,
      location: AppRoutes.adminDashboard,
    ),
    const AppDestination(
      label: AppStrings.navOrders,
      icon: Icons.receipt_long_outlined,
      selectedIcon: Icons.receipt_long_rounded,
      location: AppRoutes.adminOrders,
    ),
    const AppDestination(
      label: AppStrings.navChairs,
      icon: Icons.event_seat_outlined,
      selectedIcon: Icons.event_seat_rounded,
      location: AppRoutes.adminChairs,
    ),
    const AppDestination(
      label: AppStrings.navReservations,
      icon: Icons.event_note_outlined,
      selectedIcon: Icons.event_note_rounded,
      location: AppRoutes.adminReservations,
    ),
    const AppDestination(
      label: AppStrings.navInventory,
      icon: Icons.inventory_2_outlined,
      selectedIcon: Icons.inventory_2_rounded,
      location: AppRoutes.adminInventory,
    ),
    const AppDestination(
      label: AppStrings.navProducts,
      icon: Icons.local_cafe_outlined,
      selectedIcon: Icons.local_cafe_rounded,
      location: AppRoutes.adminProducts,
    ),
    const AppDestination(
      label: AppStrings.navPayments,
      icon: Icons.payments_outlined,
      selectedIcon: Icons.payments_rounded,
      location: AppRoutes.adminPayments,
    ),
    const AppDestination(
      label: AppStrings.navCustomers,
      icon: Icons.people_outline_rounded,
      selectedIcon: Icons.people_rounded,
      location: AppRoutes.adminCustomers,
    ),
    const AppDestination(
      label: AppStrings.navReports,
      icon: Icons.bar_chart_outlined,
      selectedIcon: Icons.bar_chart_rounded,
      location: AppRoutes.adminReports,
    ),
    const AppDestination(
      label: AppStrings.navDiscounts,
      icon: Icons.sell_outlined,
      selectedIcon: Icons.sell_rounded,
      location: AppRoutes.adminDiscounts,
    ),
    const AppDestination(
      label: AppStrings.navUsers,
      icon: Icons.badge_outlined,
      selectedIcon: Icons.badge_rounded,
      location: AppRoutes.adminUsers,
    ),
    const AppDestination(
      label: AppStrings.navSettings,
      icon: Icons.settings_outlined,
      selectedIcon: Icons.settings_rounded,
      location: AppRoutes.adminSettings,
    ),
  ];

  if (user == null) return const <AppDestination>[];
  return <AppDestination>[
    for (final AppDestination destination in all)
      if (_isVisible(destination, user)) destination,
  ];
}

/// `true` si el usuario tiene el permiso que la subpantalla declara.
bool _isVisible(AppDestination destination, User user) {
  final String? permission = kAdminDestinationPermissions[destination.location];
  // Sin permiso declarado: la subpantalla es de lectura general del panel.
  if (permission == null) return true;
  return user.hasPermission(permission);
}
