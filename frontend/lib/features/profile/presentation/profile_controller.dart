// Estado de la pantalla de perfil.
//
// LOS PERMISOS SALEN DE `User.permissions`, NO DE UNA CONDICIÓN POR ROL
// `GET /auth/me` devuelve la unión COMPLETA de claves de permiso (BR-RBAC-005) y
// el backend puede agregar roles. Comparar roles en el cliente duplicaría la
// matriz de RBAC, que es exactamente lo que la norma prohíbe; con
// `user.hasPermission('users:read')` la app pregunta al servidor.
//
// ENTRADA AL ÁREA DE ADMINISTRACIÓN
// Un empleado (`isStaff` o con `users:read`) ve un acceso visible a `/pos`. La
// ruta la implementa otro agente; aquí se usa la CONSTANTE compartida
// (`AppRoutes.pos`) y no un path escrito a mano, de modo que cuando la ruta se
// monte no haya que tocar esta pantalla.
//
// `PATCH /auth/me` se aplica sobre el estado de SESIÓN (`AuthController.updateUser`),
// no en un estado local del perfil: así el nombre y los permisos cambian en toda la
// app de golpe (sidebar, saludo del menú, guardas del router).


import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/di/providers.dart';
import '../../../core/error/failures.dart';
import '../../../core/result/result.dart';
import '../../../domain/entities/auth_result.dart';
import '../../auth/presentation/auth_controller.dart';
import '../data/datasources/remote/profile_remote_datasource.dart';
import '../data/repositories/profile_repository_impl.dart';
import '../domain/entities/customer_stats.dart';
import '../domain/repositories/profile_repository.dart';

/// Repositorio del perfil. Punto de inyección de la feature.
final Provider<ProfileRepository> profileRepositoryProvider =
    Provider<ProfileRepository>(
  (Ref ref) => ProfileRepositoryImpl(
    ProfileRemoteDataSource(ref.watch(apiClientProvider)),
    ref.watch(currentUserProvider)?.id ?? 0,
  ),
  name: 'profileRepository',
);

/// Estadísticas del cliente (`GET /customers/me`).
final FutureProvider<CustomerStats> customerStatsProvider =
    FutureProvider<CustomerStats>(
  (Ref ref) async {
    final Result<CustomerStats> result =
        await ref.watch(profileRepositoryProvider).stats();
    return switch (result) {
      Success<CustomerStats>(:final CustomerStats value) => value,
      FailureResult<CustomerStats>(:final Failure failure) => throw failure,
    };
  },
  name: 'customerStats',
);

/// Reservas del cliente.
final FutureProvider<List<CustomerReservation>> myReservationsProvider =
    FutureProvider<List<CustomerReservation>>(
  (Ref ref) async {
    final Result<List<CustomerReservation>> result =
        await ref.watch(profileRepositoryProvider).reservations();
    return switch (result) {
      Success<List<CustomerReservation>>(:final List<CustomerReservation> value) => value,
      FailureResult<List<CustomerReservation>>(:final Failure failure) => throw failure,
    };
  },
  name: 'myReservations',
);

/// Sesiones activas del cliente (`GET /auth/sessions`).
final FutureProvider<List<AuthDeviceSession>> deviceSessionsProvider =
    FutureProvider<List<AuthDeviceSession>>(
  (Ref ref) async {
    final Result<List<AuthDeviceSession>> result =
        await ref.read(authRepositoryProvider).sessions();
    return switch (result) {
      Success<List<AuthDeviceSession>>(:final List<AuthDeviceSession> value) => value,
      FailureResult<List<AuthDeviceSession>>(:final Failure failure) => throw failure,
    };
  },
  name: 'deviceSessions',
);

/// Preferencias de notificación.
final AsyncNotifierProvider<NotificationPrefsController, NotificationPreferences>
    notificationPrefsProvider =
    AsyncNotifierProvider<NotificationPrefsController, NotificationPreferences>(
  NotificationPrefsController.new,
);

/// Controlador de las preferencias de notificación.
///
/// `AsyncNotifier` y no `FutureProvider` porque hay ESCRITURA: al cambiar un
/// switch se guarda en el servidor y el estado pasa por `loading`. Con
/// `FutureProvider` habría que invalidar y recargar, y el switch parpadearía
/// entre el valor nuevo y el viejo.
class NotificationPrefsController extends AsyncNotifier<NotificationPreferences> {
  @override
  Future<NotificationPreferences> build() async {
    final Result<NotificationPreferences> result =
        await ref.watch(profileRepositoryProvider).notificationPreferences();
    return switch (result) {
      Success<NotificationPreferences>(:final NotificationPreferences value) => value,
      FailureResult<NotificationPreferences>(:final Failure failure) =>
        throw failure,
    };
  }

  /// Guarda (o limpia) el horario de silencio.
  ///
  /// `quietHoursFrom` y `quietHoursTo` son un par con CHECK en la base de datos:
  /// mandarlos separados da `400 QUIET_HOURS_INCOMPLETE`. Por eso el método
  /// recibe los dos y escribe los dos, y `null` en ambos los borra. El
  /// `AsyncValue` devuelto va a `data` con `true` si el servidor confirmó, o a
  /// `error` con el `Failure` si no: la pantalla decide el mensaje.
  Future<bool> setQuietHours(String? from, String? to) async {
    // `valueOrNull` es `NotificationPreferences?`: el `if (... == null) return`
    // estreta el tipo, así que el tipo declarado NO puede ser no-nullable o la
    // asignación no compila.
    final NotificationPreferences? current = state.valueOrNull;
    if (current == null) return false;

    final NotificationPreferences next = NotificationPreferences(
      inApp: current.inApp,
      push: current.push,
      email: current.email,
      sms: current.sms,
      whatsapp: current.whatsapp,
      quietHoursFrom: from,
      quietHoursTo: to,
    );
    if (next == current) return true;

    state = AsyncData<NotificationPreferences>(current);
    final Result<NotificationPreferences> result =
        await ref.read(profileRepositoryProvider).updateNotificationPreferences(next);
    // Sin guarda de disposal: los providers de preferencias no son `autoDispose`,
    // así que el notifier sobrevive a la llamada.
    switch (result) {
      case Success<NotificationPreferences>(:final NotificationPreferences value):
        state = AsyncData<NotificationPreferences>(value);
        return true;
      case FailureResult<NotificationPreferences>(:final Failure failure):
        state = AsyncError<NotificationPreferences>(failure, StackTrace.current);
        return false;
    }
  }

  /// `PUT /notifications/preferences` con el cambio aplicado.
  ///
  /// Se guarda el valor ANTERIOR mientras llega la respuesta: si el servidor
  /// rechaza el cambio (por ejemplo `422 IN_APP_REQUIRED`), el switch vuelve a su
  /// posición y el error se publica, en vez de dejar la interfaz mintiendo.
  Future<void> toggle({
    required bool? push,
    required bool? email,
    required bool? sms,
    required bool? whatsapp,
  }) async {
    // Mismo criterio que en `setQuietHours`.
    final NotificationPreferences? current = state.valueOrNull;
    if (current == null) return;

    final NotificationPreferences next = current.copyWith(
      push: push,
      email: email,
      sms: sms,
      whatsapp: whatsapp,
    );
    if (next == current) return;

    state = AsyncData<NotificationPreferences>(current);
    final Result<NotificationPreferences> result =
        await ref.read(profileRepositoryProvider).updateNotificationPreferences(next);
    // Sin guarda de disposal: los providers de preferencias no son `autoDispose`.
    state = switch (result) {
      Success<NotificationPreferences>(:final NotificationPreferences value) =>
        AsyncData<NotificationPreferences>(value),
      FailureResult<NotificationPreferences>(:final Failure failure) =>
        AsyncError<NotificationPreferences>(failure, StackTrace.current),
    };
  }
}

/// Resultado de una escritura de perfil (editar datos, cambiar contraseña,
/// revocar sesión). Es un estado SENCILLO y compartido por tres pantallas con el
/// mismo patrón: `idle` → `busy` → mensaje o fallo.
class ProfileAction {
  const ProfileAction({this.isBusy = false, this.message, this.failure});

  final bool isBusy;

  /// Mensaje de éxito, apto para `SnackBar`.
  final String? message;

  final Failure? failure;

  bool get isSuccess => !isBusy && failure == null && message != null;

  static const ProfileAction idle = ProfileAction();
  static ProfileAction busy() => const ProfileAction(isBusy: true);
}

/// Estado de las acciones de cuenta.
final NotifierProvider<ProfileActionController, ProfileAction> profileActionProvider =
    NotifierProvider<ProfileActionController, ProfileAction>(ProfileActionController.new);

/// Controla las acciones de cuenta (editar perfil, contraseña, revocar sesión).
class ProfileActionController extends Notifier<ProfileAction> {
  @override
  ProfileAction build() => ProfileAction.idle;

  void reset() => state = ProfileAction.idle;

  /// Ejecuta [action] con el patrón busy → resultado → mensaje/fallo.
  ///
  /// Se usa en las tres pantallas de cuenta para que el botón, el banner y el
  /// `SnackBar` se comporten igual en todos los casos.
  Future<bool> run(Future<Result<String>> Function() action) async {
    state = ProfileAction.busy();
    final Result<String> result = await action();
    // Sin guarda de disposal: `profileActionProvider` no es `autoDispose` y el
    // botón que lo dispara sigue montado mientras corre la acción.
    state = switch (result) {
      Success<String>(:final String value) => ProfileAction(message: value),
      FailureResult<String>(:final Failure failure) => ProfileAction(failure: failure),
    };
    return result.isSuccess;
  }
}
