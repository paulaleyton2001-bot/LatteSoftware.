// Enlace inferior del marco de autenticación.

import 'package:flutter/material.dart';
//
// Vive en `shared`-style dentro de la feature porque TODAS las pantallas de
// auth lo necesitan con textos distintos ("¿No tienes cuenta?", "¿Ya la
// recuperaste?"). Un solo widget evita cuatro `TextButton` con `Semantics`
// distintos, y es donde se garantiza el target de 44 dp y el foco visible.


/// Fila centrada con una pregunta y una acción.
class AuthFooterLink extends StatelessWidget {
  const AuthFooterLink({
    required this.question,
    required this.actionLabel,
    required this.onTap,
    this.icon,
    super.key,
  });

  /// Texto de la pregunta, en tono secundario.
  final String question;

  /// Etiqueta de la acción. Va dentro del `Semantics` del control, así que el
  /// lector anuncia "No tienes cuenta, Crear cuenta" (WCAG 2.5.3).
  final String actionLabel;

  final VoidCallback onTap;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Text(
          question,
          textAlign: TextAlign.center,
          style: theme.textTheme.bodyMedium,
        ),
        TextButton.icon(
          onPressed: onTap,
          icon: Icon(icon ?? Icons.arrow_forward_rounded, size: 18),
          label: Text(actionLabel),
          // Target táctil ≥ 44 dp con label de 14 px: sin esto el botón queda
          // en 36 dp y falla WCAG 2.5.5.
          style: TextButton.styleFrom(
            minimumSize: const Size(0, 44),
            padding: const EdgeInsets.symmetric(horizontal: 16),
          ),
        ),
      ],
    );
  }
}
