# data/models

DTOs con `json_serializable`. El código generado (`.g.dart`, `.freezed.dart`)
se commitea: el build de release no corre `build_runner`.

Convención: `*Dto` para red y entidad de dominio aparte. Un DTO puede tener
campos que la entidad no (y al revés) sin forzar la transformación.
