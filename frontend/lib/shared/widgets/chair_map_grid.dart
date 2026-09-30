// Mapa de sillas en rejilla.
//
// Vive en `shared/widgets/` y no en la feature de checkout porque lo consumen
// TRES features (el checkout del cliente, la pestaña «Silla» y el selector de
// silla del POS) y las features no se importan entre sí (DESIGN.md §2.3).
// `features/checkout/presentation/widgets/chair_map_grid.dart` reexporta este
// archivo para no romper los imports anteriores.
//
// EL REQUISITO QUE IMPONE ESTE WIDGET
// Cada silla se comunica con COLOR + ÍCONO + TEXTO, nunca solo con color
// (docs/DESIGN-TOKENS §6.1). Con ~8 % de hombres con daltonismo rojo/verde,
// "ocupada" y "disponible" son indistinguibles sin forma, y leer mal significa
// reservar la silla de otro. Por eso la celda lleva:
//   - la superficie del estado (`context.tokens.*`),
//   - un ícono (`AppStatusVisuals.chair*.icon`),
//   - el texto del estado en el tono oscuro del mismo color.
//
// La zona coloreada se pinta con los tokens de `AppColors`/`AppStateColors`, nunca
// con el `colorHex` que elige el negocio: la app no puede garantizar contraste AA
// de un color arbitrario con el texto que pone encima.
//
// COMO SE ESCALA LA REJILLA
// `gridX`/`gridY` llegan normalizados (0-1000 en la API). Se reescalan al ancho
// disponible, así que el mismo mapa se ve igual en un móvil de 320 dp y en un
// escritorio de 1200 dp. Se usa `Wrap` en lugar de `GridView` porque el número de
// columnas depende del ancho y una grilla fija con `gridX` reales se descuadra
// en cuanto el contenedor no coincide con la retícula del servidor.


import 'package:flutter/material.dart';

import '../../app/theme/app_radii.dart';
import '../../app/theme/app_spacing.dart';
import '../../app/theme/app_tokens.dart';
import '../../app/theme/app_typography.dart';
import '../../core/customer/chair_map.dart';
import './ui/status_badge_resolver.dart';
import './ui/status_badge_visuals.dart';

/// Rejilla de sillas por zona.
class ChairMapGrid extends StatelessWidget {
  const ChairMapGrid({
    required this.map,
    this.selectedId,
    this.onSelect,
    this.allowUnavailableSelection = false,
    super.key,
  });

  final ChairMap map;
  final int? selectedId;

  /// Callback al tocar una silla seleccionable. `null` = el mapa es de solo
  /// lectura (mirar no es elegir).
  final ValueChanged<ChairInfo>? onSelect;

  /// `true` = [onSelect] también se dispara en sillas NO seleccionables.
  ///
  /// POR QUÉ EXISTE, Y POR QUÉ ESTÁ APAGADO POR DEFECTO
  /// La pestaña «Silla» tiene que poder abrir la ficha de una silla OCUPADA: es
  /// justo ahí donde se responde «quién la ocupa y hasta cuándo», y
  /// `ChairInfo.isSelectable` excluye precisamente las ocupadas. Sin esta bandera
  /// la única forma de sacar esa información sería un `GET /chairs/:id` disparado por
  /// otra vía, que es más código para lo mismo.
  ///
  /// El checkout NO la activa, y esa es la parte importante: allí «elegir» una silla
  /// ocupada no debe hacer nada, porque la elección va a un formulario que ya se
  /// sabe que va a fallar. Dejarlo en `false` por defecto hace que cambiar este
  /// comportamiento sea una decisión explícita de quien lo activa.
  final bool allowUnavailableSelection;

  @override
  Widget build(BuildContext context) {
    if (map.isEmpty) return const SizedBox.shrink();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        for (final ZoneMap zone in map.zones) ...<Widget>[
          Padding(
            padding: const EdgeInsets.only(top: AppSpacing.md, bottom: AppSpacing.sm),
            child: Row(
              children: <Widget>[
                Expanded(
                  child: Text(zone.name, style: AppTextStyles.titleSmall),
                ),
                Text(
                  '${zone.availableCount} de ${zone.chairs.length} libres',
                  style: AppTextStyles.captionMedium
                      .copyWith(color: context.tokens.textSecondary),
                ),
              ],
            ),
          ),
          LayoutBuilder(
            builder: (BuildContext context, BoxConstraints constraints) =>
                _ZoneGrid(
              zone: zone,
              constraints: constraints,
              selectedId: selectedId,
              onSelect: onSelect,
              allowUnavailableSelection: allowUnavailableSelection,
            ),
          ),
        ],
      ],
    );
  }
}

/// Rejilla de una zona.
class _ZoneGrid extends StatelessWidget {
  const _ZoneGrid({
    required this.zone,
    required this.constraints,
    required this.selectedId,
    required this.onSelect,
    required this.allowUnavailableSelection,
  });

  final ZoneMap zone;
  final BoxConstraints constraints;
  final int? selectedId;

  /// `null` cuando el mapa es de solo lectura: entonces ninguna celda es
  /// pulsable aunque la silla esté libre.
  final ValueChanged<ChairInfo>? onSelect;

  /// Ver [ChairMapGrid.allowUnavailableSelection].
  final bool allowUnavailableSelection;

  @override
  Widget build(BuildContext context) {
    // Ancho de celda objetivo: 88 dp. Con menos caben menos columnas, no celdas
    // ilegibles.
    const double targetCell = 88;
    final double available = constraints.maxWidth;
    final int columns = (available / targetCell).floor().clamp(1, 8);
    final ValueChanged<ChairInfo>? onSelect = this.onSelect;

    return Wrap(
      spacing: AppSpacing.sm,
      runSpacing: AppSpacing.sm,
      children: <Widget>[
        for (final ChairInfo chair in zone.chairs)
          SizedBox(
            width: (available - (columns - 1) * AppSpacing.sm) / columns,
            child: ChairMapCell(
              chair: chair,
              selected: chair.id == selectedId,
              // Una silla INACTIVA no se abre nunca: no existe para el cliente y su
              // `GET /chairs/:id` devolvería datos de un recurso dado de baja.
              onTap: onSelect == null || !chair.isActive
                  ? null
                  : (!chair.isSelectable && !allowUnavailableSelection)
                      ? null
                      : () => onSelect(chair),
            ),
          ),
      ],
    );
  }
}

/// Celda de una silla: color + ícono + texto + etiqueta.
class ChairMapCell extends StatelessWidget {
  const ChairMapCell({
    required this.chair,
    required this.selected,
    this.onTap,
    super.key,
  });

  final ChairInfo chair;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    // El catálogo de estados es el ÚNICO lugar que traduce `ChairStatus` a
    // color + ícono + texto. Esta pantalla no declara ningún mapa de estados.
    final AppStatusVisual visual = forChair(chair.status);
    // Los tres colores se resuelven contra el tema ACTUAL en el momento de
    // pintar: el catálogo solo guarda la clave (`StatusPalette`). Antes esta
    // celda leía `visual.surface` / `visual.text`, que eran constantes del modo
    // claro, y en modo oscuro pintaba surface crema con texto crema.
    final StatusColors colors = statusColorsOf(context, visual.palette);
    final AppTokens t = context.tokens;
    final bool enabled = onTap != null;

    return Semantics(
      button: true,
      enabled: enabled,
      selected: selected,
      label: '${chair.cellLabel}, ${chair.zoneName ?? 'silla'}, '
          '${visual.label}'
          '${chair.isSelectable ? '' : ', no disponible'}',
      excludeSemantics: true,
      child: Tooltip(
        message: '${chair.cellLabel} · ${visual.label}',
        child: Opacity(
          opacity: enabled ? 1 : 0.75,
          child: Material(
            color: colors.surface,
            borderRadius: BorderRadius.circular(AppRadii.md),
            child: InkWell(
              onTap: onTap,
              borderRadius: BorderRadius.circular(AppRadii.md),
              child: Container(
                // `minHeight` en vez de altura fija: la celda crece si el
                // estado seleccionado añade el check, y en un móvil estrecho la
                // etiqueta larga no se recorta en vertical.
                constraints: const BoxConstraints(minHeight: 64),
                padding: const EdgeInsets.all(AppSpacing.sm),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(AppRadii.md),
                  // Borde de 2 dp en la seleccionada: tercer canal además del
                  // color, para el daltonismo y para la impresión en B/N.
                  border: Border.all(
                    color: selected ? t.actionPrimary : t.borderSubtle,
                    width: selected ? 2 : 1,
                  ),
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: <Widget>[
                    Icon(visual.icon, size: 18, color: colors.text),
                    const SizedBox(height: AppSpacing.xxs),
                    Text(
                      chair.cellLabel,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style:
                          AppTextStyles.labelMedium.copyWith(color: colors.text),
                    ),
                    Text(
                      visual.label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style:
                          AppTextStyles.captionSmall.copyWith(color: colors.text),
                    ),
                    if (selected)
                      Icon(
                        Icons.check_circle_rounded,
                        size: 14,
                        color: t.actionPrimary,
                      ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
