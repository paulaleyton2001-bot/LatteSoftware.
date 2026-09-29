// Pantalla del punto de venta. COLUMNA IZQUIERDA Y CENTRO.
//
// Este archivo compone el layout adaptativo del POS y NO duplica nada del design
// system: el buscador, la rejilla, el panel de pedido y el panel de cobro son
// widgets aparte (`widgets/pos_*.dart`), y aquí solo se deciden las COLUMNAS.
//
// EL LAYOUT GANE COLUMNAS CON EL ANCHO
// `PosLayout` (app/responsive/pos_breakpoints.dart) decide cuántas columnas hay:
// `compact` una, `medium` dos, `expanded`/`ultraExpanded` tres. El ancho extra se
// reparte en columnas nuevas, nunca estirando las que ya existen: un catálogo
// estirado a 2500 px obliga a mover la mirada de un extremo a otro del mismo.
//
// EL ANCHO REAL, NO EL DE LA VENTANA
// El POS vive dentro de un shell que en `desktop`/`wide` roba 240–264 dp a la
// sidebar. Por eso el layout se resuelve con un `LayoutBuilder` sobre la columna
// que realmente tiene el POS, no con `MediaQuery`: un portátil de 1440 dp con la
// sidebar abierta da 1176 dp útiles, y si se mirara la ventana se elegiría un
// layout de dos columnas teniendo sitio para tres.
//
// EL FOCO
// El foco inicial lo pide `PosPage` en su `initState` (post-frame, porque el nodo
// aún no está montado). Aquí solo se registra el RETORNO del foco: cada alta de
// producto lo devuelve al buscador, para que el cajero siga escribiendo el
// siguiente sin volver a tocar el ratón.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../app/responsive/pos_breakpoints.dart';
import '../../../app/theme/app_spacing.dart';
import '../../../shared/widgets/ui/async_state_builder.dart';
import './pos_cart_controller.dart';
import './pos_controller.dart';
import './pos_mobile_tab.dart';
import './widgets/pos_checkout_panel.dart';
import './widgets/pos_offline_banner.dart';
import './widgets/pos_order_panel.dart';
import './widgets/pos_product_grid.dart';
import './widgets/pos_search_field.dart';

/// Cuerpo del POS: catálogo + pedido, en columnas según el ancho.
///
/// Devuelve solo el cuerpo; el `Scaffold` y los atajos son de `PosPage`.
class PosWorkspace extends ConsumerStatefulWidget {
  const PosWorkspace({
    required this.searchFocusNode,
    required this.layout,
    this.onCharge,
    this.onNewOrder,
    this.mobileTab = PosMobileTab.catalog,
    this.onMobileTabChanged,
    super.key,
  });

  final FocusNode searchFocusNode;
  final PosLayout layout;

  /// Abre el diálogo de cobro. `null` cuando la pantalla no lo conecta.
  final VoidCallback? onCharge;

  /// Vacía el pedido (`F2`). `null` si la pantalla no lo conecta.
  final VoidCallback? onNewOrder;

  final PosMobileTab mobileTab;
  final ValueChanged<PosMobileTab>? onMobileTabChanged;

  @override
  ConsumerState<PosWorkspace> createState() => _PosWorkspaceState();
}

class _PosWorkspaceState extends ConsumerState<PosWorkspace> {
  @override
  void initState() {
    super.initState();
    // Tras cada alta de producto, el foco vuelve al buscador. El foco INICIAL lo
    // pide `PosPage`, no este widget: hacerlo aquí con `initState` no funcionaría
    // porque el nodo todavía no está montado.
    final VoidCallback refocus = () => widget.searchFocusNode.requestFocus();
    final void Function() restore = registerPosSearchRefocus(refocus);
    // Sin `unregister` perdería la referencia global; `dispose` la devuelve.
    _restoreRefocus = restore;
  }

  void Function()? _restoreRefocus;

  @override
  void dispose() {
    _restoreRefocus?.call();
    _restoreRefocus = null;
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: <Widget>[
        // La franja va por encima de las DOS disposiciones y no dentro de la
        // columna del catálogo: el aviso sirve justamente cuando se está en la
        // pestaña de cobro, que es donde el cajero tiene que saber que no podrá
        // cobrar todavía.
        const PosOfflineBanner(),
        Expanded(
          child: widget.layout.usesTabs
              ? _compactLayout(context)
              : _columnsLayout(context),
        ),
      ],
    );
  }

  /// Móvil y tablet pequeña: una columna y pestañas explícitas.
  ///
  /// NO se usa un `Row` de tres columnas estrechas: en 420 dp el catálogo
  /// tendría 140 dp por celda y el texto no cabría. Las pestañas además liberan
  /// el pulgar para el botón de cobrar, que es lo que más se pulsa.
  Widget _compactLayout(BuildContext context) {
    return Column(
      children: <Widget>[
        PosMobileTabBar(
          current: widget.mobileTab,
          onChanged: (PosMobileTab tab) =>
              widget.onMobileTabChanged?.call(tab),
        ),
        const Divider(height: 1),
        Expanded(
          child: switch (widget.mobileTab) {
            PosMobileTab.catalog => _catalog(ref: ref, compact: true),
            PosMobileTab.order => _orderPanel(),
            PosMobileTab.charge => _chargePanel(),
          },
        ),
      ],
    );
  }

  /// Dos o tres columnas, con anchos FIJOS por columna.
  Widget _columnsLayout(BuildContext context) {
    final PosLayout layout = widget.layout;
    final double gutter = layout.gutter;
    final double checkoutWidth = layout.checkoutColumnWidth;

    return Row(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        // Columna izquierda: buscador + categorías + rejilla.
        Expanded(flex: 5, child: _catalog(ref: ref, compact: false)),
        SizedBox(width: gutter),
        // Columna central: el pedido en curso.
        SizedBox(
          width: layout.orderColumnWidth,
          child: _orderPanel(),
        ),
        if (checkoutWidth > 0) ...<Widget>[
          SizedBox(width: gutter),
          // Columna derecha: cobro. Fija, porque es la que el cajero mira
          // mientras cobra y no debe desplazarse con el catálogo.
          SizedBox(width: checkoutWidth, child: _chargePanel()),
        ],
      ],
    );
  }

  /// Columna del catálogo con su estado completo (loading/error/vacío).
  Widget _catalog({required WidgetRef ref, required bool compact}) {
    final AsyncValue<PosCatalog> catalog = ref.watch(posCatalogProvider);
    final PosLayout layout = widget.layout;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Padding(
          padding: const EdgeInsets.fromLTRB(
            AppSpacing.md,
            AppSpacing.md,
            AppSpacing.md,
            AppSpacing.sm,
          ),
          child: PosSearchField(focusNode: widget.searchFocusNode),
        ),
        PosCategoryBar(showAllLabel: !compact),
        const Divider(height: 1),
        Expanded(
          child: AsyncStateBuilder<PosCatalog>(
            value: catalog,
            loadingMessage: 'Cargando el catálogo…',
            onRetry: () async => ref.invalidate(posCatalogProvider),
            // Copy propio en vez del de `OfflineState`: el mostrador NO encola
            // pedidos ni reintenta solo, así que no puede decir «se actualizarán
            // solos cuando vuelvas». Dice lo único cierto: sin catálogo no se
            // puede cobrar.
            offlineTitle: 'Sin conexión',
            offlineMessage: 'No se puede leer el catálogo sin red. Cuando la '
                'conexión vuelva, vuelve a cargarlo para poder cobrar.',
            isEmpty: (PosCatalog data) => data.items.isEmpty,
            emptyIcon: Icons.local_cafe_outlined,
            emptyTitle: 'El catálogo está vacío',
            emptyMessage:
                'Crea productos desde Administración · Productos para poder vender.',
            builder: (BuildContext context, PosCatalog data) =>
                PosProductGrid(
              minTileWidth: layout.productTileMinWidth,
            ),
          ),
        ),
      ],
    );
  }

  Widget _orderPanel() => const PosOrderPanel();

  Widget _chargePanel() {
    if (widget.onCharge == null) {
      return const Center(
        child: Text('Cobro no disponible en esta vista'),
      );
    }
    return PosCheckoutPanel(
      onCharge: widget.onCharge!,
      onNewOrder: widget.onNewOrder ?? () {},
      showShortcutHints: !widget.layout.usesTabs,
    );
  }
}
