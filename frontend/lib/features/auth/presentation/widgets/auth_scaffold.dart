// Marco visual compartido por TODAS las pantallas de autenticación.
//
// Un solo lugar decide cómo se ve el login, el registro, el "¿olvidaste tu
// contraseña?" y el restablecimiento. Antes de que existiera, cada pantalla
// repetía el `Scaffold`, el `Center`, el `ConstrainedBox` y el `BrandMark`, y
// se acabaron cuatro alturas de cabecera distintas.
//
// RESPONSIVE (DESIGN-TOKENS.md §5)
//   - móvil (< 600): el contenido ocupa el ancho con padding de pantalla y sin
//     card: en 320 dp una card con borde solo quita espacio.
//   - tablet+ (≥ 600): la card aparece centrada y elevada, con ancho máximo
//     (nunca estirada: 4 columnas de formulario en 1440 dp son ilegibles).
//
// ACCESIBILIDAD
//   - Un único `header: true` por pantalla (el título), para que el lector de
//     pantalla salte entre secciones (WCAG 2.4.1).
//   - `SafeArea` + scroll: con el teclado abierto en móvil el botón de enviar
//     sigue alcanzable, que es el criterio de "teclado abierto" de §5.

import 'package:flutter/material.dart';

import '../../../../app/theme/app_colors.dart';
import '../../../../app/theme/app_radii.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../app/theme/responsive/breakpoints.dart';
import '../../../../shared/widgets/brand_mark.dart';
import '../../../../shared/widgets/ui/app_card.dart';

/// Marco de las pantallas de autenticación.
class AuthScaffold extends StatelessWidget {
  const AuthScaffold({
    required this.title,
    required this.subtitle,
    required this.child,
    this.footer,
    this.showBrand = true,
    this.showBackButton = false,
    this.onBack,
    this.scrollController,
    super.key,
  });

  /// Título de la pantalla. Es el único `header: true` de la pantalla.
  final String title;

  /// Bajada: una frase que explica qué hace esta pantalla.
  final String subtitle;

  /// Formulario o contenido.
  final Widget child;

  /// Pie con enlaces ("¿No tienes cuenta? Crear cuenta").
  final Widget? footer;

  /// `false` para ocultar la marca (pantallas de restablecimiento, que ya
  /// vienen de un correo y deben ser discretas).
  final bool showBrand;

  /// Muestra una flecha de "volver" (volver al login desde recuperar clave).
  final bool showBackButton;

  final VoidCallback? onBack;

  final ScrollController? scrollController;

  /// Ancho máximo del formulario. 420 dp ≈ 45 caracteres por línea: por encima
  /// la lectura de un campo de contraseña se vuelve incómoda.
  static const double maxContentWidth = 420;

  @override
  Widget build(BuildContext context) {
    final Breakpoint breakpoint = context.breakpoint;
    final bool compact = breakpoint.isMobile;

    final Widget content = Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        if (showBrand) ...<Widget>[
          const Center(child: BrandMark(size: 56)),
          SizedBox(height: compact ? AppSpacing.xl : AppSpacing.xxl),
        ],
        Semantics(
          header: true,
          child: Text(
            title,
            textAlign: TextAlign.center,
            style: AppTextStyles.headlineMedium,
          ),
        ),
        const SizedBox(height: AppSpacing.sm),
        Text(
          subtitle,
          textAlign: TextAlign.center,
          style: AppTextStyles.bodyMedium
              .copyWith(color: AppColors.textSecondary),
        ),
        SizedBox(height: compact ? AppSpacing.xl : AppSpacing.xxl),
        child,
        if (footer != null) ...<Widget>[
          SizedBox(height: compact ? AppSpacing.xl : AppSpacing.xxl),
          footer!,
        ],
      ],
    );

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: showBackButton
          ? AppBar(
              backgroundColor: AppColors.background,
              leading: Semantics(
                button: true,
                label: 'Volver',
                child: IconButton(
                  icon: const Icon(Icons.arrow_back_rounded),
                  tooltip: 'Volver',
                  onPressed: onBack,
                ),
              ),
            )
          : null,
      body: SafeArea(
        child: SingleChildScrollView(
          controller: scrollController,
          padding: EdgeInsets.symmetric(
            horizontal: breakpoint.screenPadding,
            vertical: compact ? AppSpacing.xl : AppSpacing.xxxl,
          ),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: maxContentWidth),
              child: compact
                  ? content
                  : AppCard(
                      variant: AppCardVariant.elevated,
                      borderRadius: AppRadii.xl,
                      padding: const EdgeInsets.all(AppSpacing.xxl),
                      child: content,
                    ),
            ),
          ),
        ),
      ),
    );
  }
}
