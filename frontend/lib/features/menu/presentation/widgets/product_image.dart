// Imagen de producto con reserva de espacio y placeholder propio.
//
// POR QUÉ NO `Image.network` A PELO
// 1. `CachedNetworkImage` (ya declarado en `pubspec.yaml`) trae caché en disco y
//    decodificación diferida: en una rejilla de 40 productos, `Image.network`
//    sin caché descarga y decodifica 40 imágenes cada vez que se vuelve a la
//    pantalla.
// 2. El error y el "cargando" pintan el MISMO placeholder (`EmptyPlaceholderImage`),
//    así que la rejilla nunca cambia de alto al llegar la foto: sin CLS.
// 3. Sin foto, `EmptyPlaceholderImage` pone las iniciales del producto, que se
//    lee como contenido y no como una imagen rota.
//
// Es el ÚNICO punto de la app que decide cómo se ve una foto de producto, para
// que menú, home y ficha de producto muestren exactamente lo mismo.

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import '../../../../app/theme/app_radii.dart';
import '../../../../shared/widgets/ui/empty_placeholder_image.dart';

/// Foto de producto con `EmptyPlaceholderImage` de respaldo.
class ProductImage extends StatelessWidget {
  const ProductImage({
    required this.name,
    this.url,
    this.borderRadius = AppRadii.md,
    this.fit = BoxFit.cover,
    super.key,
  });

  /// Nombre del producto: alimenta las iniciales del placeholder y el
  /// `semanticLabel` de la imagen.
  final String name;

  /// URL remota. `null` o vacío → placeholder directo (sin intento de red).
  final String? url;

  final double borderRadius;
  final BoxFit fit;

  @override
  Widget build(BuildContext context) {
    final Widget placeholder = EmptyPlaceholderImage(name: name);
    final String? remote = url;

    if (remote == null || remote.isEmpty) return placeholder;

    // ─────────────────────────────────────────────────────────────────────────
    // RENDIMIENTO: LA FOTO NO SE DECODIFICA A SU TAMAÑO NATURAL
    // ─────────────────────────────────────────────────────────────────────────
    // `CachedNetworkImage` sin `memCacheWidth` baja la foto ORIGINAL (a menudo
    // 1200-2000 px) y la decodifica a ese tamaño para pintar un hueco de ~170 dp.
    // En la rejilla del menú son 20 productos: 20 decodificaciones de varios MB
    // en el hilo de la UI, que es de donde sale la sensación de "la app va
    // lenta" que reportó el usuario (scroll que se congela al entrar al menú).
    // `memCacheWidth` limita el decodificado al ancho real en píxeles físicos
    // (~3x en el Motorola = ~510 px), que es 10-20 veces menos memoria y de
    // decodificación por foto.
    //
    // `maxWidthDiskCache`/`maxHeightDiskCache` hacen lo mismo en la caché de
    // disco: evitan guardar en el almacenamiento la versión gigante de una foto
    // que se va a pintar a 170 dp.
    final double ratio = MediaQuery.maybeDevicePixelRatioOf(context) ?? 3;
    final int decodeWidth = (220 * ratio).round();

    return RepaintBoundary(
      // `RepaintBoundary`: sin él, cada animación de scroll repinta también el
      // bitmap de la imagen (que se estaba decodificando o componiendo justo
      // entonces). Con la frontera, la imagen se rasteriza a una capa propia y
      // el scroll solo mueve la capa.
      child: CachedNetworkImage(
        imageUrl: remote,
        fit: fit,
        memCacheWidth: decodeWidth,
        maxWidthDiskCache: decodeWidth,
        // El alto/alto los impone el padre (cuadrado en la card, 16:9 en la
        // ficha), así que aquí no se declaran dimensiones fijas: la imagen se
        // estira al hueco que le da el layout, sin CLS.
        placeholder: (BuildContext context, String url) => placeholder,
        errorWidget: (BuildContext context, String url, Object error) => placeholder,
      ),
    );
  }
}
