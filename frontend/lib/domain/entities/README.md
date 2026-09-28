# domain/entities

Entidades puras: `User`, `Business`, `Location`, `Zone`, `Chair`, `Product`,
`Category`, `Variant`, `Addon`, `Order`, `OrderItem`, `Payment`, `Reservation`,
`Rental`, `Discount`, `InventoryMovement`, `Notification`.

Todas con `freezed`. Los campos monetaryos llevan el sufijo `Minor` para que
nadie los lea como pesos.
