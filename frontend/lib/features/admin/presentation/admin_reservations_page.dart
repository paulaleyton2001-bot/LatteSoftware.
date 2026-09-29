// Pantalla de Reservas y Alquileres del panel.
//
// DOS SECCIONES, UNA PANTALLA
// Arriba, los ALQUILERES EN CURSO con el temporizador en vivo y el botón de
// extender: es lo que se mira veinte veces al día. Abajo, las RESERVAS de la
// ventana (semana pasada a mes que viene), que se confirman y se hacen check-in.
//
// POR QUÉ EL TEMPORIZADOR NO SE CALCULA AQUÍ
// `GET /rentals/active` devuelve `elapsedMinutes`, `remainingMinutes` y
// `overtimeMinutes` YA calculados. La app solo los muestra y los refresca cada
// segundo con un `Timer`. El mínimo de 30 minutos, el redondeo al alza y el cobro
// del exceso son reglas del servidor (BR-RENTAL-003/004): recalcular en cliente
// haría que el número de la pantalla no cuadrara con el del cobro.
//
// EL TIMER SE LIBERA EN `dispose`
// Un `Timer.periodic` sin liberar sigue corriendo tras salir de la pantalla y
// reconstruye un widget que ya no existe: fuga de memoria y error en caliente.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../app/breakpoints.dart';
import '../../../app/theme/app_spacing.dart';
import '../../../shared/constants/app_strings.dart';
import '../../../shared/widgets/ui/async_state_builder.dart';
import '../../../shared/widgets/ui/section_header.dart';
import '../domain/entities/admin_rentals.dart';
import '../domain/entities/admin_spaces.dart';
import './admin_reservations_controller.dart';
import './widgets/admin_rental_card.dart';
import './widgets/admin_reservation_row.dart';
import './widgets/admin_table_scaffold.dart';

/// Reservas y alquileres del local.
class AdminReservationsPage extends ConsumerWidget {
  const AdminReservationsPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final double padding = context.breakpoint.screenPadding;

    return ListView(
      padding: EdgeInsets.fromLTRB(padding, AppSpacing.xl, padding, AppSpacing.xxl),
      children: <Widget>[
        const AdminPageHeader(
          title: AppStrings.navReservations,
          subtitle: 'Reservas por confirmar y alquileres que están en curso',
        ),
        const SectionHeader(
          title: 'En curso ahora',
          subtitle: 'El temporizador lo calcula el servidor',
        ),
        const SizedBox(height: AppSpacing.md),
        const _ActiveRentals(),
        const SizedBox(height: AppSpacing.xxl),
        const SectionHeader(
          title: 'Reservas',
          subtitle: 'De la semana pasada al próximo mes',
        ),
        const SizedBox(height: AppSpacing.md),
        const _Reservations(),
      ],
    );
  }
}

/// Sección de alquileres en curso.
class _ActiveRentals extends ConsumerWidget {
  const _ActiveRentals();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<List<AdminRental>> rentals =
        ref.watch(adminActiveRentalsProvider);

    return AsyncStateBuilder<List<AdminRental>>(
      value: rentals,
      loadingMessage: 'Cargando los alquileres…',
      onRetry: () async => ref.invalidate(adminActiveRentalsProvider),
      isEmpty: (List<AdminRental> data) => data.isEmpty,
      emptyIcon: Icons.event_available_outlined,
      emptyTitle: AppStrings.adminEmptyActiveRentals,
      emptyMessage: 'Aquí aparecen los alquileres en cuanto alguien se sienta.',
      compactEmpty: true,
      builder: (BuildContext context, List<AdminRental> data) => LayoutBuilder(
        builder: (BuildContext context, BoxConstraints constraints) {
          final int columns = (constraints.maxWidth / 320).floor().clamp(1, 3);
          return GridView.count(
            crossAxisCount: columns,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            mainAxisSpacing: AppSpacing.md,
            crossAxisSpacing: AppSpacing.md,
            childAspectRatio: 0.95,
            children: <Widget>[
              for (final AdminRental rental in data)
                AdminRentalCard(rental: rental),
            ],
          );
        },
      ),
    );
  }
}

/// Sección de reservas.
class _Reservations extends ConsumerWidget {
  const _Reservations();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<List<AdminReservation>> reservations =
        ref.watch(adminReservationsProvider);
    final String? status = ref.watch(adminReservationStatusProvider);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        AdminFilterBar(
          searchHint: 'Código de reserva…',
          onSearch: (String value) => ref
              .read(adminReservationStatusProvider.notifier)
              .state = value.isEmpty ? null : value.toUpperCase(),
          filters: <AdminFilterOption>[
            if (status != null)
              AdminFilterOption(
                id: 'status',
                label: _statusLabel(status),
                icon: Icons.flag_outlined,
                isActive: true,
                onTap: () =>
                    ref.read(adminReservationStatusProvider.notifier).state = null,
              ),
          ],
        ),
        Expanded(
          child: AsyncStateBuilder<List<AdminReservation>>(
            value: reservations,
            loadingMessage: 'Cargando reservas…',
            onRetry: () async => ref.invalidate(adminReservationsProvider),
            isEmpty: (List<AdminReservation> data) => data.isEmpty,
            emptyIcon: Icons.event_note_outlined,
            emptyTitle: AppStrings.adminEmptyReservations,
            emptyMessage: 'Cambia el estado o amplía la ventana de fechas.',
            builder: (BuildContext context, List<AdminReservation> data) =>
                ListView.separated(
              padding: EdgeInsets.zero,
              itemCount: data.length,
              separatorBuilder: (BuildContext context, int index) =>
                  const SizedBox(height: AppSpacing.sm),
              itemBuilder: (BuildContext context, int index) =>
                  AdminReservationRow(reservation: data[index]),
            ),
          ),
        ),
      ],
    );
  }

  static String _statusLabel(String status) => switch (status) {
        'PENDING' => 'Pendientes',
        'CONFIRMED' => 'Confirmadas',
        'ACTIVE' => 'En curso',
        'COMPLETED' => 'Finalizadas',
        'CANCELLED' => 'Canceladas',
        'EXPIRED' => 'Vencidas',
        _ => status,
      };
}
