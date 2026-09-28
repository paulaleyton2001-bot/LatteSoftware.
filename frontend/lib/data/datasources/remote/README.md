# data/datasources/remote

Un archivo por recurso, con un método por endpoint de `docs/API.md` §7.
Cada método devuelve `Result<T>` o lanza `DioException` para que la capa
superior la mapee.
