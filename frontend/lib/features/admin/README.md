# features/admin

Panel de administración. Doce subpantallas, cada una con su controller y su
página, sobre un grafo de datos de seis repositorios (uno por dominio).

## Subpantallas

| Ruta | Pantalla | Controller | Permiso para MOSTRARSE |
|---|---|---|---|
| `/admin` | Resumen (KPIs + gráficos) | `admin_dashboard_page.dart` | — |
| `/admin/ordenes` | Listado de pedidos | `admin_orders_controller.dart` | `orders:read` |
| `/admin/sillas` | Sillas, zonas y plano | `admin_spaces_controller.dart` | `chairs:read` |
| `/admin/reservas` | Reservas y alquileres vivos | `admin_reservations_controller.dart`, `admin_rental_controller.dart` | `reservations:read` |
| `/admin/inventario` | Ítems, movimientos, proveedores | `admin_inventory_controller.dart` | `inventory:read` |
| `/admin/productos` | Catálogo | `admin_products_controller.dart` | `products:read` |
| `/admin/pagos` | Pagos y reembolsos | `admin_payments_controller.dart` | `payments:read` |
| `/admin/clientes` | Clientes e historial | `admin_customers_controller.dart` | `customers:read` |
| `/admin/reportes` | Informes y CSV | `admin_reports_controller.dart` | `reports:read` |
| `/admin/descuentos` | Cupones | `admin_discounts_controller.dart` | `discounts:read` |
| `/admin/usuarios` | Equipo y roles | `admin_users_controller.dart` | `users:read` |
| `/admin/configuracion` | Negocio, horarios, festivos | `admin_settings_controller.dart` | `business:read` |

## Estructura

```
lib/features/admin/
├── domain/
│   ├── entities/   admin_catalog, admin_products, admin_order_detail,
│   │               admin_spaces, admin_rentals, admin_inventory_item,
│   │               admin_inventory, admin_payments, admin_accounts,
│   │               admin_business, admin_history
│   └── repositories/  admin_repository (+ _spaces, _inventory, _directory)
├── data/
│   ├── datasources/remote/  8 datasources (uno por módulo del backend)
│   └── repositories/        4 implementaciones
└── presentation/
    ├── admin_providers.dart          grafo de datos
    ├── admin_*_controller.dart       estado de cada subpantalla
    ├── admin_*_page.dart             pantallas
    ├── charts/                       fl_chart con grilla común
    └── widgets/                      tabla, filtros, filas, diálogos
```

## Reglas del panel

- **Permisos, no matrices de roles.** Cada destino comprueba su clave contra
  `user.permissions` (la unión completa de `GET /auth/me`, BR-RBAC-005). La app
  no mantiene una tabla rol × permiso.
- **Los porcentajes en basis points se dividen en UN sitio.**
  `AdminDashboardKpis.chairOccupancyPercent` es el único lugar que convierte
  `chairOccupancyRate` (4567 = 45,67 %). `chair-occupancy` sí llega ya en 0-100.
- **El saldo solo cambia por ajuste.** `PATCH /inventory/items/:id` rechaza
  `currentStock` con `422 FIELD_NOT_EDITABLE` (BR-INV-005).
- **El estado de una silla no se edita.** Tiene cuatro rutas dedicadas; `OCCUPIED`
  y `RESERVED` los pone el flujo de alquileres y mandarlos da `422`.
- **`defaultTipsBp`, `taxRateBp` y `serviceFeeBp` son basis points.** El usuario
  escribe porcentajes; la conversión vive en `percentToBasisPoints`.
- **El historial de un cliente es una unión de listados**, porque
  `GET /customers/:id/orders|reservations|rentals|payments` está en `docs/API.md`
  pero NO en el backend real.
