// Acciones de la tarjeta del tablero. MÓDULO `pos/presentation/widgets`.
//
// EL BOTÓN DE AVANCE DICE A QUÉ ESTADO LLEVA, EN TEXTO
// "Confirmar", "Empezar preparación", "Entregar". Un `>` a secas obliga a recordar
// la máquina de estados mirando la cabecera de la columna, y con el pulgar lleno no
// se lee nada. Además el `Semantics` nombra el estado de destino completo, que es lo
// que lee el lector de pantalla.
//
// LA TARJETA NO ES ARRASTRABLE
// El enunciado pide "arrastrables o al menos un botón de avance rápido". Se elige el
// botón porque soltar en la columna equivocada mueve un pedido que ya estaba listo,
// y en una cocina eso no se deshace. `Draggable` queda para cuando haya tablet con
// stylus.

import 'package:flutter/material.dart';
import '../../../../app/theme/app_typography.dart';

/// Botón de avance rápido. Dice a qué estado lleva, en texto.
class PosBoardAdvanceButton extends StatelessWidget {
  const PosBoardAdvanceButton({
    required this.nextStatus,
    required this.isBusy,
    required this.onTap,
  });

  final String nextStatus;
  final bool isBusy;
  final VoidCallback? onTap;

  /// Etiqueta legible del destino, para el botón y para el lector de pantalla.
  static String labelOf(String status) => switch (status) {
        'PENDING' => 'Marcar pendiente',
        'CONFIRMED' => 'Confirmar',
        'PREPARING' => 'Empezar preparación',
        'READY' => 'Marcar listo',
        'COMPLETED' => 'Entregar',
        'CANCELLED' => 'Cancelado',
        _ => 'Sin acción',
      };

  @override
  Widget build(BuildContext context) {
    final bool enabled = onTap != null;
    return Semantics(
      button: true,
      enabled: enabled,
      label: enabled
          ? '${labelOf(nextStatus)} · pasar a ${kPosOrderStatusLabels[nextStatus] ?? nextStatus}'
          : 'Este pedido no tiene acción disponible',
      excludeSemantics: true,
      child: Tooltip(
        message: enabled
            ? 'Pasa a ${kPosOrderStatusLabels[nextStatus] ?? nextStatus}'
            : 'No se puede avanzar más',
        child: SizedBox(
          height: 44,
          child: FilledButton.tonalIcon(
            onPressed: enabled && !isBusy ? onTap : null,
            icon: isBusy
                ? const SizedBox.square(
                    dimension: 14,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.arrow_forward_rounded, size: 16),
            label: Text(
              labelOf(nextStatus),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppTextStyles.labelMedium,
            ),
          ),
        ),
      ),
    );
  }
}

/// Etiquetas legibles de `OrderStatus`, para botones y avisos.
const Map<String, String> kPosOrderStatusLabels = <String, String>{
  'PENDING': 'Pendiente',
  'CONFIRMED': 'Confirmado',
  'PREPARING': 'En preparación',
  'READY': 'Listo',
  'COMPLETED': 'Entregado',
  'CANCELLED': 'Cancelado',
  'REFUNDED': 'Reembolsado',
  'DRAFT': 'Borrador',
  'DELIVERING': 'En camino',
};
