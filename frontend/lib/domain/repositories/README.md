# domain/repositories

Interfaces (contratos) que implementa `data/repositories/`.

Ejemplos: `AuthRepository`, `ProductsRepository`, `OrdersRepository`,
`ChairsRepository`, `ReservationsRepository`, `RentalsRepository`,
`BusinessRepository`, `ReportsRepository`.

Todas sus firmas devuelven `Future<Result<T>>`; nunca lanzan.
