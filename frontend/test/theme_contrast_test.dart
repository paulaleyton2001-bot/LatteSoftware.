// Contraste del tema, verificado con la fórmula de luminancia relativa de
// WCAG 2.1 (§1.4.3 texto normal 4.5:1, §1.4.11 componentes y bordes 3:1).
//
// POR QUÉ ES UN TEST Y NO UNA COMPROBACIÓN MANUAL
// Los bugs que reporta el usuario —"texto invisible", "chips crema sobre fondo
// marrón", "blanco que deja las letras"— son EXACTAMENTE este fallo. Y son
// silenciosos: el código compila, el widget se pinta y nadie se da cuenta hasta
// que alguien mira el móvil en la cafetería. Un ratio calculado es un número que
// falla en CI.
//
// La fórmula es la de la propia norma (no una aproximación): canal lineal sRGB,
// L = 0.2126R + 0.7152G + 0.0722B, ratio = (L1 + 0.05) / (L2 + 0.05).

import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:latte_coffee/app/theme/app_tokens.dart';

/// Luminancia relativa de un color, en 0..1 (WCAG 2.1).
///
/// `Color.red/green/blue` de Flutter son enteros 0-255, así que se normalizan
/// ANTES de aplicar la curva sRGB: sin ese `/ 255` los valores salen en miles y
/// cualquier comparación de luminancia miente.
double relativeLuminance(Color c) {
  double channel(int byte) {
    final double v = byte / 255.0;
    return v <= 0.03928 ? v / 12.92 : math.pow((v + 0.055) / 1.055, 2.4).toDouble();
  }

  return 0.2126 * channel(c.red) +
      0.7152 * channel(c.green) +
      0.0722 * channel(c.blue);
}

/// Ratio de contraste entre dos colores. El orden no importa (siempre >= 1).
double contrastRatio(Color a, Color b) {
  final double la = relativeLuminance(a);
  final double lb = relativeLuminance(b);
  final double hi = math.max(la, lb);
  final double lo = math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/// Falla con un mensaje que dice el par y los dos valores, para poder arreglarlo
/// sin volver a abrir el manual.
void expectContrast(String label, Color fg, Color bg, double min) {
  final double ratio = contrastRatio(fg, bg);
  expect(
    ratio,
    greaterThanOrEqualTo(min),
    reason: '$label — contraste ${ratio.toStringAsFixed(2)}:1, se exige '
        '$min:1. Texto $fg sobre fondo $bg. '
        'Si el fondo es claro y el texto también, el problema es el texto; '
        'si ambos son oscuros, el problema es el texto.',
  );
}

void main() {
  for (final (String mode, AppTokens t) in <(String, AppTokens)>[
    ('claro', AppTokens.light()),
    ('oscuro', AppTokens.dark()),
  ]) {
    group('Contraste en modo $mode', () {
      test('texto principal sobre cada superficie (AA 4.5:1)', () {
        // Se comprueba el texto principal contra TODAS las superficies en las
        // que puede aparecer: una sola comprobación dejaría fuera, por ejemplo,
        // el texto sobre `surfaceSunken` (cabeceras de tabla, skeletons).
        for (final (String nombre, Color bg) in <(String, Color)>[
          ('background', t.background),
          ('surface', t.surface),
          ('surfaceMuted', t.surfaceMuted),
          ('surfaceSunken', t.surfaceSunken),
          ('surfaceErrorSubtle', t.surfaceErrorSubtle),
          ('surfaceWarningSubtle', t.surfaceWarningSubtle),
          ('surfaceSuccessSubtle', t.surfaceSuccessSubtle),
          ('surfaceInfoSubtle', t.surfaceInfoSubtle),
          ('surfaceCleaningSubtle', t.surfaceCleaningSubtle),
          ('accentContainer', t.accentContainer),
        ]) {
          expectContrast('textPrimary sobre $nombre', t.textPrimary, bg, 4.5);
        }
      });

      test('texto secundario y terciario sobre superficie y mutada', () {
        for (final Color bg in <Color>[t.background, t.surface, t.surfaceMuted]) {
          expectContrast('textSecondary', t.textSecondary, bg, 4.5);
          expectContrast('textTertiary', t.textTertiary, bg, 4.5);
          expectContrast('textMuted', t.textMuted, bg, 4.5);
        }
      });

      test('texto del acento sobre el acento (botón primario, chip activo)', () {
        expectContrast('onActionPrimary sobre actionPrimary',
            t.onActionPrimary, t.actionPrimary, 4.5);
        expectContrast('onActionDanger sobre actionDanger',
            t.onActionDanger, t.actionDanger, 4.5);
        expectContrast('onActionEspresso sobre actionEspresso',
            t.onActionEspresso, t.actionEspresso, 4.5);
        expectContrast('onAccentContainer sobre accentContainer',
            t.onAccentContainer, t.accentContainer, 4.5);
        expectContrast('heroTitle sobre heroPanel', t.heroTitle, t.heroPanel, 4.5);
        expectContrast('heroSubtitle sobre heroPanel',
            t.heroSubtitle, t.heroPanel, 4.5);
      });

      test('texto de estado sobre su superficie diluida (badges)', () {
        // Es el caso de los badges de silla y de pedido: el texto NO se apoya
        // en la superficie de la app sino en su propio contenedor.
        expectContrast('availableText', t.availableText, t.availableSurface, 4.5);
        expectContrast('occupiedText', t.occupiedText, t.occupiedSurface, 4.5);
        expectContrast('reservedText', t.reservedText, t.reservedSurface, 4.5);
        expectContrast('blockedText', t.blockedText, t.blockedSurface, 4.5);
        expectContrast('maintenanceText', t.maintenanceText, t.maintenanceSurface, 4.5);
        expectContrast('cleaningText', t.cleaningText, t.cleaningSurface, 4.5);
        expectContrast('orderPendingText', t.orderPendingText, t.orderPendingSurface, 4.5);
        expectContrast('orderProgressText', t.orderProgressText, t.orderProgressSurface, 4.5);
        expectContrast('orderReadyText', t.orderReadyText, t.orderReadySurface, 4.5);
        expectContrast('orderClosedText', t.orderClosedText, t.orderClosedSurface, 4.5);
        expectContrast('orderCancelledText', t.orderCancelledText, t.orderCancelledSurface, 4.5);
      });

      test('texto de estado genérico sobre superficie (4.5:1)', () {
        for (final Color bg in <Color>[t.background, t.surface, t.surfaceMuted]) {
          expectContrast('textError', t.textError, bg, 4.5);
          expectContrast('textWarning', t.textWarning, bg, 4.5);
          expectContrast('textSuccess', t.textSuccess, bg, 4.5);
          expectContrast('textInfo', t.textInfo, bg, 4.5);
          expectContrast('textCleaning', t.textCleaning, bg, 4.5);
          expectContrast('textNeutral', t.textNeutral, bg, 4.5);
        }
      });

      test('bordes identificables solo por su borde (WCAG 1.4.11, 3:1)', () {
        // `borderStrong` es el que usan checkbox, radio y switch: si no llega a
        // 3:1, un control apagado es invisible para quien no distingue bien.
        for (final Color bg in <Color>[t.background, t.surface, t.surfaceMuted]) {
          expectContrast('borderStrong', t.borderStrong, bg, 3.0);
        }
      });

      test('el punto de estado de silla se distingue de su superficie (3:1)', () {
        // El punto de color va ACOMPAÑADO de texto, así que es información
        // redundante y tolera 3:1, pero tiene que distinguirse del fondo.
        expectContrast('availableDot', t.availableDot, t.availableSurface, 3.0);
        expectContrast('occupiedDot', t.occupiedDot, t.occupiedSurface, 3.0);
        expectContrast('blockedDot', t.blockedDot, t.blockedSurface, 3.0);
      });

      test('el texto deshabilitado sigue siendo legible (3:1, WCAG 1.4.3)', () {
        for (final Color bg in <Color>[t.background, t.surface]) {
          expectContrast('textDisabled', t.textDisabled, bg, 3.0);
        }
      });
    });
  }

  group('Invariantes del sistema de tema', () {
    test('el modo oscuro es MARRÓN espresso, no gris', () {
      // Requisito de producto, no de accesibilidad: un gris neutro delata que
      // el tema oscuro se generó por inversión y ensucia las fotos de producto.
      final AppTokens t = AppTokens.dark();
      for (final (String nombre, Color c) in <(String, Color)>[
        ('background', t.background),
        ('surface', t.surface),
        ('surfaceMuted', t.surfaceMuted),
        ('heroPanel', t.heroPanel),
      ]) {
        // En un ramp MARRÓN, el rojo siempre domina claramente al azul.
        expect(
          c.red - c.blue,
          greaterThan(10),
          reason: '$nombre = $c no es marrón: R-B = ${c.red - c.blue}.',
        );
      }
    });

    test('el acento se INVIERTE en oscuro: claro con tinta oscura encima', () {
      // El bug original: un botón verde claro con texto blanco daba 1.9:1.
      expect(
        relativeLuminance(AppTokens.light().actionPrimary),
        lessThan(relativeLuminance(AppTokens.light().onActionPrimary)),
        reason: 'En claro el primario debe ser más oscuro que su texto.',
      );
      expect(
        relativeLuminance(AppTokens.dark().actionPrimary),
        greaterThan(relativeLuminance(AppTokens.dark().onActionPrimary)),
        reason: 'En oscuro el primario debe ser más claro que su texto.',
      );
    });

    test('las superficies del oscuro están ordenadas (fondo < superficie)', () {
      final AppTokens t = AppTokens.dark();
      // Si el fondo fuera MÁS claro que la card, el `Scaffold` se transparentía
      // y las cards perdían su contorno.
      expect(
        relativeLuminance(t.surface),
        greaterThan(relativeLuminance(t.background)),
      );
      expect(
        relativeLuminance(t.surfaceMuted),
        greaterThan(relativeLuminance(t.surface)),
      );
    });

    test('`lerp` interpola sin lanzar y mueve el texto hacia el modo destino', () {
      final AppTokens a = AppTokens.light();
      final AppTokens b = AppTokens.dark();
      final AppTokens mid = a.lerp(b, 0.5);

      // El `textPrimary` va de tinta oscura (claro) a crema (oscuro), así que en
      // la transición su luminancia SUBE. Y tiene que quedarse entre las dos, ni
      // antes ni después: si se saliera del rango, el cross-fade del tema
      // mostraría un destello de color distinto al de los dos extremos.
      final double la = relativeLuminance(a.textPrimary);
      final double lb = relativeLuminance(b.textPrimary);
      final double lm = relativeLuminance(mid.textPrimary);
      expect(la, lessThan(lm));
      expect(lm, lessThan(lb));

      // La superficie hace lo contrario (de crema a espresso), y el conjunto
      // mantiene la separación texto/fondo durante toda la transición.
      expect(relativeLuminance(mid.surface), lessThan(lm));
    });
  });
}
