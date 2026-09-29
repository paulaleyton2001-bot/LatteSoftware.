// Estado de las pantallas de Sillas y de Reservas/Alquileres del panel.
//
// TRES COSAS DISTINTAS, UN SOLO ARCHIVO
// Las tres comparten el mismo `locationId` (que `GET /chairs` y `GET /zones`
// exigen) y la misma invalidación cruzada: cambiar el estado de una silla cambia el
// plano, el tablero del POS y el alquiler en curso. Separarlas en tres archivos
// habría producido tres copias de esainvalidación, que es justo lo que se queda
// desfasada sin que nadie lo note.
//
// LA SEDE SE RESUELVE UNA VEZ
// `GET /chairs` y `GET /zones` exigen `locationId` en la query. La sede sale del
// token de negocio… salvo que no: el `businessId` sale del token, la SEDE no. Por
// eso `adminLocationIdProvider` pide `GET /locations?isActive=true` y toma la
// primera, igual que hace el POS (`core/customer/venue_datasource.dart`).

import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/error/failures.dart';
import '../../../core/result/result.dart';
import '../../../data/models/json_reader.dart';
import '../domain/entities/admin_spaces.dart';
import './admin_providers.dart';
import './admin_reservations_controller.dart';

/// Sede activa del negocio. `null` mientras se resuelve o si no hay ninguna.
final FutureProvider<int?> adminLocationIdProvider = FutureProvider<int?>(
  (Ref ref) async {
    final Result<List<Map<String, dynamic>>> result =
        await ref.read(adminSpacesRepositoryProvider).locations();
    return switch (result) {
      Success<List<Map<String, dynamic>>>(:final List<Map<String, dynamic>> value) =>
        value.isEmpty ? null : JsonReader.integer(value.first['id']),
      FailureResult<List<Map<String, dynamic>>>() => null,
    };
  },
  name: 'adminLocationId',
);

/// Zonas de la sede activa.
final FutureProvider<List<AdminZone>> adminZonesProvider =
    FutureProvider<List<AdminZone>>(
  (Ref ref) async {
    final int? locationId = await ref.watch(adminLocationIdProvider.future);
    if (locationId == null) return const <AdminZone>[];
    final Result<List<AdminZone>> result =
        await ref.watch(adminSpacesRepositoryProvider).zones(locationId: locationId);
    return switch (result) {
      Success<List<AdminZone>>(:final List<AdminZone> value) => value,
      FailureResult<List<AdminZone>>(:final Failure failure) => throw failure,
    };
  },
  name: 'adminZones',
);

/// Sillas de la sede activa, con filtro de zona y de búsqueda en memoria.
final FutureProvider<List<AdminChair>> adminChairsProvider =
    FutureProvider<List<AdminChair>>(
  (Ref ref) async {
    final int? locationId = await ref.watch(adminLocationIdProvider.future);
    if (locationId == null) return const <AdminChair>[];
    final Result<List<AdminChair>> result =
        await ref.watch(adminSpacesRepositoryProvider).chairs(
              locationId: locationId,
              zoneId: ref.watch(adminZoneFilterProvider),
            );
    return switch (result) {
      Success<List<AdminChair>>(:final List<AdminChair> value) => value,
      FailureResult<List<AdminChair>>(:final Failure failure) => throw failure,
    };
  },
  name: 'adminChairs',
);

/// Zona seleccionada. `null` = todas.
final StateProvider<int?> adminZoneFilterProvider =
    StateProvider<int?>((Ref ref) => null);

/// Búsqueda por código o nombre de silla.
final StateProvider<String> adminChairSearchProvider =
    StateProvider<String>((Ref ref) => '');

/// Sillas tras aplicar la búsqueda en memoria.
final Provider<List<AdminChair>> adminVisibleChairsProvider =
    Provider<List<AdminChair>>((Ref ref) {
  final List<AdminChair> all =
      ref.watch(adminChairsProvider).valueOrNull ?? const <AdminChair>[];
  final String needle = ref.watch(adminChairSearchProvider).trim().toLowerCase();
  if (needle.isEmpty) return all;
  return <AdminChair>[
    for (final AdminChair chair in all)
      if ('${chair.code} ${chair.name ?? ''} ${chair.cellLabel}'
          .toLowerCase()
          .contains(needle))
        chair,
  ];
}, name: 'adminVisibleChairs');

/// Recuento por estado, para los filtros y los contadores de cabecera.
final Provider<Map<String, int>> adminChairCountsProvider =
    Provider<Map<String, int>>((Ref ref) {
  final List<AdminChair> chairs =
      ref.watch(adminChairsProvider).valueOrNull ?? const <AdminChair>[];
  final Map<String, int> counts = <String, int>{};
  for (final AdminChair chair in chairs) {
    counts[chair.status] = (counts[chair.status] ?? 0) + 1;
  }
  return Map<String, int>.unmodifiable(counts);
}, name: 'adminChairCounts');

/// Cambio de estado de una silla.
///
/// Se offering cuatro ACCIONES (`POST /chairs/:id/block`, `/unblock`,
/// `/maintenance`, `/complete-maintenance`) y no un `PATCH /status` genérico con un
/// desplegable, porque el backend RECHAZA `OCCUPIED` y `RESERVED` con `422
/// INVALID_CHAIR_STATUS_TRANSITION` (BR-CHAIR-003): ofrecerlos sería ofrecer un
/// error previsible.
final AsyncNotifierProviderFamily<AdminChairStatusController, void, int>
    adminChairStatusProvider =
    AsyncNotifierProvider.family<AdminChairStatusController, void, int>(
  AdminChairStatusController.new,
);

/// Controla el estado manual de una silla.
class AdminChairStatusController extends FamilyAsyncNotifier<void, int> {
  @override
  FutureOr<void> build(int arg) {}

  /// Cambia el estado y recarga la lista, el plano y los alquileres: los tres
  /// dependen de él.
  Future<bool> setStatus(String status, {String? reason}) async {
    if (state.isLoading) return false;
    state = const AsyncLoading<void>();
    final Result<void> result = await ref
        .read(adminSpacesRepositoryProvider)
        .setChairStatus(arg, status, reason: reason);
    // Sin guarda de disposal: los providers de sillas y zonas no son
    // `autoDispose`, así que el notifier sobrevive a cualquier `await`.
    switch (result) {
      case Success<void>():
        _invalidateAll();
        state = const AsyncData<void>(null);
        return true;
      case FailureResult<void>(:final Failure failure):
        state = AsyncError<void>(failure, StackTrace.current);
        return false;
    }
  }

  void _invalidateAll() {
    ref.invalidate(adminChairsProvider);
    ref.invalidate(adminActiveRentalsProvider);
  }

  void acknowledge() => state = const AsyncData<void>(null);
}

/// Edición de una zona (`PATCH /zones/:id`).
///
/// Su propio provider porque la entrada es un FORMULARIO, no un estado de silla:
/// el diálogo necesita el `Failure` para dejarlo abierto con el error pegado al
/// campo que lo provocó, en vez de cerrarse y dejar un `SnackBar` huérfano.
final AsyncNotifierProviderFamily<AdminZoneEditController, void, int>
    adminZoneEditProvider =
    AsyncNotifierProvider.family<AdminZoneEditController, void, int>(
  AdminZoneEditController.new,
);

/// Controla la edición de una zona.
class AdminZoneEditController extends FamilyAsyncNotifier<void, int> {
  @override
  FutureOr<void> build(int arg) {}

  /// Guarda la zona. Devuelve `true` si el backend aceptó.
  ///
  /// `updateZoneBodySchema` es `.strict()` y además exige al menos un campo: se
  /// manda solo lo que cambió, y si no cambió nada se devuelve `true` sin gastar
  /// una llamada. `capacity` NO se manda: es derivado de las sillas y mandarlo da
  /// un 422 en vez de un 400, que es la respuesta que el backend eligió a
  /// propósito (BR-CHAIR-005).
  Future<bool> save({
    required String name,
    required String? code,
    required String? colorHex,
    required bool isActive,
  }) async {
    if (state.isLoading) return false;
    state = const AsyncLoading<void>();
    final Result<void> result = await ref
        .read(adminSpacesRepositoryProvider)
        .updateZone(arg, <String, dynamic>{
          'name': name.trim(),
          'code': code != null && code.trim().isEmpty ? null : code!.trim(),
          if (colorHex != null) 'colorHex': colorHex,
          'isActive': isActive,
        });
    // Sin guarda de disposal: los providers de sillas y zonas no son
    // `autoDispose`, así que el notifier sobrevive a cualquier `await`.
    switch (result) {
      case Success<void>():
        ref.invalidate(adminZonesProvider);
        ref.invalidate(adminChairsProvider);
        ref.invalidate(adminLocationIdProvider);
        state = const AsyncData<void>(null);
        return true;
      case FailureResult<void>(:final Failure failure):
        state = AsyncError<void>(failure, StackTrace.current);
        return false;
    }
  }

  /// Lleva el error a la clave del campo que lo provocó.
  ///
  /// El backend manda `fieldErrors` con la RUTA del campo en el body (`code`,
  /// `name`); sin esto el error aparece siempre en el primer campo, aunque el
  /// culpable sea el código.
  String? errorFor(String path) {
    final Object? error = state.error;
    if (error is! Failure) return null;
    for (final FieldError detail in error.fieldErrors) {
      if (detail.path == path) return detail.message;
    }
    return null;
  }

  /// Error general: el que no corresponde a ningún campo concreto.
  String? get generalError {
    final Object? error = state.error;
    return error is Failure ? error.message : null;
  }

  void acknowledge() => state = const AsyncData<void>(null);
}
