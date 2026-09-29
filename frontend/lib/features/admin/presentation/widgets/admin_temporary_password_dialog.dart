// Contraseña temporal de un alta. MÓDULO `features/admin/presentation/widgets`.
//
// SEPARADO DEL FORMULARIO POR UNA RAZÓN DE SEGURIDAD
// Va en su propio diálogo porque no se puede descartar con un toque y no tiene
// vuelta atrás: `meta.temporaryPassword` se devuelve UNA sola vez (API.md §7.2).
// Si el diálogo del formulario cerrara con la temporal dentro, un "casi" o un
// toque fuera la habría quemado.
//
// `barrierDismissible: false` y sin acción de cerrar: solo se sale con «Hecho»,
// tras copiar.

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../shared/widgets/ui/app_button.dart';

/// Diálogo de la contraseña temporal. No se cierra sin copiar.
class AdminTemporaryPasswordDialog extends StatelessWidget {
  const AdminTemporaryPasswordDialog({
    required this.fullName,
    required this.email,
    required this.password,
    super.key,
  });

  final String fullName;
  final String email;
  final String password;

  static Future<void> show(
    BuildContext context, {
    required String fullName,
    required String email,
    required String password,
  }) =>
      showDialog<void>(
        context: context,
        barrierDismissible: false,
        builder: (BuildContext dialogContext) => AdminTemporaryPasswordDialog(
          fullName: fullName,
          email: email,
          password: password,
        ),
      );

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      icon:  Icon(Icons.key_rounded, color: context.tokens.brandDark),
      title: const Text('Contraseña temporal'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Text(
            'Esta es la ÚNICA vez que se muestra. Cópiala y entrégasela a '
            '$fullName ($email); si se pierde, hay que resetearla.',
            style: AppTextStyles.bodySmall
                .copyWith(color: context.tokens.textSecondary),
          ),
          const SizedBox(height: AppSpacing.md),
          SelectableText(
            password,
            style: AppTextStyles.headlineSmall.copyWith(
              fontFeatures: const <FontFeature>[FontFeature.tabularFigures()],
            ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: AppSpacing.sm),
          Text(
            'Caduca en 15 minutos. El usuario debe cambiarla al entrar.',
            style: AppTextStyles.captionSmall
                .copyWith(color: context.tokens.textTertiary),
            textAlign: TextAlign.center,
          ),
        ],
      ),
      actions: <Widget>[
        AppButton(
          label: 'Copiar',
          icon: Icons.copy_rounded,
          variant: AppButtonVariant.secondary,
          size: AppButtonSize.small,
          onPressed: () async {
            await Clipboard.setData(ClipboardData(text: password));
            if (!context.mounted) return;
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(
                content: Text('Copiada al portapapeles.'),
                behavior: SnackBarBehavior.floating,
              ),
            );
          },
        ),
        AppButton(
          label: 'Hecho',
          variant: AppButtonVariant.espresso,
          size: AppButtonSize.small,
          onPressed: () => Navigator.of(context).pop(),
        ),
      ],
    );
  }
}
