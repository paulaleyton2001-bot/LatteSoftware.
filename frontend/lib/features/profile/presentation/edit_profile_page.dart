// Editar los datos del perfil (`PATCH /auth/me`).
//
// POR QUÉ ES UN FORMULARIO Y NO UNA EDICIÓN EN LÍNEA
// Son tres campos (nombre, teléfono, foto) y el backend usa zod `.strict()`: si se
// envía un campo vacío, da `400`. Un formulario con validación en línea y un
// `FormErrorBanner` de resultado es más claro que editar en el sitio y descubrir
// el error tres campos después.
//
// EL ERROR NO REEMPLAZA EL FORMULARIO
// Un `ErrorState` a pantalla completa borraría lo que la persona acaba de
// escribir. El error va en banner encima del botón (`FormErrorBanner`), que es
// exactamente para lo que existe ese componente.
//
// AL GUARDAR SE ACTUALIZA EL ESTADO DE SESIÓN
// `AuthController.updateUser` propaga el `User` nuevo a toda la app, así que el
// nombre y los permisos cambian en el sidebar, en el saludo del menú y en las
// guardas del router sin recargar nada.


import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../app/theme/app_spacing.dart';
import '../../../app/theme/app_tokens.dart';
import '../../../app/theme/app_typography.dart';
import '../../../core/di/providers.dart';
import '../../../core/error/failures.dart';
import '../../../core/result/result.dart';
import '../../../core/utils/validators.dart';
import '../../../domain/entities/auth_credentials.dart';
import '../../../domain/entities/user.dart';
import '../../../shared/widgets/ui/app_button.dart';
import '../../../shared/widgets/ui/app_card.dart';
import '../../../shared/widgets/ui/app_text_field.dart';
import '../../../shared/widgets/ui/form_error_banner.dart';
import '../../../shared/widgets/ui/loading_state.dart';
import '../../auth/presentation/auth_controller.dart';
import './profile_controller.dart';

/// Pantalla de edición del perfil.
class EditProfilePage extends ConsumerStatefulWidget {
  const EditProfilePage({super.key});

  @override
  ConsumerState<EditProfilePage> createState() => _EditProfilePageState();
}

class _EditProfilePageState extends ConsumerState<EditProfilePage> {
  final TextEditingController _name = TextEditingController();
  final TextEditingController _phone = TextEditingController();
  final TextEditingController _photo = TextEditingController();

  String? _nameError;
  String? _phoneError;
  String? _photoError;

  bool _initialized = false;

  @override
  void dispose() {
    _name.dispose();
    _phone.dispose();
    _photo.dispose();
    super.dispose();
  }

  /// Rellena los campos con los valores actuales una sola vez. Se hace en
  /// `build` (con un guardia) y no en `initState` porque el usuario puede no estar
  /// resuelto todavía: los controllers se\arían con cadenas vacías y luego
  /// overwrite, y eso borra lo que la persona está escribiendo.
  void _hydrate(User user) {
    if (_initialized) return;
    _initialized = true;
    _name.text = user.fullName ?? '';
    _phone.text = user.phone ?? '';
    _photo.text = user.photoUrl ?? '';
  }

  Future<void> _save(User user) async {
    final String? nameError = Validators.minLength(
      _name.text,
      min: 2,
      field: 'El nombre',
    );
    final String? phoneError = Validators.phoneE164(_phone.text);
    final String? photoError = _photo.text.trim().isEmpty
        ? null
        : (_photo.text.trim().startsWith('http')
            ? null
            : 'La foto debe ser una dirección que empiece por https://');

    setState(() {
      _nameError = nameError;
      _phoneError = phoneError;
      _photoError = photoError;
    });
    if (nameError != null || phoneError != null || photoError != null) return;

    final ProfileActionController actions =
        ref.read(profileActionProvider.notifier);
    final bool ok = await actions.run(() async {
      final Result<User> result = await ref.read(authRepositoryProvider).updateMe(
            UpdateProfileRequest(
              fullName: _name.text.trim(),
              phone: _phone.text.trim().isEmpty ? null : _phone.text.trim(),
              photoUrl: _photo.text.trim().isEmpty ? null : _photo.text.trim(),
            ),
          );
      return switch (result) {
        Success<User>(:final User value) => () {
            // Se propaga a la sesión: el nombre nuevo se ve en toda la app.
            ref.read(authControllerProvider.notifier).updateUser(value);
            return Success<String>('Datos actualizados.');
          }(),
        // El callback declara `Future<Result<String>>`: el fallo también tiene que
        // ir envuelto, o la rama devuelve `Object` y no compila.
        FailureResult<User>(:final Failure failure) =>
          FailureResult<String>(failure),
      };
    });

    if (!ok || !mounted) return;
    final ProfileAction state = ref.read(profileActionProvider);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(state.message ?? 'Datos actualizados.')),
    );
    actions.reset();
    if (mounted) context.pop();
  }

  @override
  Widget build(BuildContext context) {
    final User? user = ref.watch(currentUserProvider);
    final ProfileAction action = ref.watch(profileActionProvider);
    if (user == null) {
      // Sin actor no hay nada que editar: se avisa con la pantalla de carga en
      // vez de un `Text` suelto, para que no haya una vista intermedia vacía.
      return Scaffold(
        appBar: AppBar(title: const Text('Editar perfil')),
        body: const Center(child: AppSpinner(message: 'Cargando tu perfil…')),
      );
    }
    _hydrate(user);

    return Scaffold(
      appBar: AppBar(title: const Text('Editar perfil')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(AppSpacing.lg),
          children: <Widget>[
            if (action.failure != null) ...<Widget>[
              FormErrorBanner(
                failure: action.failure!,
                onRetry: action.failure!.isRetryable ? () => _save(user) : null,
              ),
              const SizedBox(height: AppSpacing.lg),
            ],
            AppCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  AppTextField(
                    controller: _name,
                    label: 'Nombre completo',
                    prefixIcon: Icons.person_outline_rounded,
                    textCapitalization: TextCapitalization.words,
                    textInputAction: TextInputAction.next,
                    enabled: !action.isBusy,
                    errorText: _nameError,
                    onChanged: (_) => _clearName(),
                    semanticLabel: 'Nombre completo',
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  AppTextField(
                    controller: _phone,
                    label: 'Teléfono',
                    helperText: 'Formato internacional: +573001234567',
                    prefixIcon: Icons.phone_rounded,
                    textInputType: TextInputType.phone,
                    textInputAction: TextInputAction.next,
                    enabled: !action.isBusy,
                    errorText: _phoneError,
                    onChanged: (_) => _clearPhone(),
                    semanticLabel: 'Teléfono de contacto',
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  AppTextField(
                    controller: _photo,
                    label: 'Foto de perfil (opcional)',
                    helperText: 'Una dirección de imagen que empiece por https://',
                    prefixIcon: Icons.image_outlined,
                    textInputType: TextInputType.url,
                    textInputAction: TextInputAction.done,
                    enabled: !action.isBusy,
                    errorText: _photoError,
                    onChanged: (_) => _clearPhoto(),
                    onSubmitted: (_) => _save(user),
                    semanticLabel: 'Dirección de la foto de perfil',
                  ),
                  const SizedBox(height: AppSpacing.xs),
                  Text(
                    'El correo no se cambia aquí: necesita verificación.',
                    // `TextTheme` no tiene `captionSmall`: el token vive en
                    // `AppTextStyles` (la escala del design system).
                    style: AppTextStyles.captionSmall
                        .copyWith(color: context.tokens.textTertiary),
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  AppButton(
                    label: 'Guardar cambios',
                    icon: Icons.save_rounded,
                    size: AppButtonSize.large,
                    isFullWidth: true,
                    isLoading: action.isBusy,
                    onPressed: action.isBusy ? null : () => _save(user),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  void _clearName() {
    if (_nameError == null) return;
    setState(() => _nameError = null);
  }

  void _clearPhone() {
    if (_phoneError == null) return;
    setState(() => _phoneError = null);
  }

  void _clearPhoto() {
    if (_photoError == null) return;
    setState(() => _photoError = null);
  }
}
