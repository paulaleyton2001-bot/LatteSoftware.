// Estado de la pantalla de inicio: estado del local, tu silla activa y catálogo.
//
// POR QUÉ `GET /business` Y `GET /business/hours` Y NO UN `GET /business/status`
// `docs/API.md` (contrato CONGELADO, §7.4) NO tiene ningún `/business/status`. La
// configuración del negocio (`timezone`, `chairDefaultPriceMinor`,
// `maxReservationMinutes`…) está en `GET /business` y el horario de apertura en
// `GET /business/hours` (7 filas con `dayOfWeek` 0-6, `opensAt`/`closesAt` "HH:MM",
// `isClosed`). El estado "abierto ahora" es un cálculo de una línea con esos dos
// datos, y se hace en cliente, en la zona horaria del negocio.
//
// LA ZONA HORARIA SE APLICA AL FORMATEADOR
// `DateFormatter.timeZoneOverride` recibe el `timezone` que publica
// `GET /business` (`businesses.timezone`). Así la hora que se compara con la
// apertura del local es la DEL LOCAL, no la del dispositivo: alguien con el reloj
// en otro huso no debe ver "abierto" cuando aquí lleva una hora cerrada.
//
// EL SÍMBOLO DEL DINERO TAMBIÉN SE APLICA AL FORMATEADOR
// Por el mismo motivo, `CurrencyFormatter.setSymbol` recibe
// `businesses.currency_symbol` de la misma respuesta. La app del cliente no lleva
// el símbolo escrito en ningún widget: lo formatea `CurrencyFormatter`, que por
// defecto usa el del contrato y en cuanto llega esta respuesta usa el del local.
//
// LA CACHÉ DEL NEGOCIO
// `PreferencesStorage.cachedBusiness` ya existía en `core/storage` para esto. Se lee
// una vez y se guarda en cada lectura correcta, para que la app abra con el nombre
// y el horario del local incluso sin red, que es el arranque normal de una
// cafetería.


import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/di/providers.dart';
import '../../../core/error/failures.dart';
import '../../../core/result/result.dart';
import '../../../core/utils/currency_formatter.dart';
import '../../../core/utils/date_formatter.dart';
import '../../../shared/widgets/rental_countdown.dart';
import '../data/datasources/remote/business_remote_datasource.dart';
import '../data/repositories/business_repository_impl.dart';
import '../domain/entities/business_status.dart';
import '../domain/repositories/business_repository.dart';

/// Repositorio del negocio. Punto de inyección de la feature.
final Provider<BusinessRepository> businessRepositoryProvider =
    Provider<BusinessRepository>(
  (Ref ref) => BusinessRepositoryImpl(
    BusinessRemoteDataSource(ref.watch(apiClientProvider)),
    ref.watch(preferencesStorageProvider),
  ),
  name: 'businessRepository',
);

/// Estado del local (nombre, horario, abierto/cerrado).
final FutureProvider<BusinessStatus> businessStatusProvider =
    FutureProvider<BusinessStatus>(
  (Ref ref) async {
    final Result<BusinessStatus> result =
        await ref.watch(businessRepositoryProvider).status();
    return switch (result) {
      Success<BusinessStatus>(:final BusinessStatus value) => () {
          // La zona horaria del negocio se inyecta ANTES de formatear nada: a
          // partir de aquí, todas las fechas de la app se presentan en hora de
          // Latte Coffee, no en la del reloj del dispositivo.
          DateFormatter.timeZoneOverride = value.timezone;
          // Y el símbolo del dinero también sale de aquí: `GET /business`
          // publica `businesses.currency_symbol` y un local que cobre en otra
          // moneda no tiene que esperar a que el cliente hardcodee otro símbolo.
          CurrencyFormatter.setSymbol(value.currencySymbol);
          return value;
        }(),
      FailureResult<BusinessStatus>(:final Failure failure) => throw failure,
    };
  },
  name: 'businessStatus',
);

/// Estado del local LEÍDO DE LA CACHÉ, sin red.
///
/// La home lo pinta de inmediato mientras `businessStatusProvider` va a la red:
/// el nombre y el horario son los mismos de ayer, y esperar un round-trip para
/// ellos retrasa la pantalla sin ganar información. `null` si nunca se guardó
/// nada, y entonces la home cae al esqueleto.
final Provider<BusinessStatus?> cachedBusinessStatusProvider =
    Provider<BusinessStatus?>((Ref ref) {
  final Map<String, dynamic>? cached =
      ref.watch(preferencesStorageProvider).cachedBusiness;
  if (cached == null) return null;
  final BusinessStatus? status = BusinessStatus.fromCache(cached);
  if (status == null) return null;
  DateFormatter.timeZoneOverride = status.timezone;
  // El símbolo cacheado también se aplica: el primer precio que se pinte en el
  // arranque SIN red sale con el símbolo del local, no con el del contrato.
  CurrencyFormatter.setSymbol(status.currencySymbol);
  return status;
}, name: 'cachedBusinessStatus');

/// `true` si el estado que se está pintando viene de la caché local.
///
/// Se compara la referencia temporal: si la lectura de red terminó bien, el
/// provider da un objeto DISTINTO al de la caché, así que se puede saber sin
// añadir un campo a la entidad.
final Provider<bool> businessIsStaleProvider = Provider<bool>(
  (Ref ref) {
    final BusinessStatus? live = ref.watch(businessStatusProvider).valueOrNull;
    if (live == null) return false;
    final BusinessStatus? cached = ref.watch(cachedBusinessStatusProvider);
    return cached != null && identical(cached, live);
  },
  name: 'businessIsStale',
);

/// Frase corta con la fecha, para la cabecera de la home.
///
/// El SALUDO con el nombre NO vive aquí: vive en
/// `shared/constants/greeting.dart` porque Inicio y Menú lo comparten y cada uno
/// con su propio criterio se veía como un bug ("Buenos días, Ana" contra "Hola,
/// Ana").
final Provider<String> todayLabelProvider = Provider<String>((Ref ref) {
  ref.watch(clockProvider);
  return DateFormatter.dateLong(DateTime.now());
}, name: 'todayLabel');
