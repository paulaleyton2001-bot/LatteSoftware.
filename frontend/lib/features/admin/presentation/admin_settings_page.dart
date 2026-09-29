// Configuración del negocio: datos, horarios de apertura y festivos.
//
// TRES SECCIONES CON TRES PERMISOS DISTINTOS
// `business:update` para los datos, `business:hours:update` para los horarios y
// `business:hours:manage`... no: `business:holidays:manage` para los festivos. El
// enunciado mencionaba `business:manage`, clave que NO existe en
// `shared/domain/permissions.ts`: el catálogo real es una clave por acción. Aquí se
// usan las de verdad.
//
// LOS HORARIOS SON SIETE FILAS FIJAS
// `PUT /business/hours` exige exactamente 7 objetos. No hay un "añadir día": hay
// siete, y cada una se abre o se cierra. Es también lo que espera la referencia
// visual del producto.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../app/breakpoints.dart';
import '../../../app/theme/app_spacing.dart';
import '../../../shared/constants/app_strings.dart';
import '../../../shared/widgets/ui/async_state_builder.dart';
import '../domain/entities/admin_business.dart';
import './admin_settings_controller.dart';
import './widgets/admin_holidays_section.dart';
import './widgets/admin_hours_editor.dart';
import './widgets/admin_settings_form.dart';
import './widgets/admin_table_scaffold.dart';

/// Pantalla de configuración del negocio.
class AdminSettingsPage extends ConsumerWidget {
  const AdminSettingsPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<AdminBusiness> business = ref.watch(adminBusinessProvider);
    final double padding = context.breakpoint.screenPadding;

    return ListView(
      padding: EdgeInsets.fromLTRB(padding, AppSpacing.xl, padding, AppSpacing.xxl),
      children: <Widget>[
        const AdminPageHeader(
          title: AppStrings.navSettings,
          subtitle: 'Datos del negocio, horarios de apertura y festivos',
        ),
        // Sin `Expanded` alrededor: este `ListView` se construye con un sliver, no
        // con un flex, y un `ParentDataWidget` de flex como hijo directo revienta
        // con «Incorrect use of ParentDataWidget» en modo debug. El cuerpo tampoco
        // es otro `ListView` —scroll dentro de scroll con datos que caben en
        // pantalla solo hace el arrastre menos predecible.
        AsyncStateBuilder<AdminBusiness>(
          value: business,
          loadingMessage: 'Cargando la configuración…',
          onRetry: () async => ref.invalidate(adminBusinessProvider),
          builder: (BuildContext context, AdminBusiness data) => Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              AdminBusinessForm(business: data),
              const SizedBox(height: AppSpacing.xl),
              const AdminHoursEditor(),
              const SizedBox(height: AppSpacing.xl),
              const AdminHolidaysSection(),
            ],
          ),
        ),
      ],
    );
  }
}
