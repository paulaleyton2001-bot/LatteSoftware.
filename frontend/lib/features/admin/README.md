# features/admin

Shell de administración con `AppSidebar` y subpantallas: dashboard,
productos, categorías, sillas, inventario, pedidos, reportes (fl_chart),
usuarios y configuración. Cada subpantalla exige permiso del backend.

## Estructura obligatoria (docs/DESIGN.md §2.3)

```
lib/features/admin/
├── data/          # DTOs, datasource remoto/local, implementación del repositorio
├── domain/        # entidades y casos de uso propios de admin
├── presentation/  # widgets/páginas (usan shared/widgets/ui)
└── providers/     # Riverpod: AsyncNotifier / FutureProvider / StateProvider
```

Reglas:
- `presentation/` puede importar `shared/`, `core/` y su propio `domain/`.
- `presentation/` NUNCA importa `data/`: habla con providers, y son los
  providers los que llaman al repositorio.
- Ninguna feature importa otra feature directamente; se comunican por `core/`
  o por providers globales.
- Todo dato asíncrono se muestra con `AsyncStateBuilder`. Nada de spinners
  escritos a mano.
