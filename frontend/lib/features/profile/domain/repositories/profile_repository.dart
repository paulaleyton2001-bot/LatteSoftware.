// Contrato del perfil. Módulo `features/profile/domain`.
//
// El PERFIL Y LAS SESIONES NO ESTÁN AQUÍ
// `GET /auth/me`, `PATCH /auth/me`, `GET /auth/sessions`,
// `DELETE /auth/sessions/:id` y `POST /auth/change-password` ya los resuelve
// `domain/repositories/auth_repository.dart`. Esta interfaz solo añade lo que el
// perfil necesita y la auth no tiene: estadísticas de cliente, reservas y
// preferencias de notificación.

import '../../../../core/result/result.dart';
import '../entities/customer_stats.dart';

/// Lecturas y escrituras del perfil del cliente.
abstract interface class ProfileRepository {
  /// `GET /customers/me` — estadísticas agregadas del cliente.
  Future<Result<CustomerStats>> stats();

  /// `GET /customers/:id/reservations` — reservas del cliente.
  Future<Result<List<CustomerReservation>>> reservations();

  /// `GET /notifications/preferences`.
  Future<Result<NotificationPreferences>> notificationPreferences();

  /// `PUT /notifications/preferences`.
  Future<Result<NotificationPreferences>> updateNotificationPreferences(
    NotificationPreferences preferences,
  );
}
