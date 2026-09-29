// Orquestador de los 6 estados de UI. TODA pantalla debe usarlo.
//
// Por qué existe: cada pantalla necesita manejar loading / éxito / vacío /
// error / sin conexión / no autorizado. Si cada una lo resuelve por su cuenta
// aparecen 6 variantes de "algo salió mal" y el usuario aprende cinco tonos
// distintos para el mismo problema.
//
// Uso típico (con Riverpod):
// ```dart
// final products = ref.watch(productsProvider);
// return AsyncStateBuilder<ProductList>(
//   value: products,
//   isEmpty: (data) => data.items.isEmpty,
//   emptyIcon: Icons.local_cafe_outlined,
//   emptyTitle: 'No hay productos',
//   emptyMessage: 'Publica tu primer producto para verlo en el menú.',
//   emptyActionLabel: 'Crear producto',
//   onEmptyAction: () => context.push('/admin/products/new'),
//   onRetry: () => ref.invalidate(productsProvider),
//   builder: (context, data) => ProductGrid(items: data.items),
// );
// ```
//
// Reglas:
//   - `isEmpty` decide vacío vs éxito; por defecto compara contra `null`.
//   - `skipLoadingOnRefresh`: en refrescos (pull-to-refresh) se mantiene el
//     contenido visible en vez de parpadear el skeleton (menos jarring).
//   - Nunca se muestra loading y contenido a la vez.


import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/error/failures.dart';
import './empty_state.dart';
import './error_state.dart';
import './loading_state.dart';
import './offline_state.dart';

/// Builder de los 6 estados de UI a partir de un `AsyncValue<T>`.
class AsyncStateBuilder<T> extends StatelessWidget {
  const AsyncStateBuilder({
    required this.value,
    required this.builder,
    this.isEmpty,
    this.onRetry,
    this.emptyIcon,
    this.emptyTitle = 'Nada por aquí todavía',
    this.emptyMessage = 'Cuando haya información, aparecerá en esta pantalla.',
    this.emptyActionLabel,
    this.onEmptyAction,
    this.loadingMessage,
    this.offlineTitle,
    this.offlineMessage,
    this.skipLoadingOnRefresh = true,
    this.compactEmpty = false,
    this.showTechnicalDetails = false,
    super.key,
  });

  /// Estado de Riverpod que se quiere renderizar.
  final AsyncValue<T> value;

  /// Constructor del contenido de éxito.
  final Widget Function(BuildContext context, T data) builder;

  /// `true` si los datos publicados están vacíos → se muestra [EmptyState].
  final bool Function(T data)? isEmpty;

  /// Reintento. Aparece en [ErrorState] cuando el fallo es reintentable.
  final Future<void> Function()? onRetry;

  final IconData? emptyIcon;
  final String emptyTitle;
  final String emptyMessage;
  final String? emptyActionLabel;
  final VoidCallback? onEmptyAction;

  /// Texto bajo el spinner de la primera carga.
  final String? loadingMessage;

  /// Título y mensaje del estado SIN CONEXIÓN.
  ///
  /// Se pueden sustituir porque el texto por defecto («los datos que ya
  /// cargamos siguen disponibles y se actualizarán solos») describe una cola
  /// offline con reintento, y no toda pantalla tiene una. El POS NO encola
  /// nada: dir lo que puede hacer y lo que no.
  final String? offlineTitle;
  final String? offlineMessage;

  /// `true` = en refresco mantiene el contenido y no vuelve al skeleton.
  final bool skipLoadingOnRefresh;

  /// `true` = [EmptyState] compacto (dentro de una card).
  final bool compactEmpty;

  /// `true` = muestra el panel de detalles técnicos en modo debug.
  final bool showTechnicalDetails;

  @override
  Widget build(BuildContext context) {
    // 1) Carga inicial: skeleton/spinner.
    if (value.isLoading && !(skipLoadingOnRefresh && value.hasValue)) {
      return AppSpinner(message: loadingMessage);
    }

    // 2) Error / sin conexión / no autorizado.
    final Object? error = value.error;
    if (error != null) {
      return _errorView(context, error);
    }

    // 3) Sin datos todavía (p. ej. loading con skip y sin value previo).
    final T? data = value.valueOrNull;
    if (data == null) {
      return AppSpinner(message: loadingMessage);
    }

    // 4) Éxito con contenido vacío.
    if (_isEmpty(data)) {
      return EmptyState(
        icon: emptyIcon ?? Icons.inbox_rounded,
        title: emptyTitle,
        message: emptyMessage,
        actionLabel: emptyActionLabel,
        onAction: onEmptyAction,
        compact: compactEmpty,
      );
    }

    // 5) Éxito con contenido.
    return builder(context, data);
  }

  /// `true` si el estado corresponde a "lista sin resultados".
  bool _isEmpty(T data) => isEmpty?.call(data) ?? false;

  /// Decide entre [OfflineState], [ErrorState] y Unauthorized.
  Widget _errorView(BuildContext context, Object error) {
    if (error is OfflineFailure) {
      return OfflineState(
        onRetry: onRetry,
        title: offlineTitle,
        message: offlineMessage,
      );
    }
    if (error is Failure) {
      return ErrorState(
        failure: error,
        onRetry: onRetry == null ? null : () => unawaited(onRetry!()),
        showTechnicalDetails: showTechnicalDetails,
      );
    }
    return ErrorState(
      failure: UnknownFailure(details: error.toString()),
      onRetry: onRetry == null ? null : () => unawaited(onRetry!()),
      showTechnicalDetails: showTechnicalDetails,
    );
  }
}
