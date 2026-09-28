// Re-export del módulo de breakpoints.
//
// Existe para que el resto de la app importe `app/breakpoints.dart` (una sola
// ruta estable) sin saber que la implementación vive en el tema. Si en el
// futuro hay un segundo origen de verdad para el layout, se cambia aquí.
//
// Uso: `context.breakpoint.isMobile`, `Breakpoint.desktop.minWidthDp`.

export 'theme/responsive/breakpoints.dart';
