// Pantalla de Sillas y Zonas del panel.
//
// MAPA + LISTA, EN PARALELO
// El plano (`ChairMapGrid`, de `shared/widgets/`) da la lectura rápida de "cómo está
// el local"; la lista da las acciones (bloquear, mantenimiento) y los datos que el
// plano no muestra (precio por hora, última cambio de estado). En desktop van en dos
// columnas; en móvil, la lista debajo del plano.
//
// LA LISTA SE AGRUPA POR ZONA
// Un mostrador piensa por zonas ("las de la terraza"), no por una lista alfabética
// de 40 sillas. Y el filtro de zona sirve para el mapa: al elegir una zona, el plano
// se recorta a ella.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../app/breakpoints.dart';
import '../../../app/theme/app_spacing.dart';
import '../../../shared/constants/app_strings.dart';
import '../../../shared/widgets/ui/async_state_builder.dart';
import '../domain/entities/admin_spaces.dart';
import './admin_spaces_controller.dart';
import './widgets/admin_chair_card.dart';
import './widgets/admin_chair_map_panel.dart';
import './widgets/admin_list_and_state.dart';
import './widgets/admin_table_scaffold.dart';

/// Listado de sillas del local, con mapa y contadores.
class AdminChairsPage extends ConsumerStatefulWidget {
  const AdminChairsPage({super.key});

  @override
  ConsumerState<AdminChairsPage> createState() => _AdminChairsPageState();
}

class _AdminChairsPageState extends ConsumerState<AdminChairsPage> {
  final TextEditingController _search = TextEditingController();

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<List<AdminChair>> chairs = ref.watch(adminChairsProvider);
    final List<AdminChair> visible = ref.watch(adminVisibleChairsProvider);
    final List<AdminZone> zones = ref.watch(adminZonesProvider).valueOrNull ??
        const <AdminZone>[];
    final int? zoneFilter = ref.watch(adminZoneFilterProvider);
    final double padding = context.breakpoint.screenPadding;
    final bool wide = context.breakpoint.usesSidebar;

    return ListView(
      padding: EdgeInsets.fromLTRB(padding, AppSpacing.xl, padding, AppSpacing.xxl),
      children: <Widget>[
        const AdminPageHeader(
          title: AppStrings.navChairs,
          subtitle: 'Zonas, sillas y su estado en el local',
        ),
        AdminFilterBar(
          controller: _search,
          searchHint: 'Código, nombre o etiqueta…',
          onSearch: (String value) =>
              ref.read(adminChairSearchProvider.notifier).state = value,
          filters: <AdminFilterOption>[
            if (zones.isNotEmpty)
              AdminFilterOption(
                id: 'zone',
                label: zoneFilter == null ? 'Zona' : _zoneName(zones, zoneFilter),
                icon: Icons.grid_view_rounded,
                isActive: zoneFilter != null,
                onTap: () => _pickZone(context, ref, zones),
              ),
          ],
        ),
        AsyncStateBuilder<List<AdminChair>>(
          value: chairs,
          loadingMessage: 'Cargando las sillas…',
          onRetry: () async => ref.invalidate(adminChairsProvider),
          isEmpty: (List<AdminChair> data) => data.isEmpty,
          emptyIcon: Icons.event_seat_outlined,
          emptyTitle: 'El local no tiene sillas',
          emptyMessage: 'Crea primero una zona y luego las sillas dentro.',
          builder: (BuildContext context, List<AdminChair> data) {
            if (visible.isEmpty) {
              return const AdminEmptyTable(
                icon: Icons.filter_alt_off_rounded,
                title: 'Ninguna silla coincide',
                message: 'Prueba con otro texto o quita el filtro de zona.',
              );
            }
            final Widget map = const AdminChairMapPanel();
            final Widget list = _ChairList(chairs: visible, zones: zones);
            if (!wide) {
              return Column(
                children: <Widget>[
                  map,
                  const SizedBox(height: AppSpacing.lg),
                  Expanded(child: list),
                ],
              );
            }
            return Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                Expanded(flex: 4, child: map),
                const SizedBox(width: AppSpacing.lg),
                Expanded(flex: 5, child: list),
              ],
            );
          },
        ),
      ],
    );
  }

  /// Nombre de la zona seleccionada, o un texto neutro si ya no existe.
  ///
  /// Se busca con un bucle y no con `firstOrNull`: `firstOrNull` viene de
  /// `package:collection`, y `pubspec.yaml` no puede cambiar en esta fase.
  static String _zoneName(List<AdminZone> zones, int zoneId) {
    for (final AdminZone zone in zones) {
      if (zone.id == zoneId) return zone.name;
    }
    return 'Zona';
  }

  /// Hoja de selección de zona.
  Future<void> _pickZone(
    BuildContext context,
    WidgetRef ref,
    List<AdminZone> zones,
  ) async {
    final int? current = ref.read(adminZoneFilterProvider);
    final int? picked = await showModalBottomSheet<int?>(
      context: context,
      showDragHandle: true,
      builder: (BuildContext sheetContext) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: <Widget>[
            ListTile(
              title: const Text('Todas las zonas'),
              trailing: current == null ? const Icon(Icons.check_rounded) : null,
              onTap: () => Navigator.of(sheetContext).pop(-1),
            ),
            for (final AdminZone zone in zones)
              ListTile(
                title: Text(zone.name),
                subtitle: Text('${zone.chairCount} sillas'),
                trailing: current == zone.id ? const Icon(Icons.check_rounded) : null,
                onTap: () => Navigator.of(sheetContext).pop(zone.id),
              ),
          ],
        ),
      ),
    );
    if (picked == null) return;
    ref.read(adminZoneFilterProvider.notifier).state =
        picked < 0 ? null : picked;
  }
}

/// Lista de sillas agrupada por zona.
///
/// RENDIMIENTO: construye la lista de ÍTEMS, no la de widgets.
///
/// Antes se armaba un `List<Widget>` con TODAS las sillas y se pasaba a
/// `ListView(children:)`, lo que obliga a Flutter a construir e insertar cada
/// `AdminChairCard` aunque estuviera fuera de pantalla. Con un local de 60-80
/// sillas eso son 60-80 `ListTile`+`Card` por rebuild del filtro (cada pulsación
/// de filtro reconstruía la pantalla entera). Ahora se indexa en una lista plana
/// de [_Row] y se pinta con `ListView.builder`, que solo crea lo que cabe (más
/// el `cacheExtent` que Flutter pone por defecto).
class _ChairList extends StatelessWidget {
  const _ChairList({required this.chairs, required this.zones});

  final List<AdminChair> chairs;
  final List<AdminZone> zones;

  @override
  Widget build(BuildContext context) {
    final Map<int, List<AdminChair>> byZone = <int, List<AdminChair>>{};
    for (final AdminChair chair in chairs) {
      byZone.putIfAbsent(chair.zoneId ?? 0, () => <AdminChair>[]).add(chair);
    }

    // Índice plano: cabecera de zona + sillas + separador. Se construye una vez
    // por rebuild (son datos, no widgets) y `ListView.builder` elige qué pintar.
    final List<_ChairRow> rows = <_ChairRow>[];
    for (final AdminZone zone in zones) {
      final List<AdminChair>? items = byZone[zone.id];
      if (items == null || items.isEmpty) continue;
      rows.add(_ChairRow.header(zone));
      for (final AdminChair chair in items) {
        rows.add(_ChairRow.item(chair));
      }
    }
    if (rows.isEmpty) {
      // Sillas sin zona asignada: se muestran igual, agrupadas al final.
      final List<AdminChair>? orphans = byZone[0];
      if (orphans != null) {
        for (final AdminChair chair in orphans) {
          rows.add(_ChairRow.item(chair));
        }
      }
    }

    return ListView.builder(
      padding: EdgeInsets.zero,
      itemCount: rows.length,
      itemBuilder: (BuildContext context, int index) {
        final _ChairRow row = rows[index];
        return switch (row) {
          _ChairRow(kind: _ChairRowKind.header) => AdminZoneHeader(zone: row.zone!),
          _ChairRow(kind: _ChairRowKind.item) => Padding(
              padding: const EdgeInsets.only(bottom: AppSpacing.sm),
              child: AdminChairCard(chair: row.chair!),
            ),
        };
      },
    );
  }
}

/// Fila del índice: una cabecera de zona o una silla.
enum _ChairRowKind { header, item }

class _ChairRow {
  const _ChairRow.header(AdminZone this.zone)
      : kind = _ChairRowKind.header,
        chair = null;
  const _ChairRow.item(AdminChair this.chair)
      : kind = _ChairRowKind.item,
        zone = null;

  final _ChairRowKind kind;
  final AdminZone? zone;
  final AdminChair? chair;
}
