# features/pos

Punto de venta del cajero. Optimizado para **velocidad real**: pocos clics por
venta, atajos de teclado visibles y cobro sin pasarela.

## Layout por ancho

Definido en `lib/app/responsive/pos_breakpoints.dart` (`PosLayout`). El POS **gana
columnas** con el ancho, no se estira:

| Layout | Ancho | Columnas | Navegación |
|---|---|---|---|
| `compact` | 0–767 | 1 | pestañas (Catálogo / Pedido / Cobro) |
| `medium` | 768–1183 | 2 (catálogo \| pedido) | rail + 2 columnas |
| `expanded` | 1184–1679 | 3 (+ columna de cobro) | rail + 3 columnas |
| `ultraExpanded` | ≥ 1680 | 3 + panel lateral | rail + 3 + lateral |

El ancho se resuelve con `LayoutBuilder` sobre la columna REAL, no con
`MediaQuery`: dentro del shell de escritorio la sidebar roba 240–264 dp y un
portátil de 1440 dp da 1176 dp útiles (que es `medium`, no `expanded`).

## Estructura

```
lib/features/pos/
├── domain/
│   ├── entities/      pos_catalog_item, pos_draft, pos_order_type,
│   │                  pos_charge, pos_order_card
│   └── repositories/  pos_repository (+ _models)
├── data/
│   ├── datasources/remote/  pos_remote_datasource
│   └── repositories/        pos_repository_impl
└── presentation/
    ├── pos_controller.dart          catálogo, búsqueda, borrador
    ├── pos_cart_controller.dart     mutaciones del carrito
    ├── pos_charge_controller.dart   cobro + idempotencia
    ├── pos_orders_controller.dart   listado, tablero, comprobante
    ├── pos_shortcuts.dart           F1 / Enter / F2 / Esc
    ├── pos_mobile_tab.dart, pos_workspace.dart, pos_page.dart
    └── widgets/                     catálogo, pedido, cobro, pago, tablero
```

## Reglas de negocio que este módulo respeta

- **Sin pasarela.** El cobro es manual: efectivo (el backend calcula el cambio) o
  tarjeta con la referencia de aprobación que anota el cajero. Nunca se pide el
  número de tarjeta.
- **`POST /payments` es idempotente** y exige la cabecera `Idempotency-Key`. La
  clave se genera al abrir el diálogo de cobro y sobrevive a los reintentos del
  mismo cobro.
- **El total es del servidor** (BR-PRICE-008): lo que se ve mientras se arma el
  pedido es una previsualización y así se rotula.
- **El carrito es el del cliente** (`core/customer/cart_store.dart`), no un
  segundo: dos carritos significarían que el cliente y el cajero ven pedidos
  distintos.
- **Sin conexión no se promete sincronización**: `core/storage` tiene la cola y
  `NoopSyncEngine` la declara inerte. El POS avisa y propone el cobro manual.
