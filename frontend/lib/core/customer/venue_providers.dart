// Providers de lectura del local. Módulo `core/customer`.
//
// `venueMapProvider` lo usan el checkout (elegir silla) y la pestaña «Silla» (ver
// el plano). Que esté en `core/customer` y no en una feature es lo que permite
// que las dos lo compartan sin importarse.
//
// `autoDispose`: el mapa se relee al invalidarlo. Se invalida explícitamente tras
// un `409` de silla ocupada, para que quien está mirando vea el estado nuevo y
// no el de hace un minuto.


import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../di/providers.dart';
import '../error/failures.dart';
import '../network/api_exception.dart';
import '../result/result.dart';
import './chair_map.dart';
import './venue_datasource.dart';

/// Datasource de lectura del local.
final Provider<VenueRemoteDataSource> venueRemoteDataSourceProvider =
    Provider<VenueRemoteDataSource>(
  (Ref ref) => VenueRemoteDataSource(ref.watch(apiClientProvider)),
  name: 'venueRemoteDataSource',
);

/// Mapa de sillas del local (`GET /chairs/map`).
final FutureProvider<ChairMap> venueMapProvider = FutureProvider<ChairMap>(
  (Ref ref) async {
    final Result<ChairMap> result = await _readMap(ref);
    return switch (result) {
      Success<ChairMap>(:final ChairMap value) => value,
      FailureResult<ChairMap>(:final Failure failure) => throw failure,
    };
  },
  name: 'venueMap',
);

/// Mapa con error tipado: si el local no tiene sede activa se explica en vez de
/// devolver un plano vacío sin contexto.
Future<Result<ChairMap>> readVenueMap(Ref ref) => _readMap(ref);

/// Fuerza la recarga del plano.
void invalidateVenueMap(Ref ref) => ref.invalidate(venueMapProvider);

Future<Result<ChairMap>> _readMap(Ref ref) async {
  try {
    return Success<ChairMap>(
      await ref.watch(venueRemoteDataSourceProvider).chairMapOrEmpty(),
    );
  } on Object catch (error) {
    return FailureResult<ChairMap>(ApiException.toFailure(error));
  }
}
