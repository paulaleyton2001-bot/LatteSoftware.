// Reexportación de `ChairMapGrid`.
//
// El widget se movió a `lib/shared/widgets/chair_map_grid.dart` porque lo
// necesitan tres features (checkout del cliente, pestaña «Silla» y selector del
// POS) y las features no se importan entre sí. Este archivo conserva la ruta
// anterior para no tocar a quien ya la usa; no contiene código.
//
// ```dart
// import 'chair_map_grid.dart'; // sigue funcionando
// ```

export '../../../../shared/widgets/chair_map_grid.dart';
