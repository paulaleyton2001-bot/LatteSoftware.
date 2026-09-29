// Estado de la pantalla de Configuración del negocio.
//
// LOS HORARIOS SIEMPRE SON SIETE
// `PUT /business/hours` exige EXACTAMENTE 7 objetos, uno por `dayOfWeek`, sin
// repetidos: con menos responde `400 INCOMPLETE_WEEK`. Por eso
// `replaceHours` rellena los días que falten con un horario por defecto antes de
// llamar, en vez de mandar solo los días editados.
//
// LOS PORCENTAJES SON BASIS POINTS
// `taxRateBp`, `serviceFeeBp` y `defaultTipsBp` son ENTEROS en centésimas:
// 1900 = 19 %. El formulario los pide en PORCENTAJE (más natural de escribir) y
// `AdminSettingsForm` los multiplica por 100 al enviar. `defaultTipsBp` viaja como
// `string[]` (API.md §7.4), no como `int[]`.
//
// LA MONEDA NO SE CAMBIA DESPUÉS DE VENDER
// `PATCH /business` bloquea cambiar `currencyCode` con pedidos ya creados
// (`409 CURRENCY_CHANGE_BLOCKED`). El campo se muestra siempre, pero el backend
// manda: es información de negocio, no una decisión de diseño.
import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/error/failures.dart';
import '../../../core/result/result.dart';
import '../domain/entities/admin_business.dart';
import './admin_providers.dart';

/// Configuración del negocio.
final FutureProvider<AdminBusiness> adminBusinessProvider =
    FutureProvider<AdminBusiness>(
  (Ref ref) async {
    final Result<AdminBusiness> result =
        await ref.watch(adminDirectoryRepositoryProvider).business();
    return switch (result) {
      Success<AdminBusiness>(:final AdminBusiness value) => value,
      FailureResult<AdminBusiness>(:final Failure failure) => throw failure,
    };
  },
  name: 'adminBusiness',
);

/// Estado "abierto/cerrado ahora". DESVIACIÓN DOCUMENTADA: este endpoint existe en
/// el backend (`business.routes.ts` L113) y NO está en `docs/API.md`.
final FutureProvider<bool> adminBusinessOpenProvider = FutureProvider<bool>(
  (Ref ref) async {
    final Result<Map<String, dynamic>> result =
        await ref.read(adminDirectoryRepositoryProvider).businessStatus();
    return switch (result) {
      Success<Map<String, dynamic>>(:final Map<String, dynamic> value) =>
        value['isOpen'] == true || value['open'] == true,
      FailureResult<Map<String, dynamic>>() => false,
    };
  },
  name: 'adminBusinessOpen',
);

/// Horarios de la semana. Siempre siete filas.
final FutureProvider<List<AdminBusinessHour>> adminBusinessHoursProvider =
    FutureProvider<List<AdminBusinessHour>>(
  (Ref ref) async {
    final Result<List<AdminBusinessHour>> result =
        await ref.watch(adminDirectoryRepositoryProvider).hours();
    return switch (result) {
      Success<List<AdminBusinessHour>>(:final List<AdminBusinessHour> value) =>
        value,
      FailureResult<List<AdminBusinessHour>>(:final Failure failure) =>
        throw failure,
    };
  },
  name: 'adminBusinessHours',
);

/// Festivos configurados.
final FutureProvider<List<AdminHoliday>> adminHolidaysProvider =
    FutureProvider<List<AdminHoliday>>(
  (Ref ref) async {
    final Result<List<AdminHoliday>> result =
        await ref.watch(adminDirectoryRepositoryProvider).holidays();
    return switch (result) {
      Success<List<AdminHoliday>>(:final List<AdminHoliday> value) => value,
      FailureResult<List<AdminHoliday>>(:final Failure failure) => throw failure,
    };
  },
  name: 'adminHolidays',
);

/// Guardado de la configuración, los horarios y los festivos.
final AsyncNotifierProvider<AdminSettingsController, void> adminSettingsProvider =
    AsyncNotifierProvider<AdminSettingsController, void>(
  AdminSettingsController.new,
);

/// Controla las escrituras de Ajustes.
class AdminSettingsController extends AsyncNotifier<void> {
  @override
  FutureOr<void> build() {}

  /// `PATCH /business`.
  Future<bool> saveBusiness(Map<String, dynamic> body) => _run(
        () => ref.read(adminDirectoryRepositoryProvider).updateBusiness(body),
        onSuccess: () => ref.invalidate(adminBusinessProvider),
      );

  /// `PUT /business/hours` con los SIETE días.
  Future<bool> saveHours(List<AdminBusinessHour> hours) => _run(
        () => ref
            .read(adminDirectoryRepositoryProvider)
            .replaceHours(fillWeek(hours)),
        onSuccess: () => ref.invalidate(adminBusinessHoursProvider),
      );

  /// `POST /business/holidays`. `holidayDate` es `YYYY-MM-DD`.
  Future<bool> addHoliday({
    required String holidayDate,
    required String name,
    bool isClosed = true,
  }) =>
      _run(
        () => ref.read(adminDirectoryRepositoryProvider).createHoliday(
              holidayDate: holidayDate,
              name: name,
              isClosed: isClosed,
            ),
        onSuccess: () => ref.invalidate(adminHolidaysProvider),
      );

  /// `DELETE /business/holidays/:id`.
  Future<bool> removeHoliday(int holidayId) => _run(
        () => ref.read(adminDirectoryRepositoryProvider).deleteHoliday(holidayId),
        onSuccess: () => ref.invalidate(adminHolidaysProvider),
      );

  /// Ejecuta [action] y, si tuvo éxito, llama a [onSuccess].
  ///
  /// La invalidación va en un CALLBACK y no en una lista de nombres de provider:
  /// resolver un provider por su `String` obliga a castear tipos distintos a un
  /// denominador común, y ese `as` es justo el punto donde una errata se
  /// convierte en un fallo en runtime.
  Future<bool> _run(
    Future<Result<void>> Function() action, {
    required void Function() onSuccess,
  }) async {
    if (state.isLoading) return false;
    state = const AsyncLoading<void>();
    final Result<void> result = await action();
    // Sin guarda de disposal: los providers de Ajustes no son `autoDispose`, así
    // que el notifier sobrevive a cualquier `await`.
    switch (result) {
      case Success<void>():
        onSuccess();
        state = const AsyncData<void>(null);
        return true;
      case FailureResult<void>(:final Failure failure):
        state = AsyncError<void>(failure, StackTrace.current);
        return false;
    }
  }

  void acknowledge() => state = const AsyncData<void>(null);
}

/// Rellena la semana completa con los horarios por defecto que falten.
///
/// `PUT /business/hours` exige exactamente 7 filas. Si el backend devolviera menos
/// (un seed incompleto), se completa con "cerrado" en vez de fallar con
/// `INCOMPLETE_WEEK`: es mejor un día mal puesto que un formulario que no guarda.
List<AdminBusinessHour> fillWeek(List<AdminBusinessHour> hours) {
  final Map<int, AdminBusinessHour> byDay = <int, AdminBusinessHour>{
    for (final AdminBusinessHour hour in hours) hour.dayOfWeek: hour,
  };
  return <AdminBusinessHour>[
    for (int day = 0; day < 7; day++)
      byDay[day] ??
          AdminBusinessHour(
            dayOfWeek: day,
            opensAt: '08:00',
            closesAt: '18:00',
            isClosed: true,
          ),
  ];
}

/// Convierte un porcentaje escrito por el usuario a basis points.
///
/// Se trunca, no se redondea: un impuesto del 19,5 % se envía como 1950 y no como
/// 1951, que cobraría medio punto de más en cada venta.
int percentToBasisPoints(double percent) => (percent * 100).truncate();

/// Convierte basis points a porcentaje para pintar en un campo.
double basisPointsToPercent(int basisPoints) => basisPoints / 100;
