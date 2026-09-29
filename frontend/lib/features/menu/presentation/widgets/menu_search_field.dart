// Buscador del menú.
//
// DEBOUNCE: vive en `menuFilterProvider` (300 ms), NO aquí. Este widget solo
// pinta el valor y avisa de cada pulsación; el temporizador es estado de
// pantalla, no de widget, para que sobreviva a un `rebuild` del árbol y se
// cancele solo cuando el provider se destruye.
//
// ACCESIBILIDAD: el campo tiene etiqueta oculta (`semanticLabel`) además del
// hint, e `AppTextField` ya expone el texto como `textField` de Semantics. El
// botón de limpiar es un icono: lleva `tooltip` y `Semantics(button:)` con
// nombre propio, porque "icono" no le sirve de nada a un lector de pantalla.


import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../shared/constants/app_strings.dart';
import '../../../../shared/widgets/ui/app_text_field.dart';
import '../menu_controller.dart';

/// Campo de búsqueda del catálogo.
class MenuSearchField extends ConsumerStatefulWidget {
  const MenuSearchField({this.autofocus = false, super.key});

  final bool autofocus;

  @override
  ConsumerState<MenuSearchField> createState() => _MenuSearchFieldState();
}

class _MenuSearchFieldState extends ConsumerState<MenuSearchField> {
  final TextEditingController _controller = TextEditingController();

  @override
  void dispose() {
    // El controller se libera aquí y no en un provider: es un recurso del
    // widget, y el provider no sabe de `TextEditingController`.
    _controller.dispose();
    super.dispose();
  }

  void _onChanged(String value) {
    // Publicación inmediata al escribir (el debounce lo aplica el provider) y
    // sincronización del campo con el estado, para que "volver atrás" en el
    // router no deje texto huérfano.
    ref.read(menuFilterProvider.notifier).search(value);
    _controller.text = value;
    _controller.selection = TextSelection.collapsed(offset: value.length);
  }

  void _clear() {
    _controller.clear();
    // Limpiar es instantáneo: pasar por el debounce se sentiría lento.
    ref.read(menuFilterProvider.notifier).search('', immediate: true);
  }

  @override
  Widget build(BuildContext context) {
    final String query = ref.watch(menuFilterProvider).query;

    return Row(
      children: <Widget>[
        Expanded(
          child: AppTextField(
            controller: _controller,
            label: 'Buscar en el menú',
            hint: AppStrings.searchHint,
            prefixIcon: Icons.search_rounded,
            textInputAction: TextInputAction.search,
            autofocus: widget.autofocus,
            onChanged: _onChanged,
            semanticLabel: 'Buscar productos del menú por nombre',
            suffix: query.isEmpty
                ? null
                : Semantics(
                    button: true,
                    label: 'Borrar la búsqueda',
                    child: IconButton(
                      onPressed: _clear,
                      icon: const Icon(Icons.close_rounded, size: 20),
                      tooltip: 'Borrar la búsqueda',
                    ),
                  ),
          ),
        ),
        if (query.isNotEmpty) ...<Widget>[
          const SizedBox(width: AppSpacing.sm),
          // Contador de coincidencias, también leído por el lector de pantalla
          // (`liveRegion`): cambia con cada letra y el usuario debe oírlo.
          Semantics(
            liveRegion: true,
            label: 'Resultados de la búsqueda',
            excludeSemantics: true,
            child: Text(
              _hitsLabel(ref.watch(menuSelectionProvider).total),
              style: AppTextStyles.labelMedium.copyWith(
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
            ),
          ),
        ],
      ],
    );
  }

  /// `12 resultados` / `1 resultado` / `sin resultados`.
  static String _hitsLabel(int total) {
    if (total == 0) return 'Sin resultados';
    if (total == 1) return '1 resultado';
    return '$total resultados';
  }
}
