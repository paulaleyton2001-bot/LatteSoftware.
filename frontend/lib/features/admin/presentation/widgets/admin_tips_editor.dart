// Propinas sugeridas del negocio. MÓDULO `features/admin/presentation/widgets`.
//
// POR QUÉ UN STATEFUL CON CONTROLADORES PROPIOS
// La primera versión construía un `TextEditingController` dentro de `build`. Eso
// crea un controlador nuevo en cada pulsación de tecla, sin `dispose`, y el
// cursor salta al principio mientras se escribe: el síntoma classico de un
// `TextField` alimentado con un controlador que se reconstruye. Los controladores
// viven aquí, se crean una vez y se liberan en `dispose`.
//
// LA UNIDAD QUE VE EL USUARIO NO ES LA QUE SE GUARDA
// Se escribe "15" y se guarda `"1500"`. El backend quiere basis points en TEXTO
// (`string[]`, persistido como CSV) y el dueño del negocio piensa en
// porcentajes; convertir en el envío y no en el campo evita las dos unidades
// conviviendo en pantalla.
//
// EL MÁXIMO ES DEL ESQUEMA, NO UNA DECISIÓN DE UI
// `defaultTipsBp` acepta `.max(10)`. El botón se deshabilita al llegar a diez
// porque un 400 por undécima propina no le dice al gestor qué hacer.

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../shared/widgets/ui/app_button.dart';
import '../../../../shared/widgets/ui/app_card.dart';
import '../../../../shared/widgets/ui/app_text_field.dart';

/// Editor de propinas sugeridas.
class AdminTipsEditor extends StatefulWidget {
  const AdminTipsEditor({
    required this.tips,
    required this.onChanged,
    super.key,
  });

  /// Porcentajes, ya normalizados con punto decimal.
  final List<String> tips;

  final ValueChanged<List<String>> onChanged;

  /// Máximo del esquema: `defaultTipsBp` es `.max(10)`.
  static const int maxTips = 10;

  @override
  State<AdminTipsEditor> createState() => _AdminTipsEditorState();
}

class _AdminTipsEditorState extends State<AdminTipsEditor> {
  /// Un controlador por fila, en el mismo orden que la lista.
  ///
  /// Se crean en `initState` y se reindexan en [_sync] cuando se añade o quita
  /// una fila. Se liberan TODOS en `dispose`: un `TextEditingController` sin
  /// liberar retiene el `TextField` y Flutter avisa por consola.
  late List<TextEditingController> _controllers = <TextEditingController>[];

  @override
  void initState() {
    super.initState();
    _rebuildControllers(widget.tips);
  }

  @override
  void didUpdateWidget(AdminTipsEditor oldWidget) {
    super.didUpdateWidget(oldWidget);
    // Si la lista cambió de largo (alta o baja desde fuera), los controladores
    // tienen que seguirle el paso. Sin esto, quitar la segunda fila dejaba el
    // tercer controlador apuntando a un campo que ya no existe.
    if (oldWidget.tips.length != widget.tips.length) {
      _rebuildControllers(widget.tips);
    }
  }

  @override
  void dispose() {
    for (final TextEditingController controller in _controllers) {
      controller.dispose();
    }
    super.dispose();
  }

  void _rebuildControllers(List<String> tips) {
    for (final TextEditingController controller in _controllers) {
      controller.dispose();
    }
    _controllers = <TextEditingController>[
      for (final String tip in tips) TextEditingController(text: tip),
    ];
  }

  void _edit(int index, String value) {
    final List<String> next = <String>[...widget.tips];
    next[index] = value.replaceAll(',', '.');
    widget.onChanged(next);
  }

  void _remove(int index) {
    final List<String> next = <String>[
      for (int i = 0; i < widget.tips.length; i++)
        if (i != index) widget.tips[i],
    ];
    widget.onChanged(next);
    setState(() => _rebuildControllers(next));
  }

  void _add() {
    final List<String> next = <String>[...widget.tips, '10'];
    widget.onChanged(next);
    setState(() => _rebuildControllers(next));
  }

  @override
  Widget build(BuildContext context) {
    // Con la lista vacía se muestra una fila en blanco: un editor sin filas es
    // indistinguible de uno roto.
    final List<String> values =
        widget.tips.isEmpty ? const <String>[''] : widget.tips;

    return AppCard(
      variant: AppCardVariant.flat,
      padding: const EdgeInsets.all(AppSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Semantics(
            header: true,
            child: Text('Propinas sugeridas', style: AppTextStyles.labelLarge),
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            'Se ofrecen como atajos en el cobro. Entre 1 y '
            '${AdminTipsEditor.maxTips} valores.',
            style: AppTextStyles.captionSmall
                .copyWith(color: context.tokens.textSecondary),
          ),
          const SizedBox(height: AppSpacing.sm),
          for (int i = 0; i < values.length; i++)
            Padding(
              padding: const EdgeInsets.only(bottom: AppSpacing.sm),
              child: Row(
                children: <Widget>[
                  Expanded(
                    child: AppTextField(
                      key: ValueKey<String>('propina-$i'),
                      controller: _controllerAt(i),
                      label: 'Propina ${i + 1}',
                      suffix: const Text('%'),
                      // `AppTextField` llama a este parámetro `textInputType`
                      // porque `keyboardType` en Flutter es el tipo de teclado y
                      // el del design system es el del campo.
                      textInputType:
                          const TextInputType.numberWithOptions(decimal: true),
                      inputFormatters: <TextInputFormatter>[
                        FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]')),
                      ],
                      onChanged: (String value) => _edit(i, value),
                    ),
                  ),
                  const SizedBox(width: AppSpacing.sm),
                  // El `tooltip` de `IconButton` ya aporta la etiqueta al lector
                  // de pantalla; `IconButton` no admite `semanticLabel`.
                  IconButton(
                    onPressed: values.length <= 1 ? null : () => _remove(i),
                    icon: const Icon(Icons.close_rounded, size: 18),
                    tooltip: 'Quitar la propina ${i + 1}',
                    constraints:
                        const BoxConstraints(minWidth: 44, minHeight: 44),
                  ),
                ],
              ),
            ),
          AppButton(
            label: 'Añadir propina',
            icon: Icons.add_rounded,
            variant: AppButtonVariant.secondary,
            size: AppButtonSize.small,
            isFullWidth: true,
            onPressed: values.length >= AdminTipsEditor.maxTips
                ? null
                : _add,
            tooltip: values.length >= AdminTipsEditor.maxTips
                ? 'El máximo son ${AdminTipsEditor.maxTips} propinas'
                : null,
          ),
        ],
      ),
    );
  }

  /// El controlador de la fila [index], creando el que falte.
  ///
  /// La lista de valores puede ser más larga que la de controladores cuando el
  /// padre aún no ha rebuildado; en ese caso se crea bajo demanda en vez de
  /// leer fuera de rango.
  TextEditingController _controllerAt(int index) {
    while (_controllers.length <= index) {
      _controllers.add(TextEditingController());
    }
    return _controllers[index];
  }
}
