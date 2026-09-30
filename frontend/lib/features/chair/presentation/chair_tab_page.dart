// Pestaña «Silla»: tu alquiler en curso, el mapa del local y el panel de acción.
// Módulo `features/chair/presentation`.
//
// ─────────────────────────────────────────────────────────────────────────────
// POR QUÉ ANTES NO SE PODÍA ALQUILAR NADA DESDE AQUÍ
//
// La callback de selección era:
//
//     onSelect: (ChairInfo chair) => setState(() => _selectedId = chair.id),
//
// y el panel que consume ese `_selectedId` solo se construía dentro de
//
//     final Widget? right = wide && map.hasValue
//         ? SelectedChairPanel(...)   // ← `wide` = `context.breakpoint.usesSidebar`
//         : null;
//
// En un móvil `usesSidebar` es `false`, así que `right` era `null` y `build`
// devolvía únicamente la lista de la izquierda: la selección se guardaba en el
// estado y no se pintaba NADA. Por eso el `logcat` no mostraba ninguna llamada a
// la API: la app no la hacía. Y no la podía hacer, porque la feature entera no
// tenía ningún método de escritura: `RentalRepository` declaraba únicamente
// `myRentals()`.
//
// El arreglo tiene tres piezas, todas en este módulo:
//   1. `_selectChair` abre el panel — hoja modal en estrecho, columna en ancho.
//   2. `ChairActionPanel` decide qué acciones hay según estado y permisos.
//   3. `RentalRepository` tiene ya los métodos (`POST /reservations`,
//      `POST /rentals`, extend, complete, `PATCH /chairs/:id/status`).
//
// LAYOUT ADAPTATIVO (docs/DESIGN-TOKENS §5)
//   móvil / tableta → una columna; el panel de la silla se abre como hoja modal,
//                      porque la acción compite con el pulgar y tapar fuera para
//                      cerrar es lo que espera quien está de pie en el local
//   escritorio       → dos columnas; el panel es una columna fija, no un sheet
//
// ESTADOS
//   alquiler cargando   → `AsyncStateBuilder` con mensaje
//   sin alquiler        → `EmptyState` con salida al mapa y al checkout
//   error / sin red     → `OfflineState` / `ErrorState` con reintento. NUNCA se
//                         sustituye un fallo por «no tienes silla»: sería una
//                         mentira que puede costar dinero.

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/breakpoints.dart';
import '../../../app/routes.dart';
import '../../../app/theme/app_spacing.dart';
import '../../../core/customer/chair_map.dart';
import '../../../shared/widgets/ui/async_state_builder.dart';
import '../../orders/domain/entities/rental.dart';
import './chair_controller.dart';
import './widgets/active_rental_card.dart';
import './widgets/chair_action_panel.dart';
import './widgets/chair_map_block.dart';

/// Pantalla de la pestaña «Silla».
class ChairTabPage extends ConsumerStatefulWidget {
  const ChairTabPage({super.key});

  @override
  ConsumerState<ChairTabPage> createState() => _ChairTabPageState();
}

class _ChairTabPageState extends ConsumerState<ChairTabPage> {
  /// Silla abierta. En móvil no se ve nada aquí (la hoja modal lleva el panel), pero
  /// se mantiene para que al volver a la pestaña se recuerde cuál era, y para que
  /// el marco de la celda en el mapa no desaparezca.
  int? _selectedId;

  @override
  Widget build(BuildContext context) {
    final AsyncValue<List<Rental>> rentals = ref.watch(myRentalsProvider);
    final Rental? active = ref.watch(activeRentalProvider);
    final AsyncValue<ChairMap> map = ref.watch(chairTabMapProvider);
    final bool wide = context.breakpoint.usesSidebar;
    final double padding = context.breakpoint.screenPadding;

    final Widget left = ListView(
      padding: EdgeInsets.fromLTRB(
        padding,
        AppSpacing.lg,
        padding,
        AppSpacing.xxl,
      ),
      children: <Widget>[
        AsyncStateBuilder<List<Rental>>(
          value: rentals,
          loadingMessage: 'Buscando tu silla…',
          onRetry: () async => ref.invalidate(myRentalsProvider),
          builder: (BuildContext context, List<Rental> data) =>
              active == null ? const NoActiveRentalNotice() : ActiveRentalCard(rental: active),
        ),
        const SizedBox(height: AppSpacing.sm),
        // SALIDA A «MIS RESERVAS»
        // Reserva creada desde el panel → el resultado se ve aquí. Sin este botón
        // la reserva se hacía a ciegas: no había forma de comprobarla desde la
        // pantalla donde se acaba de crear, y el código (`RES-…`) solo aparecía
        // buceando por el perfil. Es la misma ruta que usa el perfil
        // (`AppRoutes.reservations`), así que no hay dos listas distintas.
        Align(
          alignment: Alignment.centerLeft,
          child: TextButton.icon(
            onPressed: () => context.push(AppRoutes.reservations),
            icon: const Icon(Icons.event_note_rounded, size: 18),
            label: const Text('Ver mis reservas'),
          ),
        ),
        const SizedBox(height: AppSpacing.lg),
        ChairMapBlock(
          map: map,
          selectedId: _selectedId,
          // `onSelect` entrega la `ChairInfo` COMPLETA, no un id suelto: el panel de
          // detalle necesita el código, el precio y el estado de la silla.
          onSelect: _selectChair,
          // Aquí SÍ se activan las celdas no seleccionables: la ficha de una silla
          // ocupada es donde se explica quién la ocupa y hasta cuándo. En el
          // checkout esta bandera sigue apagada.
          allowUnavailableSelection: true,
        ),
      ],
    );

    // La navegación (AppBar, rail, sidebar y bottom bar) la pone `CustomerShell`,
    // que es el dueño del chrome de las cinco pestañas. Esta pantalla solo
    // devuelve su contenido: envolverla en otro `AdaptiveScaffold` duplicaría la
    // barra de navegación.
    //
    // El panel de la silla vive en la columna de la derecha cuando hay sitio, y en
    // una hoja modal cuando no. El MISMO `ChairActionPanel` en los dos casos, para
    // que no puedan divergir.
    if (!wide) return left;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Expanded(flex: 3, child: left),
        VerticalDivider(
          width: 1,
          color: Theme.of(context).colorScheme.outlineVariant,
        ),
        SizedBox(
          width: 380,
          child: _DesktopPanelFrame(
            selectedId: _selectedId ?? 0,
            onClear: () => setState(() => _selectedId = null),
          ),
        ),
      ],
    );
  }

  /// Abre el panel de la silla.
  ///
  /// En estrecho se levanta como hoja modal y se cierra al tocar fuera; en ancho se
  /// limita a marcar la selección, porque el panel ya está en la columna derecha.
  void _selectChair(ChairInfo chair) {
    setState(() => _selectedId = chair.id);
    if (context.breakpoint.usesSidebar) return;

    // `mounted` antes de tocar el contexto tras el `await`: si la persona sale de la
    // pestaña mientras se levanta la hoja, `showModalBottomSheet` sobre un
    // `BuildContext` liberado lanza.
    final NavigatorState? navigator = Navigator.maybeOf(context);
    if (navigator == null) return;
    unawaited(
      showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        // Tocar fuera cierra. En una pantalla donde se elige una mesa, cerrar sin
        // querer es barato; perder un formulario de reserva a medio rellenar, no.
        isDismissible: true,
        enableDrag: true,
        showDragHandle: true,
        // `useSafeArea` sube la hoja bajo el notch y la barra de gestos: en un
        // móvil de 2712 px de alto, una hoja que se metiera debajo sería
        // inaccesible.
        useSafeArea: true,
        builder: (BuildContext sheetContext) => _ChairSheetFrame(
          chairId: chair.id,
        ),
      ),
    );
  }
}

/// Marco de la hoja modal: alto acotado y scroll propio.
///
/// El alto se limita al 88 % de la pantalla porque el panel puede ser largo (ficha +
/// formulario de reserva) y una hoja a pantalla completa en un móvil de 1220x2712
/// taparía el mapa entero, que es justo la referencia que hace falta para reservar.
class _ChairSheetFrame extends StatelessWidget {
  const _ChairSheetFrame({required this.chairId});

  final int chairId;

  @override
  Widget build(BuildContext context) {
    final double maxHeight = MediaQuery.sizeOf(context).height * 0.88;
    return ConstrainedBox(
      constraints: BoxConstraints(maxHeight: maxHeight),
      // `Semantics(scopesRoute: true)`: para un lector de pantalla, la hoja es una
      // RUTA nueva. Sin esto, seguiría leyendo el contenido del mapa que queda
      // detrás y la persona no sabría que el foco se ha movido.
      //
      // `explicitChildNodes: true` NO ES OPCIONAL Y FUE UN CRASH REAL
      // Flutter 3.24 afirma en `proxy_box.dart` L4291:
      //   'explicitChildNodes must be set to true if scopes route is true'
      // Sin él, tocar una silla pintaba la pantalla ROJA con el volcado de la
      // aserción en vez del panel. Verificado en el dispositivo (Android 16) el
      // 2026-09-29: la hoja se levanta y revienta al construir el árbol de
      // semántica. Es una aserción de DEBUG, así que en release el panel aparecería
      // sin que el lector de pantalla supiera que cambió de ruta: peor.
      child: Semantics(
        scopesRoute: true,
        namesRoute: true,
        explicitChildNodes: true,
        child: Padding(
          // Un poco de aire arriba: la hoja tiene el tirador, y sin este padding el
          // título de la silla queda pegado al borde.
          padding: const EdgeInsets.only(top: AppSpacing.sm),
          child: ChairActionPanel(
            chairId: chairId,
            onClose: () => Navigator.of(context).maybePop(),
          ),
        ),
      ),
    );
  }
}

/// Columna de escritorio: el panel fijo de la derecha.
///
/// Marco propio (y no el `right` directo) para poder añadir la semicapa de fondo y
/// el aviso «toca una silla» sin duplicar el `ChairActionPanel`.
class _DesktopPanelFrame extends StatelessWidget {
  const _DesktopPanelFrame({required this.selectedId, required this.onClear});

  final int selectedId;
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    return Container(
      color: Theme.of(context).colorScheme.surface,
      child: ChairActionPanel(chairId: selectedId, onClose: onClear),
    );
  }
}
