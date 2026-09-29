// Fila responsive de dos campos. MÓDULO `features/admin/presentation/widgets`.
//
// POR QUÉ NO ES UN `Row` A SECO
// Dos campos a media anchura necesitan 720 dp. En un móvil de 360 dp se
//_convertirían_ en dos cajas de 150 dp donde no se lee ni elPlaceholder. Este
// widget apila por debajo de 480 dp y es la regla de toda la pantalla de Ajustes.

import 'package:flutter/material.dart';
import '../../../../app/theme/app_spacing.dart';

/// Fila de dos campos a media anchura. En móvil se apilan: dos campos de 150 dp en
/// 360 dp no dejan sitio para leer lo que se escribe.
class AdminFormRow extends StatelessWidget {
  const AdminFormRow({required this.children, super.key});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        if (constraints.maxWidth < 480) {
          return Column(
            children: <Widget>[
              for (int i = 0; i < children.length; i++) ...<Widget>[
                if (i > 0) const SizedBox(height: AppSpacing.md),
                children[i],
              ],
            ],
          );
        }
        return Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            for (int i = 0; i < children.length; i++) ...<Widget>[
              if (i > 0) const SizedBox(width: AppSpacing.md),
              Expanded(child: children[i]),
            ],
          ],
        );
      },
    );
  }
}
