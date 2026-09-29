// Pestaña «Silla»: tu alquiler en curso + el mapa del local.
//
// QUÉ RESUELVE ESTA PESTAÑA
// La cafetería alquila sillas. Quien ya tiene una necesita saber cuánto le queda (y
// no solo "hasta las 16:00", sino el tiempo REAL que queda); quien no tiene
// necesita ver el plano y elegir desde aquí, sin entrar al checkout.
//
// LAYOUT ADAPTATIVO (docs/DESIGN-TOKENS §5)
//   mobile / tablet → una columna: temporizador, mapa, leyenda
//   desktop / wide  → dos columnas: izquierda tu silla y el mapa; derecha el detalle
//                     de la silla seleccionada (panel fijo, no un sheet)
//
// ESTADOS
//   alquiler cargando   → `AsyncStateBuilder` con mensaje
//   sin alquiler        → `EmptyState` con salida al checkout (no una pantalla en
//                         blanco ni un "0")
//   error / sin red     → `OfflineState` / `ErrorState` con reintento. NUNCA se
//                         sustituye un fallo por "no tienes silla": sería una
//                         mentira que puede costar dinero.


import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../app/breakpoints.dart';
import '../../../app/theme/app_spacing.dart';
import '../../../core/customer/chair_map.dart';
import '../../../shared/widgets/ui/async_state_builder.dart';
import '../../orders/domain/entities/rental.dart';
import './chair_controller.dart';
import './widgets/active_rental_card.dart';
import './widgets/chair_map_block.dart';

/// Pantalla de la pestaña «Silla».
class ChairTabPage extends ConsumerStatefulWidget {
  const ChairTabPage({super.key});

  @override
  ConsumerState<ChairTabPage> createState() => _ChairTabPageState();
}

class _ChairTabPageState extends ConsumerState<ChairTabPage> {
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
        const SizedBox(height: AppSpacing.xl),
        ChairMapBlock(
          map: map,
          selectedId: _selectedId,
          // `onSelect` entrega la `ChairInfo` COMPLETA, no un id suelto: el panel
          // de detalle y el POS necesitan el código y el estado de la silla.
          onSelect: (ChairInfo chair) =>
              setState(() => _selectedId = chair.id),
        ),
      ],
    );

    // El panel de detalle solo existe en desktop/wide. En móvil la información se
    // ve dentro de la propia celda del mapa y del `EmptyState` que la acompaña.
    final Widget? right = wide && map.hasValue
        ? SelectedChairPanel(map: map.requireValue, selectedId: _selectedId)
        : null;

    // La navegación (AppBar, rail, sidebar y bottom bar) la pone `CustomerShell`,
    // que es el dueño del chrome de las cinco pestañas. Esta pantalla solo
    // devuelve su contenido: envolverla en otro `AdaptiveScaffold` duplicaría la
    // barra de navegación.
    return right == null
        ? left
        : Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Expanded(flex: 3, child: left),
              VerticalDivider(
                width: 1,
                color: Theme.of(context).colorScheme.outlineVariant,
              ),
              SizedBox(width: 360, child: right),
            ],
          );
  }
}
