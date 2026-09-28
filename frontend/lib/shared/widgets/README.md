# shared/widgets

Sistema de diseño reutilizable. Cero lógica de negocio, cero textos de UI de
negocio, cero colores literales.

- `ui/`: componentes base (`AppButton`, `AppCard`, `AppTextField`,
  `StatusBadge`, `CategoryChip`, `PriceDisplay`, estados de UI, diálogos...).
- `adaptive_scaffold.dart` + `app_sidebar.dart` + `brand_mark.dart`: shell de
  navegación adaptativo (bottom bar / rail / sidebar según breakpoint).

Reglas:
1. Un archivo, una responsabilidad, máximo ~150 líneas.
2. Doc comment que dice CUÁNDO usarlo, no QUÉ hace.
3. Todo color sale de `app/theme/app_colors.dart`; todo texto de negocio entra
   por parámetro.
