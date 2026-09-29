// Grafo de datos del panel de administración. MÓDULO `features/admin/presentation`.
//
// Los datasources y repositorios viven aquí (y no en un `data/providers.dart`) por
// la misma razón que en `features/orders`: `presentation/` habla con providers y
// son ellos los que llaman al repositorio. Ninguna pantalla importa `data/`.
//
// SEIS REPOSITORIOS, UNO POR DOMINIO
// No uno gigante. Un repositorio con 90 métodos sería un `switch` de 90 ramas y
// cualquier cambio tocaría un archivo que todas las pantallas importan. Con seis,
// la pantalla de Sillas no recompila porque cambiaron los descuentos.
//
// TODAS LAS PANTALLAS DEL PANEL SON `ConsumerWidget`
// Y todas leen el estado por provider. Ninguna tiene `setState` para datos de
// negocio: el único `setState` del panel es el de los formularios (texto que el
// usuario está escribiendo), que es estado de pantalla y no de servidor.

import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/di/providers.dart';
import '../data/datasources/remote/admin_business_datasource.dart';
import '../data/datasources/remote/admin_catalog_datasource.dart';
import '../data/datasources/remote/admin_chairs_datasource.dart';
import '../data/datasources/remote/admin_directory_datasource.dart';
import '../data/datasources/remote/admin_inventory_datasource.dart';
import '../data/datasources/remote/admin_ops_datasource.dart';
import '../data/datasources/remote/admin_payments_datasource.dart';
import '../data/datasources/remote/admin_rentals_datasource.dart';
import '../data/datasources/remote/admin_reports_datasource.dart';
import '../data/datasources/remote/admin_users_datasource.dart';
import '../data/datasources/remote/admin_variants_datasource.dart';
import '../data/datasources/remote/admin_zones_datasource.dart';
import '../data/repositories/admin_catalog_repository_impl.dart';
import '../data/repositories/admin_directory_repository_impl.dart';
import '../data/repositories/admin_repository_impl.dart';
import '../data/repositories/admin_spaces_repository_impl.dart';
import '../domain/repositories/admin_directory_repository.dart';
import '../domain/repositories/admin_inventory_repository.dart';
import '../domain/repositories/admin_repository.dart';
import '../domain/repositories/admin_spaces_repository.dart';

/// Pedidos, pagos y reportes.
final Provider<AdminOpsRepository> adminOpsRepositoryProvider =
    Provider<AdminOpsRepository>(
  (Ref ref) => AdminOpsRepositoryImpl(
    AdminOpsDataSource(ref.watch(apiClientProvider)),
    AdminPaymentsDataSource(ref.watch(apiClientProvider)),
    AdminReportsDataSource(ref.watch(apiClientProvider)),
  ),
  name: 'adminOpsRepository',
);

/// Catálogo: productos, categorías, variantes, complementos y receta.
final Provider<AdminCatalogRepository> adminCatalogRepositoryProvider =
    Provider<AdminCatalogRepository>(
  (Ref ref) => AdminCatalogRepositoryImpl(
    AdminCatalogDataSource(ref.watch(apiClientProvider)),
    AdminCatalogVariantsDataSource(ref.watch(apiClientProvider)),
  ),
  name: 'adminCatalogRepository',
);

/// Sillas, zonas, reservas y alquileres.
final Provider<AdminSpacesRepository> adminSpacesRepositoryProvider =
    Provider<AdminSpacesRepository>(
  (Ref ref) => AdminSpacesRepositoryImpl(
    AdminChairsDataSource(ref.watch(apiClientProvider)),
    AdminZonesDataSource(ref.watch(apiClientProvider)),
    AdminRentalsDataSource(ref.watch(apiClientProvider)),
  ),
  name: 'adminSpacesRepository',
);

/// Inventario: ítems, movimientos, ajustes y proveedores.
final Provider<AdminInventoryRepository> adminInventoryRepositoryProvider =
    Provider<AdminInventoryRepository>(
  (Ref ref) => AdminInventoryRepositoryImpl(
    AdminInventoryDataSource(ref.watch(apiClientProvider)),
  ),
  name: 'adminInventoryRepository',
);

/// Clientes, descuentos, usuarios y configuración del negocio.
final Provider<AdminDirectoryRepository> adminDirectoryRepositoryProvider =
    Provider<AdminDirectoryRepository>(
  (Ref ref) => AdminDirectoryRepositoryImpl(
    AdminDirectoryDataSource(ref.watch(apiClientProvider)),
    AdminUsersDataSource(ref.watch(apiClientProvider)),
    AdminBusinessDataSource(ref.watch(apiClientProvider)),
  ),
  name: 'adminDirectoryRepository',
);
