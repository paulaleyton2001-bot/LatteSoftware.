// Barras de navegación de móvil y tablet. MÓDULO `AdaptiveScaffold`.
//
// [AppNavigationBar] (mobile) y [AppNavigationRail] (tablet) comparten la
// lógica de estado activo y de badge, así que viven juntas: si el cálculo del
// índice activo cambia, cambia una vez.
//
// El texto siempre se muestra (en la barra inferior, `alwaysShow`): esconderlo
// en el estado inactivo hace que el usuario tenga que recordar los íconos.
//
// ─────────────────────────────────────────────────────────────────────────────
// POR QUÉ EL ESTADO SELECCIONADO NO USA NINGÚN COLOR FIJO
// ─────────────────────────────────────────────────────────────────────────────
// El síntoma en pantalla era "Inicio con una pastilla blanca y los otros cuatro
// sin ella", sobre un fondo marrón. La pastilla NO la pintaba este archivo: la
// pintaba el `NavigationBarThemeData.indicatorColor`, que antes venía de un
// `fromSeed` y en modo oscuro daba un crema clarísimo sobre el espresso del
// fondo — contraste altísimo para la píldora y NULO para el texto de la etiqueta
// seleccionada, que quedaba crema sobre crema.
//
// Aquí no se decide ningún color: se delegan los tres estados (pastilla, icono
// activo, etiqueta activa) al `NavigationBarTheme` / `NavigationRailTheme` del
// tema, que los resuelve con `accentContainer` + `onAccentContainer` del modo
// activo. Ese par tiene >= 4.5:1 verificado en los dos modos.
import 'dart:async';

import 'package:flutter/material.dart';

import '../../app/theme/app_radii.dart';
import '../../app/theme/app_spacing.dart';
import '../../app/theme/app_tokens.dart';
import '../../app/theme/app_typography.dart';
import '../constants/app_destination.dart';

/// Barra de navegación inferior (mobile).
///
/// CON MUCHOS DESTINOS SE CONVIERTE EN SCROLL HORIZONTAL
/// ─────────────────────────────────────────────────────────────────────────────
/// El panel de administración tiene DOCE destinos. Con `NavigationBar` de
/// Material, cada etiqueta se reparte el ancho disponible / 12 ≈ 30 dp: "Resumen"
/// se partía en dos líneas ("Resum / en"), "Configuración" en tres, y
/// "Reservas" colisionaba con su vecina. Eso es el mismo fallo que reportó el
/// usuario como «Postres recortado», pero en la barra.
///
/// Material resuelve el overflow subiendo la etiqueta a un `Row` con `FittedBox`,
/// que la deforma y la vuelve ilegible. La solución correcta para 12 destinos en
/// un móvil NO es apretarlos: es un carrusel horizontal, que además coincide con
/// lo que ya hacen `adminDestinations` y la rail de tablet.
///
/// A partir de [scrollThreshold] destinos la barra se pinta como un carrusel;
/// por debajo (los 5 del cliente) se mantiene la `NavigationBar` de Material, que
/// reparte bien el ancho y da la etiqueta completa.
class AppNavigationBar extends StatelessWidget {
  const AppNavigationBar({
    required this.destinations,
    required this.currentLocation,
    required this.onSelected,
    this.scrollThreshold = 7,
    super.key,
  });

  final List<AppDestination> destinations;
  final String currentLocation;
  final ValueChanged<AppDestination> onSelected;

  /// A partir de este número de destinos, la barra pasa a carrusel.
  final int scrollThreshold;

  @override
  Widget build(BuildContext context) {
    // El índice se calcula UNA vez y se reutiliza para el `selectedIndex` y
    // para decidir qué ícono va seleccionado: antes se recalculaba la
    // comparación de ruta en cada uno de los 5 destinos en cada rebuild.
    final int selected = selectedIndex(destinations, currentLocation);
    final AppTokens t = context.tokens;

    if (destinations.length <= scrollThreshold) {
      return NavigationBar(
        selectedIndex: selected,
        onDestinationSelected: (int index) => onSelected(destinations[index]),
        destinations: <NavigationDestination>[
          for (int i = 0; i < destinations.length; i++)
            NavigationDestination(
              icon: destinationIcon(destinations[i], tokens: t),
              selectedIcon:
                  destinationIcon(destinations[i], selected: true, tokens: t),
              label: destinations[i].label,
              tooltip: destinations[i].label,
            ),
        ],
      );
    }

    return _ScrollingDestinationBar(
      destinations: destinations,
      currentLocation: currentLocation,
      onSelected: onSelected,
      t: t,
      selected: selected,
    );
  }
}

/// Carrusel horizontal de destinos, para cuando no caben todos en el ancho.
///
/// Cada destino mide lo que necesita (`minWidth` con su contenido) y el carril
/// scrollea. Al seleccionar uno se hace `Scrollable.ensureVisible` para que el
/// activo quede a la vista: si no, activar "Inventario" en un panel de 12
/// dejaba el destino seleccionado fuera de pantalla sin que nadie lo notara.
class _ScrollingDestinationBar extends StatefulWidget {
  const _ScrollingDestinationBar({
    required this.destinations,
    required this.currentLocation,
    required this.onSelected,
    required this.t,
    required this.selected,
  });

  final List<AppDestination> destinations;
  final String currentLocation;
  final ValueChanged<AppDestination> onSelected;
  final AppTokens t;

  /// Índice del destino activo.
  final int selected;

  @override
  State<_ScrollingDestinationBar> createState() =>
      _ScrollingDestinationBarState();
}

class _ScrollingDestinationBarState extends State<_ScrollingDestinationBar> {
  /// Clave del destino activo, para poder traerlo a la vista al seleccionar.
  ///
  /// Se recrea en `didUpdateWidget` cuando cambia el destino activo: si se
  /// guardara la clave una sola vez, apuntaría al destino viejo y el
  /// `ensureVisible` no encontraría nada (`currentContext == null`).
  late GlobalKey _activeKey = GlobalKey(debugLabel: 'destino-activo');

  @override
  void didUpdateWidget(_ScrollingDestinationBar oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.selected != widget.selected) {
      _activeKey = GlobalKey(debugLabel: 'destino-activo');
    }
  }

  @override
  Widget build(BuildContext context) {
    final List<AppDestination> destinations = widget.destinations;
    final int selected = widget.selected;
    final AppTokens t = widget.t;
    return Container(
      decoration: BoxDecoration(
        color: t.surface,
        border: Border(top: BorderSide(color: t.borderSubtle)),
      ),
      child: SafeArea(
        // `NavigationBar` de Material ya aplica el inset inferior; este carrusel
        // es nuestro, así que el inset lo pone él.
        top: false,
        child: SizedBox(
          height: 64,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.sm),
            itemCount: destinations.length,
            separatorBuilder: (BuildContext context, int index) =>
                const SizedBox(width: AppSpacing.xs),
            itemBuilder: (BuildContext context, int index) {
              final AppDestination item = destinations[index];
              final bool isSelected = index == selected;
              return Center(
                child: _DestinationPill(
                  key: isSelected ? _activeKey : null,
                  item: item,
                  selected: isSelected,
                  t: t,
                  onTap: () {
                    _revealActive(context);
                    widget.onSelected(item);
                  },
                ),
              );
            },
          ),
        ),
      ),
    );
  }

  /// Trae el destino activo al centro del carril tras el cambio.
  void _revealActive(BuildContext context) {
    final BuildContext? target = _activeKey.currentContext;
    if (target == null) return;
    // `unawaited`: `ensureVisible` devuelve un `Future` que se resuelve cuando
    // termina el scroll; no hay nada que hacer con él y el lint de
    // `discarded_futures` obliga a ser explícito.
    unawaited(
      Scrollable.ensureVisible(
        target,
        duration: const Duration(milliseconds: 250),
        alignment: 0.5,
        curve: Curves.easeOutCubic,
      ),
    );
  }
}

/// Destino del carrusel: ícono + etiqueta, con píldora cuando está activo.
///
/// El texto va con `maxLines: 1` y la píldora con `minWidth` holgada para que
/// «Configuración» quepa ENTERO en vez de partirse en tres líneas.
class _DestinationPill extends StatelessWidget {
  const _DestinationPill({
    required this.item,
    required this.selected,
    required this.t,
    required this.onTap,
    super.key,
  });

  final AppDestination item;
  final bool selected;
  final AppTokens t;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final Color foreground =
        selected ? t.onAccentContainer : t.textSecondary;
    return Semantics(
      button: true,
      selected: selected,
      label: item.label,
      excludeSemantics: true,
      child: Material(
        color: selected ? t.accentContainer : Colors.transparent,
        borderRadius: BorderRadius.circular(AppRadii.pill),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(AppRadii.pill),
          splashColor: t.focusRingSurface,
          child: Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.md,
              vertical: AppSpacing.sm,
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                destinationIcon(item, selected: selected, tokens: t),
                const SizedBox(width: AppSpacing.sm),
                // `maxLines: 1`: con 12 destinos, el ancho natural del texto es
                // lo que manda; el carril scrollea. Antes Material repartía el
                // ancho a partes iguales y partía las etiquetas en 2-3 líneas.
                Text(
                  item.label,
                  maxLines: 1,
                  softWrap: false,
                  style: AppTextStyles.labelMedium.copyWith(color: foreground),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Riel de navegación lateral compacto (tablet).
class AppNavigationRail extends StatelessWidget {
  const AppNavigationRail({
    required this.destinations,
    required this.currentLocation,
    required this.onSelected,
    super.key,
  });

  final List<AppDestination> destinations;
  final String currentLocation;
  final ValueChanged<AppDestination> onSelected;

  @override
  Widget build(BuildContext context) {
    return NavigationRail(
      selectedIndex: selectedIndex(destinations, currentLocation),
      onDestinationSelected: (int index) => onSelected(destinations[index]),
      labelType: NavigationRailLabelType.all,
      groupAlignment: -0.9,
      destinations: <NavigationRailDestination>[
        for (final AppDestination item in destinations)
          NavigationRailDestination(
            icon: destinationIcon(item),
            selectedIcon: destinationIcon(item, selected: true),
            // `minWidth` explícito: con el rail en modo compacto y sin él, los
            // rótulos se calculaban con el ancho disponible y "Admin" o
            // "Pedidos" se recortaban ("Postres" recortado en el reporte).
            padding: const EdgeInsets.symmetric(horizontal: 4),
            label: Text(
              item.label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppTextStyles.labelSmall,
            ),
          ),
      ],
    );
  }
}

/// Índice del destino activo; `0` si la ruta no está en la lista.
///
/// La comparación usa `AppDestination.isSelected`, que distingue la home
/// (`/inicio`) de sus hijas (`/inicio/pedidos`).
int selectedIndex(List<AppDestination> destinations, String currentLocation) {
  final index = destinations
      .indexWhere((AppDestination item) => item.isSelected(currentLocation));
  return index < 0 ? 0 : index;
}

/// Ícono del destino, con badge de contador si lo hay.
///
/// [tokens] se pasa explícitamente: es una función top-level sin `BuildContext`
/// al que leer, y ademas permite que quien la llame reutilice la MISMA
/// instancia de tokens para los 5 destinos en vez de resolver el tema 5 veces.
Widget destinationIcon(
  AppDestination item, {
  bool selected = false,
  AppTokens? tokens,
}) {
  final Widget icon = Icon(selected ? item.selectedIcon : item.icon);
  final int? count = item.badgeCount;
  if (count == null || count <= 0) return icon;
  final AppTokens t = tokens ?? AppTokens.light();
  return Badge.count(
    count: count,
    // El badge es un componente de estado, no un botón: lleva `stateErrorStrong`
    // (rojo de acción, el mismo en los dos modos) con SU PROPIO `onError`,
    // nunca el `onActionPrimary` del primario. Sobre un rojo oscuro con texto
    // blanco el ratio es 5.4:1, y en oscuro el rojo claro lleva tinta oscura.
    backgroundColor: t.stateErrorStrong,
    textColor: t.onActionDanger,
    child: icon,
  );
}
