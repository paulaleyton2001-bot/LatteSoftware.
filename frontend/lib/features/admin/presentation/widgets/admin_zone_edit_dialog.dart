// Edición de una zona. MÓDULO `features/admin/presentation/widgets`.
//
// ESTO SÍ GUARDA
// Antes este diálogo cerraba sin llamar a la API, que es peor que no ofrecer el
// botón: el gestor editaba el nombre, veía «Guardar» y se iba creyendo que se
// había aplicado, y el nombre no cambiaba hasta que recargaba la página.
//
// EL COLOR SE PIDE EN HEX Y NO SE APLICA COMO FONDO
// `colorHex` es un color elegido por el negocio, y la app no puede garantizar
// contraste AA con el texto que pondría encima. Por eso aquí se edita como texto:
// el plano lo usa como borde y punto, nunca como superficie con texto.
//
// LO QUE NO SE EDITA
// La capacidad se deriva de las sillas de la zona: el backend la marca de solo
// lectura y mandarla da `422` en vez de `400` (BR-CHAIR-005).

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../shared/widgets/ui/app_card.dart';
import '../../../../shared/widgets/ui/app_text_field.dart';
import '../../domain/entities/admin_spaces.dart';
import '../admin_spaces_controller.dart';

/// Diálogo de edición de una zona (`PATCH /zones/:id`).
///
/// ESTO SÍ GUARDA. Antes cerraba sin llamar a la API, que es peor que no tener
/// el botón: el gestor editaba el nombre, veía «Guardar» yACDABA por hecho que se
/// había aplicado, y el nombre no cambiaba hasta que recargaba.
///
/// EL COLOR SE PIDE EN HEX Y NO SE APLICA COMO FONDO
/// `colorHex` es un color elegido por el negocio, y la app no puede garantizar
/// contraste AA con el texto que pondría encima. Por eso aquí solo se edita como
/// texto: el plano lo usa como borde y punto, nunca como superficie con texto.
///
/// LO QUE NO SE EDITA
/// La capacidad (${widget.zone.capacity} sillas) se deriva de las sillas de la zona: el
/// backend la marca de solo lectura y mandarla da `422` (BR-CHAIR-005).
class AdminZoneEditDialog extends ConsumerStatefulWidget {
  const AdminZoneEditDialog({required this.zone, super.key});

  final AdminZone zone;

  static Future<void> show(BuildContext context, AdminZone zone) => showDialog<void>(
        context: context,
        builder: (BuildContext dialogContext) => AdminZoneEditDialog(zone: zone),
      );

  @override
  ConsumerState<AdminZoneEditDialog> createState() => _AdminZoneEditDialogState();
}

class _AdminZoneEditDialogState extends ConsumerState<AdminZoneEditDialog> {
  late final TextEditingController _name =
      TextEditingController(text: widget.zone.name);
  late final TextEditingController _code =
      TextEditingController(text: widget.zone.code ?? '');
  late final TextEditingController _color =
      TextEditingController(text: widget.zone.colorHex ?? '');
  late bool _isActive = widget.zone.isActive;
  String? _localError;

  @override
  void dispose() {
    _name.dispose();
    _code.dispose();
    _color.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() => _localError = null);
    final String name = _name.text.trim();
    if (name.isEmpty) {
      setState(() => _localError = 'El nombre no puede quedar vacío.');
      return;
    }
    final String color = _color.text.trim();
    if (color.isNotEmpty && !RegExp(r'^#[0-9A-Fa-f]{6}$').hasMatch(color)) {
      setState(() => _localError =
          'El color va en hexadecimal de 6 dígitos, como #6B7280.');
      return;
    }

    final bool ok = await ref.read(adminZoneEditProvider(widget.zone.id).notifier).save(
          name: name,
          code: _code.text,
          colorHex: color.isEmpty ? null : color,
          isActive: _isActive,
        );
    if (!mounted) return;
    if (ok) {
      Navigator.of(context).pop();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Zona ${widget.zone.name} actualizada.'),
          behavior: SnackBarBehavior.floating,
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<void> busy = ref.watch(adminZoneEditProvider(widget.zone.id));
    final AdminZoneEditController controller =
        ref.read(adminZoneEditProvider(widget.zone.id).notifier);
    final String? general = controller.generalError;

    return AlertDialog(
      title: Text('Editar ${widget.zone.name}'),
      content: SizedBox(
        width: 380,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              AppTextField(
                controller: _name,
                label: 'Nombre',
                maxLength: 100,
                autofocus: true,
                enabled: !busy.isLoading,
                errorText: controller.errorFor('name') ?? _localError,
              ),
              const SizedBox(height: AppSpacing.md),
              AppTextField(
                controller: _code,
                label: 'Código',
                hint: 'TERRAZA',
                helperText: '2-8 caracteres, mayúsculas y números. Único en el negocio.',
                maxLength: 8,
                enabled: !busy.isLoading,
                errorText: controller.errorFor('code'),
              ),
              const SizedBox(height: AppSpacing.md),
              AppTextField(
                controller: _color,
                label: 'Color (hexadecimal)',
                hint: '#6B7280',
                helperText: 'Opcional. Solo se usa como borde en el plano.',
                enabled: !busy.isLoading,
                errorText: controller.errorFor('colorHex'),
              ),
              const SizedBox(height: AppSpacing.md),
              SwitchListTile.adaptive(
                value: _isActive,
                onChanged: busy.isLoading
                    ? null
                    : (bool value) => setState(() => _isActive = value),
                title: const Text('Zona activa'),
                subtitle: Text(
                  'Desactivarla la esconde de la reservas del mostrador.',
                  style: AppTextStyles.captionSmall
                      .copyWith(color: context.tokens.textSecondary),
                ),
                contentPadding: EdgeInsets.zero,
              ),
              AppCard(
                variant: AppCardVariant.flat,
                padding: const EdgeInsets.all(AppSpacing.md),
                child: Text(
                  'La capacidad (${widget.zone.capacity} sillas) se calcula de '
                  'las sillas: no se edita a mano.',
                  style: AppTextStyles.captionSmall
                      .copyWith(color: context.tokens.textTertiary),
                ),
              ),
              if (general != null) ...<Widget>[
                const SizedBox(height: AppSpacing.sm),
                Text(
                  general,
                  style: AppTextStyles.captionSmall
                      .copyWith(color: context.tokens.textError),
                ),
              ],
            ],
          ),
        ),
      ),
      actions: <Widget>[
        TextButton(
          onPressed: busy.isLoading ? null : () => Navigator.of(context).pop(),
          child: const Text('Cancelar'),
        ),
        FilledButton(
          onPressed: busy.isLoading ? null : _save,
          child: busy.isLoading
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Text('Guardar'),
        ),
      ],
    );
  }
}
