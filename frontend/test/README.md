# test

Suite de pruebas. Cada archivo fija una regla que **ya se rompió una vez** en el
dispositivo: no hay tests "de cobertura", hay tests de regresión.

| Archivo | Qué cubre |
|---|---|
| `currency_formatter_test.dart` | Contrato exacto de dinero: `$5.500`, `$1.234.567`, `$0`, símbolo delante, punto de miles, símbolo del negocio (`businesses.currency_symbol`) y lectura de lo que se escribe a mano (`5.000` son cinco mil, no cinco). |
| `theme_mode_selector_test.dart` | Los tres estados (Sistema/Claro/Oscuro), que se persistan y **se apliquen** de verdad, la migración de la clave vieja y la semántica de cada opción. |
| `source_text_hygiene_test.dart` | Ningún `.dart` de `lib/` o `test/` contiene caracteres de U+0600–06FF, U+0750–077F, U+FB50–FDFF ni U+FE70–FEFF. Anti-regresión del texto en árabe del menú. |
| `greeting_test.dart` | Un solo saludo con el nombre, igual en Inicio y en Menú, y sin coma colgando cuando no hay nombre. |
| `menu_layout_test.dart` | Separación real entre pills de categoría y jerarquía título → subtítulo → contenido de `SectionHeader`. |
| `date_formatter_test.dart` | es-CO 24 h, countdown `02:24:41`, duraciones `1h 24m`. |
| `theme_contrast_test.dart` | Todos los pares texto/fondo de los DOS modos con la fórmula de WCAG 2.1 (garantía anti-regresión de accesibilidad). |
| `nav_bar_many_destinations_test.dart` | `NavigationBar` de Material con 5 destinos y carrusel con 12. |
| `checkout_placed_order_items_test.dart` | Regresión de "los productos no aparecen al hacer el pedido". |
| `checkout_layout_test.dart` | El checkout no queda vacío en pantalla estrecha. |
| `pos_cart_panel_test.dart` | Regresión de "el cajero no puede montar una venta": tocar un producto del catálogo tiene que pintar la línea en el panel «Pedido en curso» y mover el subtotal. Incluye la lectura con `ref.read`, que es la que usa el camino de cobro. |

Convenciones:
- Los nombres de los tests citan la regla o el token que verifican.
- Los golden del sistema de diseño (`test/goldens/`) se generan con
  `flutter test --update-goldens` y se commitean: un cambio de token debe
  cambiar el golden y eso se ve en el diff del code review.
- **Un test de regresión tiene que FALLAR si se reintroduce el bug.** Si no lo
  has visto fallar, no sabes si está comprobando nada.

Pendiente: `status_badge_test.dart` (los `ChairStatus` y `OrderStatus` resuelven
a un visual con texto no vacío).
