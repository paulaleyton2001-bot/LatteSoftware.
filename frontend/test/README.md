# test

Suite de pruebas. En esta fase (fundaciones) hay tres que ya deberían existir
cuando se instale el SDK:

| Archivo | Qué cubre |
|---|---|
| `currency_formatter_test.dart` | `formatMinor(500000) == '$5.000'`, `parseMinor('$5.000') == 500000`, sin coma flotante en sumas. |
| `date_formatter_test.dart` | es-CO 24 h, countdown `02:24:41`, duraciones `1h 24m`. |
| `status_badge_test.dart` | los 6 `ChairStatus` y los 9 `OrderStatus` resuelven a un visual con texto no vacío (garantía anti-regresión de accesibilidad). |

Convenciones:
- Los nombres de los tests citan la regla o el token que verifican.
- Los golden del sistema de diseño (`test/goldens/`) se generan con
  `flutter test --update-goldens` y se commitean: un cambio de token debe
  cambiar el golden y eso se ve en el diff del code review.
