// Aviso de sin conexión del POS. MÓDULO `pos/presentation/widgets`.
//
// POR QUÉ ESTO Y NO EL `OfflineState` DE PANTALLA COMPLETA
// `OfflineState` sustituye la pantalla entera. En el mostrador eso es peor que
// no avisar: el cajero pierde el pedido que está a medio cobrar y puede creer que
// se ha perdido. Aquí el POS SIGUE FUNCIONANDO —el pedido en curso vive en el
// borrador, en memoria— y lo que se añade es una franja arriba que explica qué
// sigue siendo posible y qué no.
//
// LO QUE EL AVISO PROMETE ES LO QUE EL CÓDIGO HACE
// No se dice «se sincronizará sola»: el POS no encola pedidos ni reintenta por su
// cuenta (`NoopSyncEngine` lo deja explícito). Se dice lo único cierto, que es
// que sin red no hay cobro, y se ofrece reintentar la lectura. Un aviso que
// promete sincronización y luego no la hace enseña a ignorar los avisos.
//
// CUANDO SE MUESTRA
// Con CUALQUIER fallo de red de una lectura del POS, y solo mientras dure: en
// cuanto una lectura va bien, el aviso desaparece solo. No hace falta un
// `setState` ni un watcher de conectividad —que además no se puede consultar
// igual en web y en móvil—: el propio estado de la petición es la señal.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/theme/app_spacing.dart';
import '../../../../core/error/failures.dart';
import '../pos_controller.dart';
import 'pos_order_type_selector.dart';

/// Franja de sin conexión. Se inserta en [PosWorkspace] sobre el contenido.
///
/// Devuelve un widget de altura cero cuando no hay fallo, para poder dejarla
/// siempre en el árbol sin condicionales en el llamador.
class PosOfflineBanner extends ConsumerWidget {
  const PosOfflineBanner({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<PosCatalog> catalog = ref.watch(posCatalogProvider);
    if (catalog is! AsyncError) return const SizedBox.shrink();

    // `AsyncError` sigue vigente mientras no se reintente, que es justo lo que
    // se quiere: el aviso persiste hasta que algo cambie de verdad.
    //
    // Se avisa de los DOS fallos de red que produce `error_mapper`: `OfflineFailure`
    // cuando detecta que no hay red, y `NetworkFailure` cuando la petición falla
    // por tiempo o DNS pero no se puede confirmar que sea desconexión. Un 403 o un
    // 500 NO son problema de conexión y su aviso sería engañoso.
    final Object? error = catalog.error;
    final bool isNetworkProblem =
        error is OfflineFailure || error is NetworkFailure;
    if (!isNetworkProblem) return const SizedBox.shrink();

    return Padding(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.md,
        AppSpacing.sm,
        AppSpacing.md,
        0,
      ),
      child: PosInlineNotice(
        icon: Icons.wifi_off_rounded,
        tone: PosNoticeTone.warning,
        text: 'Sin conexión. Puedes seguir armando el pedido, pero el cobro '
            'necesita red: no se guardará hasta que vuelva.',
        action: TextButton(
          onPressed: () => ref.invalidate(posCatalogProvider),
          child: const Text('Reintentar'),
        ),
      ),
    );
  }
}
