# domain/usecases

Casos de uso: una intención de negocio por archivo.

Ejemplos: `CreateOrder`, `CompleteRental`, `ExtendRental`, `ApplyDiscount`,
`TransitionOrderStatus`, `ReserveChair`, `ReportOccupancy`.

Regla: un caso de uso expresses una regla de negocio de `DESIGN.md` §7 y cita
el identificador `BR-AREA-NNN` en el doc comment. Si necesita lógica de varias
entidades, aquí se orquesta; nunca en un widget.
