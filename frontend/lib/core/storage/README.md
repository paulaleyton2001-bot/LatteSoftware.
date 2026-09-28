# core/storage  (fase siguiente)

- `secure_store.dart`: access/refresh token. **Nunca** `shared_preferences`
  para secretos (queda en el llavero/keystore del sistema).
- `prefs.dart`: tema, business cacheado, flags, último filtro, `pageSize`
  preferido. Es caché, no fuente de verdad.
