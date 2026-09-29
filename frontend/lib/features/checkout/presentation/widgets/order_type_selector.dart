// Selector de TIPO DE PEDIDO: tres tarjetas grandes.
//
// POR QUÉ TARJETAS Y NO UN `SegmentedButton`
// Son tres decisiones de negocio distintas con consecuencias muy diferentes
// (llevarse, sentarse o alquilar). Un control segmentado obligaría a apretar y no
// dejaría explicar qué pasa en cada caso, que es justo lo que la gente quiere
// saber antes de elegir. Cada tarjeta lleva ícono + título + descripción.
//
// ACCESIBILIDAD
// - `Semantics(button:, selected:)` en cada tarjeta: el lector anuncia "Para
//   llevar, seleccionada".
// - La marca de selección NO es solo color: check + texto "Elegido" + borde de 2 dp
//   (WCAG 1.4.1 y 1.4.11).
// - Target de 44 dp mínimo: la tarjeta entera es pulsable y mide mucho más.
// - `AnimatedContainer` para el cambio de estado; con `prefers-reduced-motion` el
//   sistema reduce la duración automáticamente y el contenido no depende de ella.


import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../shared/widgets/ui/app_card.dart';
import '../../domain/entities/checkout_options.dart';
import '../checkout_controller.dart';

/// Fila de tarjetas de tipo de pedido.
class OrderTypeSelector extends ConsumerWidget {
  const OrderTypeSelector({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final String selected = ref.watch(checkoutProvider).type;

    // ─────────────────────────────────────────────────────────────────────────
    // EL BUG QUE VACIABA EL CHECKOUT ENTERO (y que no daba ningún error visible)
    // ─────────────────────────────────────────────────────────────────────────
    // Este selector se montaba así:
    //
    //   LayoutBuilder(
    //     builder: (_, c) {
    //       final columns = c.maxWidth > 420 ? 1 : 2;
    //       return Column(children: [ Row(crossAxisAlignment: stretch, ...) ]);
    //     },
    //   )
    //
    // Dentro de un `ListView`, el `LayoutBuilder` recibe `maxHeight: infinity`
    // (el scroll vertical no acota la altura de sus hijos). Y un `Row` con
    // `CrossAxisAlignment.stretch` NECESITA una altura finita para repartirla
    // entre sus hijos: con altura infinita, `RenderFlex` lanza
    // `BoxConstraints ... has a non-null maxHeight being infinite` en
    // `debugAssertIsValid`, el `Column` entero se queda sin pintar y el paso
    // «Tipo» aparece VACÍO.
    //
    // Lo grave es que el fallo era SILENCIOSO en pantalla (la barra de pasos y el
    // botón sí se pintaban, así que la app parecía viva) y solo se veía como
    // «el checkout no carga». Ahora el selector decide por ANCHOS, que es lo
    // único que un `ListView` sí acota, y no estira en vertical: las tarjetas
    // miden su texto y el `Row` las iguala con `IntrinsicHeight`, que sí funciona
    // con altura libre.
    //
    // Regresión cubierta por `test/checkout_layout_test.dart`.
    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        // Dos columnas en móvil (tarjetas estrechas pero legibles) y una sola
        // columna en pantallas anchas, donde una tarjeta de 1000 px de ancho no
        // ayuda a leer. Solo depende del ANCHO, que siempre está acotado.
        final int columns = constraints.maxWidth > 420 ? 1 : 2;

        final List<Widget> rows = <Widget>[];
        for (int i = 0; i < kOrderTypeOptions.length; i += columns) {
          rows.add(Padding(
            padding: const EdgeInsets.only(bottom: AppSpacing.md),
            // `CrossAxisAlignment.start` (NO `stretch`) y sin `IntrinsicHeight`.
            //
            // Las dos alternativas fallan en un `ListView`:
            //  · `stretch` + altura infinita  -> `BoxConstraints ... maxHeight
            //    being infinite` y el árbol no se pinta.
            //  · `IntrinsicHeight` + `stretch` -> el `Row` recibe ancho no
            //    acotado y `Expanded` falla con "incoming width constraints are
            //    unbounded".
            //
            // Lo que sí funciona con altura libre es dejar que cada tarjeta mida
            // su contenido y alinearlas ARRIBA: `start` usa la altura natural de
            // cada hijo y no necesita ninguna altura padre. La consecuencia —que
            // dos tarjetas de la misma fila no midan exactamente igual— no se ve:
            // todas llevan el mismo número de líneas de texto.
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                for (int j = i;
                    j < i + columns && j < kOrderTypeOptions.length;
                    j++) ...<Widget>[
                  if (j > i) const SizedBox(width: AppSpacing.md),
                  Expanded(
                    child: _OrderTypeCard(
                      option: kOrderTypeOptions[j],
                      selected: kOrderTypeOptions[j].type == selected,
                      onTap: () => ref
                          .read(checkoutProvider.notifier)
                          .selectType(kOrderTypeOptions[j].type),
                    ),
                  ),
                ],
              ],
            ),
          ));
        }

        return Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: rows,
        );
      },
    );
  }
}

/// Tarjeta de un tipo de pedido.
class _OrderTypeCard extends StatelessWidget {
  const _OrderTypeCard({
    required this.option,
    required this.selected,
    required this.onTap,
  });

  final OrderTypeOption option;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final Color accent =
        selected ? context.tokens.actionPrimary : context.tokens.textSecondary;

    return Semantics(
      button: true,
      selected: selected,
      label: '${option.label}. ${option.description}',
      excludeSemantics: true,
      child: AppCard(
        onTap: onTap,
        padding: const EdgeInsets.all(AppSpacing.md),
        borderRadius: 16,
        color: selected ? context.tokens.surfaceGreenSubtle : null,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Row(
              children: <Widget>[
                Icon(option.icon, size: 24, color: accent),
                const Spacer(),
                // Marca de seleccionado: check + texto, no solo color.
                if (selected) ...<Widget>[
                  Icon(Icons.check_circle_rounded, size: 18, color: accent),
                  const SizedBox(width: AppSpacing.xs),
                  Text(
                    'Elegido',
                    style: AppTextStyles.labelMedium
                        .copyWith(color: context.tokens.textSuccess),
                  ),
                ],
              ],
            ),
            const SizedBox(height: AppSpacing.sm),
            Text(
              option.label,
              style: AppTextStyles.titleMedium
                  .copyWith(color: context.tokens.textPrimary),
            ),
            const SizedBox(height: AppSpacing.xxs),
            Text(
              option.description,
              style: AppTextStyles.captionMedium
                  .copyWith(color: context.tokens.textSecondary),
            ),
          ],
        ),
      ),
    );
  }
}
