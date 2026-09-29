// Fila de acceso del perfil (un item de menú con ícono, título y chevron).
//
// USA `AppCard` PARA QUE EL ITEM ENTERO SEA UN BOTÓN REAL
// Un `ListTile` dentro de una superficie no da control sobre el ripple, el radio
// ni el estado de foco; `AppCard(onTap:)` da los tres y ya expone
// `Semantics(button: true)`.
//
// EL CHEVRON Y EL SUBTÍTULO
// El chevron dice "esto se abre" (no "esto envía"); el subtítulo da el dato actual
// (tu email, cuántos pedidos tienes) para que la lista se pueda leer sin abrir
// nada.



import 'package:flutter/material.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../shared/widgets/ui/app_card.dart';

/// Item de menú del perfil.
class ProfileMenuTile extends StatelessWidget {
  const ProfileMenuTile({
    required this.icon,
    required this.title,
    this.subtitle,
    this.trailing,
    this.onTap,
    this.iconColor,
    super.key,
  });

  final IconData icon;
  final String title;
  final String? subtitle;
  final Widget? trailing;
  final VoidCallback? onTap;
  final Color? iconColor;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      onTap: onTap,
      margin: const EdgeInsets.only(bottom: AppSpacing.sm),
      padding: const EdgeInsets.all(AppSpacing.md),
      semanticLabel: subtitle == null ? title : '$title. $subtitle',
      child: Row(
        children: <Widget>[
          Container(
            padding: const EdgeInsets.all(AppSpacing.sm),
            decoration: BoxDecoration(
              color: (iconColor ?? context.tokens.actionPrimary).withOpacity(0.10),
              borderRadius: BorderRadius.circular(AppSpacing.sm),
            ),
            child: Icon(icon, size: 20, color: iconColor ?? context.tokens.actionPrimary),
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  title,
                  style: AppTextStyles.titleMedium,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                if (subtitle != null) ...<Widget>[
                  const SizedBox(height: AppSpacing.xxs),
                  Text(
                    subtitle!,
                    style: AppTextStyles.captionMedium
                        .copyWith(color: context.tokens.textSecondary),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ],
            ),
          ),
          if (trailing != null) trailing!,
          if (onTap != null)
            Icon(
              Icons.chevron_right_rounded,
              size: 20,
              color: context.tokens.textTertiary,
            ),
        ],
      ),
    );
  }
}
