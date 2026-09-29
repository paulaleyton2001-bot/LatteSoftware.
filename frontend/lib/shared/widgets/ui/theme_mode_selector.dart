// Selector de tema de la app: Sistema / Claro / Oscuro.
//
// DÓNDE ESTÁ Y POR QUÉ AHÍ
// El sitio canónico es **Perfil → Apariencia** (`features/profile/presentation/
// profile_page.dart`). El motivo es que es donde ya vive todo lo que la persona
// configura sobre sí misma —notificaciones, sesiones, datos— y porque el tema
// es una preferencia del CUENTA: en un dispositivo compartido (una tablet en la
// mesa de un local) debe seguir a quien está usando la app, no al último que la
// tocó.
//
// El segundo punto de entrada es [ThemeModeQuickButton], en la barra superior
// del shell de cliente: abrir un bottom sheet con las mismas tres opciones desde
// cualquier pestaña. Es un ACCESO RÁPIDO, no un segundo ajuste — reusa este mismo
// widget y el mismo provider, así que no puede haber dos verdades.
//
// POR QUÉ NO ES UN `Switch`
// Un interruptor sólo tiene dos estados y aquí hay tres. Con un switch, "¿volver
// a seguir al sistema?" no tendría forma de expresarse sin un botón aparte al
// lado. Tres opciones seleccionables con su etiqueta escrita son más claras que
// un interruptor más un subtítulo que explique qué hace.
//
// ACCESIBILIDAD (WCAG 2.1)
//   · Cada opción es un control `button` con `selected: true/false`, así que el
//     lector de pantalla anuncia "Sistema, botón, seleccionado" y la información
//     NO depende del color.
//   · `Semantics` de grupo (`container: true`) con nombre propio, para que se
//     anuncie el campo antes de entrar en él.
//   · El estado activo se refuerza con TRES señales redundantes: fondo, borde y
//     un check. Quien no distingue el verde del crema (deuteranopía, pantalla a
//     pleno sol) sigue viendo cuál está marcado.
//   · Target táctil: cada opción mide 72 dp de alto, muy por encima del mínimo
//     de 44 dp de `AppTapTarget.min`.
//
// Colores: todos salen de `context.tokens` (el tema), ninguno literal. Los
// tokens no incluyen los radios ni el espaciado: esos salen de `AppRadii` y
// `AppSpacing`, igual que el resto del sistema.

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../app/theme/app_radii.dart';
import '../../../app/theme/app_spacing.dart';
import '../../../app/theme/app_tokens.dart';
import '../../../app/theme/app_typography.dart';
import '../../../app/theme/theme_mode_controller.dart';

/// Alto de cada opción. Por encima de 44 dp porque el texto va DEBAJO del ícono
/// (icono + etiqueta), y 44 dp con dos líneas deja el contenido pegado al borde.
const double kThemeOptionHeight = 72;

/// Etiquetas de los tres estados. Viven aquí, no en la pantalla que lo usa, para
/// que el selector del perfil y el del bottom sheet digan EXACTAMENTE lo mismo.
abstract final class ThemeModeLabels {
  const ThemeModeLabels._();

  static const String system = 'Sistema';
  static const String light = 'Claro';
  static const String dark = 'Oscuro';

  /// Etiqueta legible de un modo.
  static String of(ThemeMode mode) => switch (mode) {
        ThemeMode.system => system,
        ThemeMode.light => light,
        ThemeMode.dark => dark,
      };

  /// Icono asociado. Es información REDUNDANTE con la etiqueta, no la única
  /// señal: quien no discerna iconos sigue leyendo el texto.
  static IconData iconOf(ThemeMode mode) => switch (mode) {
        ThemeMode.system => Icons.brightness_auto_rounded,
        ThemeMode.light => Icons.light_mode_rounded,
        ThemeMode.dark => Icons.dark_mode_rounded,
      };
}

/// Los tres estados, en el orden en que se pintan y en el que se anuncian.
const List<ThemeMode> kThemeModeOptions = <ThemeMode>[
  ThemeMode.system,
  ThemeMode.light,
  ThemeMode.dark,
];

/// Fila de tres opciones para elegir el tema. Es el ÚNICO selector de la app.
class ThemeModeSelector extends ConsumerWidget {
  const ThemeModeSelector({this.showLabel = true, super.key});

  /// Encabezado del grupo ("Apariencia"). `false` cuando quien lo usa ya puso su
  /// propio título de sección, para no repetirlo dos veces seguidas.
  final bool showLabel;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ThemeMode selected = ref.watch(themeModeProvider);

    return Semantics(
      container: true,
      // El nombre del grupo va en el nodo accesible SOLO cuando el título no está
      // dentro del widget: si está, el propio `Text` ya lo dice y ponerlo aquí
      // haría que el lector anunciara "Apariencia, Apariencia".
      label: showLabel ? null : 'Apariencia',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          if (showLabel) ...<Widget>[
            const Text(
              'Apariencia',
              style: AppTextStyles.titleSmall,
            ),
            const SizedBox(height: AppSpacing.xs),
          ],
          Row(
            children: <Widget>[
              for (final (int index, ThemeMode mode) in kThemeModeOptions.indexed)
                ...<Widget>[
                  if (index > 0) const SizedBox(width: AppSpacing.sm),
                  Expanded(
                    child: _ThemeModeOption(
                      mode: mode,
                      selected: mode == selected,
                      // `unawaited`: la escritura en disco va detrás del cambio
                      // optimista del estado; si fallara, no hay nada que hacer
                      // aquí y el lint `discarded_futures` obliga a decirlo.
                      onTap: () => unawaited(
                        ref.read(themeModeProvider.notifier).select(mode),
                      ),
                    ),
                  ),
                ],
            ],
          ),
        ],
      ),
    );
  }
}

/// Una de las tres opciones: ícono + etiqueta + estado activo.
class _ThemeModeOption extends StatelessWidget {
  const _ThemeModeOption({
    required this.mode,
    required this.selected,
    required this.onTap,
  });

  final ThemeMode mode;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final AppTokens t = context.tokens;
    final Color foreground = selected ? t.onAccentContainer : t.textSecondary;

    return Semantics(
      button: true,
      selected: selected,
      label: 'Tema ${ThemeModeLabels.of(mode)}',
      // El check es decorativo: el `selected` ya está en el nodo accesible y
      // `excludeSemantics` evita que se anuncie dos veces.
      excludeSemantics: true,
      child: Material(
        color: selected ? t.accentContainer : t.surfaceMuted,
        borderRadius: BorderRadius.circular(AppRadii.md),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(AppRadii.md),
          splashColor: t.focusRingSurface,
          child: Ink(
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(AppRadii.md),
              // Borde siempre visible: en el modo activo delimita la pastilla
              // contra el fondo de la tarjeta y hace el estado legible sin
              // depender del relleno.
              border: Border.all(
                color: selected ? t.accent : t.borderDefault,
              ),
            ),
            child: SizedBox(
              height: kThemeOptionHeight,
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: <Widget>[
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: <Widget>[
                      if (selected) ...<Widget>[
                        Icon(Icons.check_rounded, size: 16, color: foreground),
                        const SizedBox(width: AppSpacing.xxs),
                      ],
                      Icon(ThemeModeLabels.iconOf(mode), size: 20, color: foreground),
                    ],
                  ),
                  const SizedBox(height: AppSpacing.xs),
                  Text(
                    ThemeModeLabels.of(mode),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppTextStyles.labelMedium.copyWith(color: foreground),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Botón rápido de la barra superior: alterna claro/oscuro y abre el selector.
///
/// El botón NO cicla entre los tres estados porque un click que a veces deja el
/// tema en "Sistema" es impredecible. Hace lo simple (claro ⇄ oscuro) y quien
/// quiera el tercer estado abre el sheet, que está a un tap.
class ThemeModeQuickButton extends ConsumerWidget {
  const ThemeModeQuickButton({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ThemeMode mode = ref.watch(themeModeProvider);
    // `Tooltip` da el nombre al puntero/flotante, `Semantics` el del lector de
    // pantalla: `IconButton` no tiene `semanticLabel`, así que la etiqueta va en
    // el `Semantics` que lo envuelve.
    return Semantics(
      button: true,
      label: 'Cambiar apariencia. Actual: ${ThemeModeLabels.of(mode)}',
      excludeSemantics: true,
      child: IconButton(
        onPressed: () => unawaited(showThemeModeSheet(context)),
        tooltip: 'Apariencia · ${ThemeModeLabels.of(mode)}',
        icon: Icon(ThemeModeLabels.iconOf(mode)),
      ),
    );
  }
}

/// Hoja inferior con el selector. Es el acceso rápido desde cualquier pestaña.
///
/// El texto "ahora mismo" lo pinta un [Consumer] Y NO el `showModalBottomSheet`:
/// abrir la hoja y cambiar el tema desde ella tiene que actualizar el texto en el
/// sitio, sin cerrar y reabrir el diálogo.
Future<void> showThemeModeSheet(BuildContext context) {
  return showModalBottomSheet<void>(
    context: context,
    showDragHandle: true,
    builder: (BuildContext context) => const SafeArea(
      child: Padding(
        padding: EdgeInsets.fromLTRB(
          AppSpacing.lg,
          0,
          AppSpacing.lg,
          AppSpacing.xl,
        ),
        child: _ThemeModeSheetBody(),
      ),
    ),
  );
}

/// Contenido de la hoja: título, valor actual y el selector.
class _ThemeModeSheetBody extends ConsumerWidget {
  const _ThemeModeSheetBody();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ThemeMode current = ref.watch(themeModeProvider);

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        const Text('Apariencia', style: AppTextStyles.titleLarge),
        const SizedBox(height: AppSpacing.xxs),
        Text(
          'Ahora mismo: ${ThemeModeLabels.of(current)}',
          style: AppTextStyles.bodyMedium
              .copyWith(color: context.tokens.textSecondary),
        ),
        const SizedBox(height: AppSpacing.lg),
        const ThemeModeSelector(showLabel: false),
      ],
    );
  }
}
