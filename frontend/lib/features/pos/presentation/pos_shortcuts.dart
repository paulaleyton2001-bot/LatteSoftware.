// Atajos de teclado del mostrador. MÓDULO `pos/presentation`.
//
// LA REGLA DEL POS
// El cajero tiene las manos ocupadas y el mostrador es un puesto de trabajo, no
// una app: escribir el nombre del producto, cobrar y empezar el siguiente pedido
// no deben costarle un viaje al ratón. Los atajos son:
//   F1   enfocar el buscador del catálogo
//   Enter cobrar (abre el diálogo de pago)
//   F2   nuevo pedido (vacía el borrador)
//   Esc  cerrar el diálogo o el panel abierto
//
// CÓMO FUNCIONAN
// `Shortcuts` + `Actions` sobre el `Focus` del POS. Se usa `SingleActivator` (no
// `CharacterActivator`) para que el atajo no se coma teclas de texto: sin eso,
// escribir "f1" en el buscador de una silla no sería posible.
//
// `Esc` NO se declara aquí: lo gestiona `Navigator.pop` de cada diálogo y de los
// `showModalBottomSheet`, que ya lo hacen bien. Redeclararlo en un `Shortcuts`
// provocaría que `Esc` cerrara el POS entero en lugar del diálogo.
//
// ACCESIBILIDAD
// Un atajo es un acelerador, no la única vía: todo lo que hace `F1` se puede
// hacer con el `Tab` y el `Enter`, y todo lo que hace `Enter` tiene un botón
// visible. Los atajos se MUESTRAN en el panel de cobro (`PosCheckoutPanel`).

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../../shared/constants/app_strings.dart';

/// Callbacks que el POS expone a la capa de atajos.
class PosShortcutActions {
  const PosShortcutActions({
    required this.focusSearch,
    required this.charge,
    required this.newOrder,
  });

  /// Enfoca el buscador del catálogo (`F1`).
  final VoidCallback focusSearch;

  /// Abre el diálogo de cobro (`Enter`).
  final VoidCallback charge;

  /// Empieza un pedido vacío (`F2`).
  final VoidCallback newOrder;
}

/// `Intents` del POS. Sin estado: solo llevan la acción.
class PosSearchIntent extends Intent {
  const PosSearchIntent();
}

class PosChargeIntent extends Intent {
  const PosChargeIntent();
}

class PosNewOrderIntent extends Intent {
  const PosNewOrderIntent();
}

/// Envuelve [child] con los atajos de teclado del POS.
///
/// Hay que colgarlo de un `Focus` con `autofocus` o de un nodo ya enfocado: los
/// atajos de Flutter solo se despachan cuando el árbol tiene el foco. En el POS
/// el foco inicial lo toma el buscador, así que funciona desde el primer frame.
class PosKeyboardShortcuts extends StatelessWidget {
  const PosKeyboardShortcuts({
    required this.actions,
    required this.child,
    super.key,
  });

  final PosShortcutActions actions;
  final Widget child;

  /// El código de `F1` es `LogicalKeyboardKey.f1`; los comandos de una sola tecla
  /// sin modificador no necesitan `SingleActivator` con `control`.
  @override
  Widget build(BuildContext context) {
    return Shortcuts(
      shortcuts: <ShortcutActivator, Intent>{
        const SingleActivator(LogicalKeyboardKey.f1): const PosSearchIntent(),
        const SingleActivator(LogicalKeyboardKey.f2): const PosNewOrderIntent(),
        const SingleActivator(LogicalKeyboardKey.enter):
            const PosChargeIntent(),
        // `numpadEnter` es una tecla DISTINTA de `enter` en el mapa de Flutter, y
        // es la que pulsa un lector de códigos con teclado numérico: sin esto, un
        // datáfono USB emulado no cobraría.
        const SingleActivator(LogicalKeyboardKey.numpadEnter):
            const PosChargeIntent(),
      },
      child: Actions(
        actions: <Type, Action<Intent>>{
          PosSearchIntent: CallbackAction<PosSearchIntent>(
            onInvoke: (PosSearchIntent intent) => actions.focusSearch(),
          ),
          PosChargeIntent: CallbackAction<PosChargeIntent>(
            onInvoke: (PosChargeIntent intent) => actions.charge(),
          ),
          PosNewOrderIntent: CallbackAction<PosNewOrderIntent>(
            onInvoke: (PosNewOrderIntent intent) => actions.newOrder(),
          ),
        },
        child: child,
      ),
    );
  }
}

/// Fila compacta de atajos para las cabeceras estrechas (tableta).
///
/// Es la versión de una línea de `PosCheckoutPanel._ShortcutRow`, para el caso en
/// que el panel de cobro no cabe en pantalla y los atajos se muestran arriba.
class PosShortcutHintBar extends StatelessWidget {
  const PosShortcutHintBar({super.key});

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: AppStrings.shortcutsHint,
      excludeSemantics: true,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        child: Text(
          AppStrings.shortcutsHint,
          textAlign: TextAlign.center,
          style: Theme.of(context)
              .textTheme
              .bodySmall
              ?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant),
        ),
      ),
    );
  }
}
