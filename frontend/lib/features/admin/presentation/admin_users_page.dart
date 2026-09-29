// Pantalla de Usuarios del panel.
//
// QUIÉN VE ESTA PANTALLA
// `users:read`. Un MANAGER ve el listado; crear usuarios exige `users:create` y
// asignar roles, `users:roles:assign`. La UI oculta lo que no se tiene Y el backend
// responde `403` si se llega a intentarlo: la primera línea es la experiencia, la
// segunda es la garantía.
//
// EL ESTADO DE LA CUENTA TIENE TRES BOTONES, NO UN DESPLEGABLE
// Activar, inactivar y bloquear. Bloquear EXIGE motivo y revoca todas las sesiones:
// son tres cosas distintas con tres consecuencias distintas, y un desplegable las
// escondería.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../app/breakpoints.dart';
import '../../../app/theme/app_spacing.dart';
import '../../../core/error/failures.dart';
import '../../../domain/entities/user.dart';
import '../../../shared/constants/app_strings.dart';
import '../../../shared/widgets/ui/async_state_builder.dart';
// `currentUserProvider` vive en la feature de auth porque la sesión es de TODA la
// app, no del panel. Es la única excepción a «ninguna feature importa otra» y la
// usan también `app/admin/admin_shell.dart` y `app/router.dart`: sin ella, esta
// pantalla no puede saber si la fila que pulses eres tú, y el backend rechaza
// con `422 SELF_DEACTIVATION_FORBIDDEN` un botón que se haya podido pulsar.
import '../../auth/presentation/auth_controller.dart';
import '../domain/entities/admin_accounts.dart';
import './admin_users_controller.dart';
import './widgets/admin_detail_row.dart';
import './widgets/admin_list_and_state.dart';
import './widgets/admin_table_scaffold.dart';
import './widgets/admin_temporary_password_dialog.dart';
import './widgets/admin_user_card.dart';
import './widgets/admin_user_form_dialog.dart';

/// Equipo del negocio.
class AdminUsersPage extends ConsumerStatefulWidget {
  const AdminUsersPage({super.key});

  @override
  ConsumerState<AdminUsersPage> createState() => _AdminUsersPageState();
}

class _AdminUsersPageState extends ConsumerState<AdminUsersPage> {
  final TextEditingController _search = TextEditingController();

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<List<AdminUser>> users = ref.watch(adminUsersProvider);
    final List<AdminUser> visible = ref.watch(adminVisibleUsersProvider);
    final String? role = ref.watch(adminUserRoleProvider);
    final String? status = ref.watch(adminUserStatusProvider);
    final User? actor = ref.watch(currentUserProvider);
    final double padding = context.breakpoint.screenPadding;

    return ListView(
      padding: EdgeInsets.fromLTRB(padding, AppSpacing.xl, padding, AppSpacing.xxl),
      children: <Widget>[
        AdminPageHeader(
          title: AppStrings.navUsers,
          subtitle: 'Cuentas del equipo, sus roles y su estado',
          actions: <Widget>[
            if (actor?.hasPermission('users:create') ?? false)
              AdminHeaderAction(
                icon: Icons.person_add_alt_rounded,
                tooltip: 'Crear usuario',
                onPressed: () => _createUser(context, ref),
              ),
          ],
        ),
        AdminFilterBar(
          controller: _search,
          searchHint: 'Nombre o correo…',
          onSearch: (String value) =>
              ref.read(adminUserSearchProvider.notifier).state = value,
          filters: <AdminFilterOption>[
            if (role != null)
              AdminFilterOption(
                id: 'role',
                label: role,
                icon: Icons.badge_outlined,
                isActive: true,
                onTap: () => ref.read(adminUserRoleProvider.notifier).state = null,
              ),
            if (status != null)
              AdminFilterOption(
                id: 'status',
                label: status == 'ACTIVE' ? 'Activos' : status,
                icon: Icons.flag_outlined,
                isActive: true,
                onTap: () =>
                    ref.read(adminUserStatusProvider.notifier).state = null,
              ),
          ],
        ),
        AsyncStateBuilder<List<AdminUser>>(
          value: users,
          loadingMessage: 'Cargando el equipo…',
          onRetry: () async => ref.invalidate(adminUsersProvider),
          isEmpty: (List<AdminUser> data) => data.isEmpty,
          emptyIcon: Icons.badge_outlined,
          emptyTitle: AppStrings.adminEmptyUsers,
          emptyMessage: 'Invita al equipo para que puedan operar el mostrador.',
          builder: (BuildContext context, List<AdminUser> data) {
            if (visible.isEmpty) {
              return const AdminEmptyTable(
                icon: Icons.filter_alt_off_rounded,
                title: 'Ningún usuario coincide',
                message: 'Cambia la búsqueda o quita los filtros.',
              );
            }
            return ListView.separated(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
              itemCount: visible.length,
              separatorBuilder: (BuildContext context, int index) =>
                  const SizedBox(height: AppSpacing.sm),
              itemBuilder: (BuildContext context, int index) =>
                  AdminUserCard(user: visible[index], isSelf: visible[index].id == actor?.id),
            );
          },
        ),
      ],
    );
  }

  /// Alta de usuario. El `password` es opcional: si se omite, el backend genera
  /// una temporal y la devuelve UNA vez en `meta.temporaryPassword`.
  ///
  /// El `roles` NO es opcional aunque el esquema lo marque así: `createUserBodySchema`
  /// exige al menos un elemento, y mandarlo vacío es un 400. Por eso el formulario
  /// lo recoge antes de llamar y el servidor nunca ve un alta sin rol.
  Future<void> _createUser(BuildContext context, WidgetRef ref) async {
    final List<AdminRole> roles =
        ref.read(adminRolesProvider).valueOrNull ?? const <AdminRole>[];

    final AdminUserDraft? draft = await AdminUserFormDialog.show(context, roles);
    if (draft == null || !context.mounted) return;

    // El error del intento anterior no debe abrir el formulario nuevo.
    ref.read(adminUserCreateProvider.notifier).reset();

    final AdminUserCreated? created = await ref
        .read(adminUserCreateProvider.notifier)
        .submit(
          fullName: draft.fullName,
          email: draft.email,
          password: draft.password,
          roles: draft.roles,
        );
    if (!context.mounted) return;

    if (created == null) {
      final Object? error = ref.read(adminUserCreateProvider).error;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            error is Failure ? error.message : 'No se pudo crear el usuario.',
          ),
          behavior: SnackBarBehavior.floating,
        ),
      );
      return;
    }

    // Alta correcta. Si el backend generó contraseña, hay que mostrarla AHORA:
    // `meta.temporaryPassword` no se vuelve a pedir nunca.
    if (created.hasTemporaryPassword) {
      await AdminTemporaryPasswordDialog.show(
        context,
        fullName: draft.fullName,
        email: draft.email,
        password: created.temporaryPassword!,
      );
    }
    if (!context.mounted) return;
    ref.invalidate(adminUsersProvider);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('${draft.fullName} creado con ${draft.roles.length} rol(es).'),
        behavior: SnackBarBehavior.floating,
      ),
    );
  }
}
