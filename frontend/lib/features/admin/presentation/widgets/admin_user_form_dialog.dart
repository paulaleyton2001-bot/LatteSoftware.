// Alta de usuario del equipo. MÓDULO `admin/presentation/widgets`.
//
// POR QUÉ ES UN DIÁLOGO Y NO UNA PÁGINA
// El alta son cinco campos y no se navega a ella: se abre sobre el listado y se
// cierra al guardar o cancelar. Una ruta nueva obligaría a un `pop` con
// resultado y a un estado de "volviendo" en el listado para un formulario que cabe
// en un diálogo.
//
// POR QUÉ NO USA `Form` + `validator`
// [AppTextField] no es un `FormField`: expone `errorText` y lo gestiona la propia
// pantalla. Envolverlo en un `Form` dejaría los errores en dos sitios a la vez,
// y el `validator` nunca se ejecutaría. Aquí se valida a mano y el resultado se
// pinta en el `errorText` del campo, que es lo que el widget sabe mostrar.
//
// LA CONTRASEÑA ES OPCIONAL Y SOLO SE MUESTRA UNA VEZ
// Si el admin no escribe ninguna, el backend genera una temporal y la devuelve en
// `meta.temporaryPassword`. Esa ventana es la ÚNICA: si el diálogo se cierra sin
// mostrarla, hay que resetear. Por eso el resultado del alta lleva la temporal
// unida y se enseña en un diálogo aparte que no se descarta con un toque.

import 'package:flutter/material.dart';

import '../../../../app/theme/app_radii.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../shared/widgets/ui/app_text_field.dart';
import '../admin_users_controller.dart';

/// Datos del formulario de alta, ya validados por la UI.
class AdminUserDraft {
  const AdminUserDraft({
    required this.fullName,
    required this.email,
    required this.password,
    required this.roles,
  });

  final String fullName;
  final String email;
  final String password;
  final List<AdminRole> roles;
}

/// Formulario de alta. Devuelve el [AdminUserDraft], o `null` si se cancela.
///
/// El `password` vacío significa "que la genere el backend": no se manda la clave
/// en ese caso, porque el esquema la marca opcional y una cadena vacía es un 400.
class AdminUserFormDialog extends StatefulWidget {
  const AdminUserFormDialog({required this.roles, super.key});

  final List<AdminRole> roles;

  static Future<AdminUserDraft?> show(
    BuildContext context,
    List<AdminRole> roles,
  ) =>
      showDialog<AdminUserDraft>(
        context: context,
        barrierDismissible: false,
        builder: (BuildContext dialogContext) =>
            AdminUserFormDialog(roles: roles),
      );

  @override
  State<AdminUserFormDialog> createState() => _AdminUserFormDialogState();
}

class _AdminUserFormDialogState extends State<AdminUserFormDialog> {
  late final TextEditingController _name = TextEditingController();
  late final TextEditingController _email = TextEditingController();
  late final TextEditingController _password = TextEditingController();
  final Set<int> _selected = <int>{};
  final Map<String, String> _errors = <String, String>{};

  /// Rol sugerido al abrir: el primero que no sea `CUSTOMER`.
  ///
  /// `CUSTOMER` existe en el enum del backend pero no describe a nadie del equipo.
  /// Prefijarlo ahorra un paso sin quitar la opción: si alguien lo quiere, lo elige.
  int get _suggestedRoleId {
    for (final AdminRole role in widget.roles) {
      if (role.name != 'CUSTOMER') return role.id;
    }
    return widget.roles.isEmpty ? 0 : widget.roles.first.id;
  }

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  void _submit() {
    setState(_errors.clear);
    final String fullName = _name.text.trim();
    final String email = _email.text.trim();

    if (fullName.length < 2) {
      _errors['name'] = 'El backend exige al menos 2 caracteres.';
    }
    if (email.isEmpty) {
      _errors['email'] = 'El correo es obligatorio.';
    } else if (!email.contains('@') || !email.contains('.')) {
      // Deliberadamente laxo: el backend valida el formato real, y una regexp
      // aquí rechazaría direcciones válidas que la app no conoce.
      _errors['email'] = 'Revisa el correo.';
    }
    if (_selected.isEmpty) {
      _errors['roles'] = 'Elige al menos un rol: el backend no acepta un alta sin él.';
    }
    if (_errors.isNotEmpty) {
      setState(() {});
      return;
    }

    Navigator.of(context).pop(
      AdminUserDraft(
        fullName: fullName,
        email: email,
        password: _password.text,
        roles: <AdminRole>[
          for (final AdminRole role in widget.roles)
            if (_selected.contains(role.id)) role,
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    // Se preselecciona un rol para que el botón no arranque bloqueado sin
    // explicación; el admin puede desmarcarlo.
    if (_selected.isEmpty && widget.roles.isNotEmpty) {
      _selected.add(_suggestedRoleId);
    }

    return AlertDialog(
      title: const Text('Crear usuario'),
      content: SizedBox(
        width: 420,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              AppTextField(
                controller: _name,
                label: 'Nombre completo',
                maxLength: 120,
                autofocus: true,
                textCapitalization: TextCapitalization.words,
                errorText: _errors['name'],
              ),
              const SizedBox(height: AppSpacing.md),
              AppTextField(
                controller: _email,
                label: 'Correo',
                textInputType: TextInputType.emailAddress,
                errorText: _errors['email'],
              ),
              const SizedBox(height: AppSpacing.md),
              AppTextField(
                controller: _password,
                label: 'Contraseña (opcional)',
                obscureToggle: true,
                helperText: 'Si la dejas vacía, se genera una temporal.',
              ),
              const SizedBox(height: AppSpacing.md),
              _RoleSelector(
                roles: widget.roles,
                selected: _selected,
                errorText: _errors['roles'],
                onToggle: (AdminRole role) => setState(() {
                  if (!_selected.remove(role.id)) _selected.add(role.id);
                }),
              ),
              const SizedBox(height: AppSpacing.md),
              Text(
                'Al guardar, el usuario queda activo y con los roles marcados. '
                'La contraseña temporal, si se genera, se muestra una sola vez.',
                style: AppTextStyles.captionSmall
                    .copyWith(color: context.tokens.textTertiary),
              ),
            ],
          ),
        ),
      ),
      actions: <Widget>[
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancelar'),
        ),
        FilledButton(
          onPressed: _submit,
          child: const Text('Crear'),
        ),
      ],
    );
  }
}

/// Fila de roles. Cada opción es un `FilterChip` con `Semantics(selected:)`.
class _RoleSelector extends StatelessWidget {
  const _RoleSelector({
    required this.roles,
    required this.selected,
    required this.onToggle,
    this.errorText,
  });

  final List<AdminRole> roles;
  final Set<int> selected;
  final ValueChanged<AdminRole> onToggle;
  final String? errorText;

  @override
  Widget build(BuildContext context) {
    if (roles.isEmpty) {
      return Container(
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
          color: context.tokens.surfaceMuted,
          borderRadius: BorderRadius.circular(AppRadii.md),
        ),
        child: Text(
          'No se pudieron cargar los roles. Recarga la página antes de dar de alta '
          'a alguien: el backend no acepta un usuario sin rol.',
          style: AppTextStyles.bodySmall
              .copyWith(color: context.tokens.textSecondary),
        ),
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Semantics(
          header: true,
          child: Text('Roles', style: AppTextStyles.labelLarge),
        ),
        const SizedBox(height: AppSpacing.xs),
        Wrap(
          spacing: AppSpacing.sm,
          runSpacing: AppSpacing.xs,
          children: <Widget>[
            for (final AdminRole role in roles)
              Semantics(
                label: role.displayLabel,
                selected: selected.contains(role.id),
                excludeSemantics: true,
                child: FilterChip(
                  label: Text(role.displayLabel),
                  selected: selected.contains(role.id),
                  onSelected: (bool _) => onToggle(role),
                ),
              ),
          ],
        ),
        if (errorText != null) ...<Widget>[
          const SizedBox(height: AppSpacing.xs),
          Text(
            errorText!,
            style: AppTextStyles.captionSmall
                .copyWith(color: context.tokens.textError),
          ),
        ],
      ],
    );
  }
}
