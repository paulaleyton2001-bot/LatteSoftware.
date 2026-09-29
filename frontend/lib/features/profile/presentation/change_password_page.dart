// Cambiar la contraseña (`POST /auth/change-password`).
//
// REGLAS QUE IMPONE EL BACKEND (API.md §7.1)
//   - `currentPassword`, `newPassword` y `confirmPassword` son obligatorios.
//   - Política de contraseña: 8–72 caracteres, al menos una letra y un número.
//   - La nueva no puede ser igual a la actual (`422 PASSWORD_SAME_AS_CURRENT`).
//   - Al cambiar, se revocan TODAS las sesiones menos la actual
//     (`keepCurrentSession`, default `true`). Por eso, tras el cambio, la sesión
//     sigue viva y NO hay que volver a iniciar sesión: la pantalla lo dice para
//     que nadie se asuste.
//
// LOS ERRORES DEL BACKEND SON LOS BUENOS
// "La contraseña nueva no puede ser la misma" o "la actual no coincide" son
// mensajes que solo el backend puede dar con precisión, y llegan en español. Se
// pintan tal cual en `FormErrorBanner` en vez de traducirlos: reescribirlos sería
// inventar reglas que el servidor puede cambiar.



import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../app/theme/app_spacing.dart';
import '../../../app/theme/app_tokens.dart';
import '../../../core/di/providers.dart';
import '../../../core/error/failures.dart';
import '../../../core/result/result.dart';
import '../../../core/utils/validators.dart';
import '../../../domain/entities/auth_credentials.dart';
import '../../../domain/entities/auth_result.dart';
import '../../../shared/widgets/ui/app_button.dart';
import '../../../shared/widgets/ui/app_card.dart';
import '../../../shared/widgets/ui/app_text_field.dart';
import '../../../shared/widgets/ui/form_error_banner.dart';
import './profile_controller.dart';

/// Pantalla de cambio de contraseña.
class ChangePasswordPage extends ConsumerStatefulWidget {
  const ChangePasswordPage({super.key});

  @override
  ConsumerState<ChangePasswordPage> createState() => _ChangePasswordPageState();
}

class _ChangePasswordPageState extends ConsumerState<ChangePasswordPage> {
  final TextEditingController _current = TextEditingController();
  final TextEditingController _next = TextEditingController();
  final TextEditingController _confirm = TextEditingController();

  /// El foco del último campo. El foco NO se puede pedir a un
  /// `TextEditingController` (solo a un `FocusNode`), y sin esto el `onSubmitted`
  /// del campo anterior no llevaría al último, que es lo que espera quien teclea.
  final FocusNode _confirmFocus = FocusNode();

  String? _currentError;
  String? _nextError;
  String? _confirmError;

  @override
  void dispose() {
    _current.dispose();
    _next.dispose();
    _confirm.dispose();
    _confirmFocus.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final String current = _current.text;
    final String next = _next.text;
    final String? currentError = Validators.currentPassword(current);
    final String? nextError = Validators.password(next);
    final String? confirmError =
        nextError == null ? Validators.passwordConfirmation(_confirm.text, next) : null;

    setState(() {
      _currentError = currentError;
      _nextError = nextError;
      _confirmError = confirmError;
    });
    if (currentError != null || nextError != null || confirmError != null) return;

    final bool ok = await ref.read(profileActionProvider.notifier).run(() async {
      final Result<AuthResult> result =
          await ref.read(authRepositoryProvider).changePassword(
                ChangePasswordRequest(
                  currentPassword: current,
                  newPassword: next,
                  confirmPassword: _confirm.text,
                ),
              );
      // El callback de `ProfileActionController.run` declara
      // `Future<Result<String>>`: hay que devolver el MISMO tipo en las dos ramas.
      // Devolver el `Failure` a pelo daba `Object` y rompía el `switch`.
      return switch (result) {
        Success<AuthResult>(:final AuthResult value) =>
          Success<String>(value.message),
        FailureResult<AuthResult>(:final Failure failure) =>
          FailureResult<String>(failure),
      };
    });

    if (!mounted) return;
    if (ok) {
      final String message =
          ref.read(profileActionProvider).message ?? 'Contraseña actualizada.';
      // Se vacían los campos: la contraseña antigua ya no sirve para nada y
      // dejarlo en memoria es un riesgo innecesario.
      _current.clear();
      _next.clear();
      _confirm.clear();
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
      ref.read(profileActionProvider.notifier).reset();
      if (mounted) context.pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    final ProfileAction action = ref.watch(profileActionProvider);
    final bool busy = action.isBusy;

    return Scaffold(
      appBar: AppBar(title: const Text('Cambiar contraseña')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(AppSpacing.lg),
          children: <Widget>[
            if (action.failure != null) ...<Widget>[
              FormErrorBanner(
                failure: action.failure!,
                onRetry: action.failure!.isRetryable ? _submit : null,
              ),
              const SizedBox(height: AppSpacing.lg),
            ],
            AppCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  AppTextField(
                    controller: _current,
                    label: 'Contraseña actual',
                    prefixIcon: Icons.lock_rounded,
                    obscureToggle: true,
                    textInputAction: TextInputAction.next,
                    enabled: !busy,
                    errorText: _currentError,
                    onChanged: (_) => _clear(_currentError, () => _currentError = null),
                    semanticLabel: 'Tu contraseña actual',
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  AppTextField(
                    controller: _next,
                    label: 'Contraseña nueva',
                    helperText: 'Mínimo 8 caracteres, con una letra y un número.',
                    prefixIcon: Icons.lock_outline_rounded,
                    obscureToggle: true,
                    textInputAction: TextInputAction.next,
                    enabled: !busy,
                    errorText: _nextError,
                    onChanged: (_) => _clear(_nextError, () => _nextError = null),
                    onSubmitted: (_) => _confirmFocus.requestFocus(),
                    semanticLabel: 'Contraseña nueva',
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  AppTextField(
                    controller: _confirm,
                    focusNode: _confirmFocus,
                    label: 'Repite la contraseña nueva',
                    prefixIcon: Icons.lock_reset_rounded,
                    obscureToggle: true,
                    textInputAction: TextInputAction.done,
                    enabled: !busy,
                    errorText: _confirmError,
                    onChanged: (_) => _clear(_confirmError, () => _confirmError = null),
                    onSubmitted: (_) => _submit(),
                    semanticLabel: 'Repite la contraseña nueva',
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  AppButton(
                    label: 'Cambiar contraseña',
                    icon: Icons.lock_reset_rounded,
                    size: AppButtonSize.large,
                    isFullWidth: true,
                    isLoading: busy,
                    onPressed: busy ? null : _submit,
                  ),
                ],
              ),
            ),
            const SizedBox(height: AppSpacing.lg),
            _Notice(
              icon: Icons.devices_rounded,
              text: 'Al cambiarla se cerrarán tus otras sesiones (en el móvil y '
                  'en el ordenador). En este dispositivo seguirás dentro.',
            ),
            const SizedBox(height: AppSpacing.sm),
            _Notice(
              icon: Icons.info_outline_rounded,
              text: 'Si no recuerdas la actual, usa "olvidé mi contraseña" desde '
                  'la pantalla de acceso.',
            ),
          ],
        ),
      ),
    );
  }

  void _clear(String? current, VoidCallback apply) {
    if (current == null) return;
    setState(apply);
  }
}

/// Aviso informativo con ícono + texto.
class _Notice extends StatelessWidget {
  const _Notice({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: context.tokens.surfaceMuted,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(icon, size: 18, color: context.tokens.textSecondary),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Text(
              text,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: context.tokens.textSecondary,
                  ),
            ),
          ),
        ],
      ),
    );
  }
}
