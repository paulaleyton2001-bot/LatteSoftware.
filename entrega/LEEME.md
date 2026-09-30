# LatteCoffe — LEEME de entrega

**Proyecto:** sistema de punto de venta (POS) y alquiler de sillas para una cafetería.
**Fecha de esta entrega:** 29 de septiembre de 2026.
**Estado:** funcionando de punta a punta contra un backend real desplegado en Docker.
**Los dos APK de esta entrega NO están en el repositorio.** Cada uno pesa ~28 MB y
versionarlos hizo que `.git` creciera de 2,5 MB a 69 MB de forma permanente, así que
se entregan por otro canal: la carpeta **`LatteCoffe-ENTREGA/`** de al lado del
repositorio (`/home/arch-tarok/Escritorio/LatteCoffe-ENTREGA/`), que además lleva una
copia de este `LEEME.md`, de `SHA256SUMS.txt` y de `capturas/`. En el repositorio sólo
queda la evidencia: **este `LEEME.md`, `SHA256SUMS.txt` y `capturas/`**. Los APK son
reproducibles: se reconstruyen desde cero en ~100 s cada uno, con el comando de §8.

**Estos dos APK son la entrega final.** Se reconstruyeron el 29 de
septiembre de 2026 a las **19:33** (`LatteCoffee-local.apk`) y las **19:34**
(`LatteCoffee-release.apk`), es decir **después del último arreglo**, tanto del
backend (`381ee4c`, cierre del alquiler al cobrar) como del frontend (alquiler
desde la pestaña Silla, cobro de alquiler con carrito vacío, puente del carrito y
márgenes del menú). Las sumas SHA-256 de `SHA256SUMS.txt` son las de **estos**
ficheros; las de una reconstrucción anterior no coinciden.

Este documento es para el instructor. No hace falta saber nada previo: está todo lo
que hace falta para instalar, entrar y probar el sistema.

---

## 1. Qué es este sistema

LatteCoffe es la aplicación de una cafetería ficticia. Tiene tres caras:

| Cara | Para quién | Qué hace |
|---|---|---|
| **Cliente** | gente que visita la cafetería | Ve el menú, hace pedidos, **reserva** una silla para una franja concreta y la **alquila** por horas |
| **Cajero (POS)** | quien atiende el mostrador | Cobra pedidos, marca el check-in de una reserva, **abre y cierra alquileres** de silla |
| **Administración** | dueño y gerente | Consultan indicadores, gestionan el negocio, auditan qué hizo cada quien |

La pieza que resume el proyecto es la **silla**: no es un mueble, es un recurso que se
reserva por horas, se alquila, se amplía, se cobra al salir y hay que limpiar antes de
volver a venderla. El sistema lleva la máquina de estados de esa silla completa
(`DISPONIBLE → RESERVADA → OCUPADA → LIMPIEZA → DISPONIBLE`) y **no permite** que dos
personas ocupar la misma silla a la vez.

**Cómo está construido:**

- **Backend:** Node.js 22 + Express 5 + SQLite (`better-sqlite3`). Desplegado en **Docker**
  en un servidor Linux. API REST bajo `/api/v1`.
- **Frontend:** Flutter (Android). APK compilados en modo *release* y firmados.
- **Datos:** 1 negocio, 5 zonas, 25 sillas, 6 categorías y 24 productos de demostración.

---

## 2. Los dos APK de la entrega

| Fichero | Tamaño | URL que lleva dentro | Cuándo usarlo |
|---|---|---|---|
| **`LatteCoffee-release.apk`** | 30.281.342 bytes (~28,9 MB) | `https://his-eligibility-handbags-cohen.trycloudflare.com/api/v1` | **Este es el que se instala y se prueba en clase.** Funciona sin más, con datos de red (4G/Wi-Fi), porque el backend ya está desplegado en internet. |
| **`LatteCoffee-local.apk`** | 30.281.269 bytes (~28,9 MB) | `http://localhost:3000/api/v1` | Sólo para un taller con cable: necesita un `adb reverse` (§7). **No** funciona en un teléfono suelto sin USB. |

Las sumas SHA-256 de los dos están en `SHA256SUMS.txt`. Para comprobar que el fichero
no se corrompió por el camino:

```bash
cd /home/arch-tarok/Escritorio/LatteCoffe-ENTREGA
sha256sum -c SHA256SUMS.txt     # debe decir: LatteCoffee-release.apk: OK
```

> **Ojo con la carpeta:** los APK **no** están en `entrega/` dentro del repositorio, que
> es donde vive este `LEEME.md`. Están en `LatteCoffe-ENTREGA/`, junto al repositorio.

> ### ⚠️ El APK de release está atado a una URL temporal
> La URL viene **incrustada dentro del APK** en tiempo de compilación (`--dart-define`).
> Es un *quick tunnel* de Cloudflare: es gratis, no pide cuenta, **pero la URL es
> aleatoria y cambia cada vez que se levanta el túnel**. Si alguien reinicia el túnel,
> el APK de release deja de encontrar el servidor y la app mostrará error de red.
>
> **Si eso ocurre, hay que rehacer el APK** (comando exacto en §8). No es un fallo de la
> app: es que una URL gratuita y temporal no es una dirección permanente. Para un
> despliegue real habría que comprar un dominio y apuntar un túnel con cuenta de
> Cloudflare a ese dominio; la app no habría que tocar, sólo se reconstruye con la URL
> buena.

Los dos APK llevan el **mismo `applicationId`** (`co.lattecoffe.frontend`) y la **misma
clave de firma**, así que **son intercambiables**: puede instalar uno, desinstalarlo
(`adb uninstall co.lattecoffe.frontend`) e instalar el otro. No se pueden tener los dos a
la vez.

### Clave de firma

Los dos APK están firmados con una clave de **demostración** que viaja en el repositorio
a propósito, para que cualquiera pueda recompilar y comparar:

- Fichero: `frontend/keystore/lattecoffe-release.jks`
- Alias: `lattecoffe`
- Contraseña del almacén y de la clave: `LatteCoffee2026`
- Certificado: `CN=LatteCoffe Demo, OU=SENA, O=LatteCoffe, L=Bogota, ST=Cundinamarca, C=CO`
- SHA-256 del certificado:
  `C8:9B:CA:4C:C3:38:89:9C:D1:55:8E:39:AB:4A:D9:96:96:FC:AF:17:81:3B:2C:49:69:BA:F7:3A:A0:0E:A2:DF`

**Esto NO es una clave de producción.** Está escrita aquí a propósito. Si este sistema
fuera a producción, la clave habría que generarla, guardarla fuera del repositorio y
perderla. Para comprobar la firma de un APK:

```bash
$ANDROID_HOME/build-tools/*/apksigner verify --print-certs LatteCoffee-release.apk
```

---

## 3. Cuentas de prueba

**Todas con la misma contraseña: `LatteCofee#2026`**. Verificadas una por una con `curl`
contra el backend desplegado (todas devuelven `200` y el `role` que se indica abajo) el
29 de septiembre de 2026, **antes** de escribir este documento.

| Correo | Rol | Qué puede hacer |
|---|---|---|
| `cliente1@lattecoffe.co` … `cliente4@lattecoffe.co` | CUSTOMER (Camila Restrepo y otras) | Ver el menú, agregar al carrito y pedir, **reservar** una silla para una franja, ver sus reservas. **No** puede abrir un alquiler por su cuenta: eso lo hace el personal de mostrador (`403` si lo intenta). |
| `cajero@lattecoffe.co` | CASHIER (Cajero) | Todo lo del cliente **más**: cobrar en el punto de venta, **alquilar** una silla ("Alquilar ahora"), **ampliar** el alquiler, **terminar** el alquiler y cobrar, poner una silla en limpieza / bloquearla / liberarla. |
| `manager@lattecoffe.co` | MANAGER (Gerente) | Lo del cajero **más**: Reports/indicadores, inventario, descuentos, ver el historial de las sillas. |
| `admin@lattecoffe.co` | ADMIN (Administrador) | Lo del gerente **más**: gestión de usuarios, configuración, auditoría. |
| `owner@lattecoffe.co` | OWNER (Propietario) | Todo lo anterior. Es la cuenta de más alto nivel del sistema. |

Comprobación rápida de que todas siguen vivas:

```bash
BASE=https://his-eligibility-handbags-cohen.trycloudflare.com/api/v1
for e in admin cajero manager owner cliente1; do
  printf "%-10s " "$e"
  curl -s -o /dev/null -w "%{http_code}\n" -X POST "$BASE/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$e@lattecoffe.co\",\"password\":\"LatteCofee#2026\"}"
done
# esperado: 200 en las cinco
```

> Estas cuentas existen porque el despliegue de demostración corre con `APP_ENV=staging`.
> En un despliegue real (`APP_ENV=production`) el backend **se niega a arrancar** si se
> intenta sembrar cuentas de sistema con una contraseña compartida, y además aborta si el
> secreto JWT es débil. Eso está implementado y se comprobó (§7).

---

## 4. Cómo instalar el APK (paso a paso)

### Opción A — por cable, desde el computador (recomendada)

1. En el teléfono: **Ajustes → Acerca de → Toca 7 veces "Número de compilación"** para
   desbloquear las opciones de desarrollador. Luego ve a
   **Ajustes → Sistema → Opciones de desarrollador → Activar "Depuración USB"**.
2. Conecta el teléfono por **cable USB** y acepta el diálogo *"¿Permitir depuración USB?"*
   en el teléfono (marca "Permitir siempre desde este equipo").
3. En el computador, con el SDK de Android instalado:

   ```bash
   ADB=~/Android/Sdk/platform-tools/adb
   $ADB devices                 # debe listar tu teléfono como "device"
   $ADB install -r LatteCoffee-release.apk
   ```

4. Listo. Abre "LatteCoffe" en el teléfono.

### Opción B — pasando el archivo al teléfono, sin computador

1. Copia `LatteCoffee-release.apk` al teléfono (cable, tarjeta SD, Drive, WhatsApp...).
2. En el teléfono, abre el **Gestor de archivos** y pulsa el `.apk`.
3. Android va a pedir permiso para instalar apps de fuentes desconocidas. Dale los dos
   interruptores que encuentres:
   - **Ajustes → Aplicaciones → Acceso especial → Instalar paquetes desconocidos →
     (el explorador de archivos que estás usando) → Permitir de esta fuente**
   - En Android 13 o superior también puede aparecer directamente un aviso
     *"Instalar apps de origen desconocido"* al instalar: pulsa **Ajustes** ahí mismo y
     activa el permiso de ese explorador.
4. Vuelve a abrir el `.apk` y pulsa **Instalar**. Puede pedir también *"Instalar apps de
   Google Play"* → **Instalar de todos modos**. (No pasa nada raro: es Android
   comprobando que confías en el instalador.)

> **En teléfonos Xiaomi / Redmi (MIUI) hay un paso extra**: Ajustes → Ajustes additional
> → **Instalar mediante USB** tiene que estar activado, o `adb install` falla con
> `INSTALL_FAILED_USER_RESTRICTED: Install canceled by user`. Por la interfaz de la
> pantalla también funciona: MIUI pregunta en un diálogo de Google Play Protect
> *"¿Quieres enviar una app para un control de seguridad?"* → **No enviar**.

> Si el APK no se instala, casi siempre es el permiso de "fuentes desconocidas". Un APK
> firmado con clave propia **no** pasa por Google Play, así que ese permiso es
> obligatorio aquí.

---

## 5. La prueba clave: reservar y alquilar una silla

Esta es la evidencia de que el sistema funciona. Está **verificada en un teléfono real**
(Motorola Edge 60, Android 16) contra el backend desplegado; las capturas están en
`capturas/`, en ese orden.

### 5.1 Reservar una silla (como cliente)

1. Entra con `cliente1@lattecoffe.co` / `LatteCofee#2026`.
   → *Captura `01-login-como-cajero.png`* (el login es la misma pantalla para todos los roles).
2. En **Inicio** ya ves el catálogo real: los productos con sus precios
   (Latte $5.500, Matcha latte $9.000…). Vienen del servidor, no están metidos en la app.
   → *Captura `02-catalogo-real-del-backend.png`.*
3. Pestaña **Menú**: salen los chips de categoría **con el número de productos que
   devuelve el servidor**: Cafés 7, Bebidas 4, Comidas 4, Postres 4, Snacks 3,
   Especiales 2. **6 categorías, 24 productos.**
   → *Captura `03-categorias-con-conteos.png`.*
4. Baja a la pestaña **Silla**. Verás el **mapa del local**: 5 zonas (Terraza, Interior,
   Ventana, Zona Premium, Sala de Trabajo), 25 sillas coloreadas según su estado y el
   contador *"23 de 25 libres"*.
   → *Captura `04-mapa-25-sillas.png`.*
5. **Toca una silla verde** (por ejemplo `TZ-06`). Se abre un panel con el precio por
   hora y dos botones: **Reservar para una hora** y **Alquilar ahora**.
6. Como **cliente**, el botón de alquiler está bloqueado y la app lo explica: es una
   regla de negocio, no un fallo (ver §5.2).
7. Pulsa **Reservar para una hora**. Elige el día, la hora de inicio y la duración
   (30 min / 1 h / 2 h / 3 h / 4 h). Debajo se calcula el precio con impuestos.
8. Pulsa **Reservar por $…**. Sale *"Reserva creada"* con un código (por ejemplo
   `RES-90000x`) y la silla pasa a **Reservada**.
9. Pulsa **Confirmar mi reserva**. Ahora la silla queda **apartada**: nadie más puede
   tomarla en esa franja, y el backend lo impide aunque alguien lo intente por API
   (`409 CONFLICT_ERROR`).

### 5.2 Alquilar una silla (como cajero) — el camino que funciona

Un cliente **no** puede abrir un alquiler sin cita: el backend responde `403` y la app lo
dice. Para probarlo, entra con `cajero@lattecoffe.co`.

1. Pestaña **Perfil → Punto de venta** para abrir el mostrador, o **Perfil → Salir** y
   entra de nuevo como cajero.
   → *Capturas `11-perfil-rol-cajero.png` y `12-pos-cajero.png`.*
2. En el **Tablero**, pestaña **Cobro**, elige el tipo de pedido **"Alquiler de silla"**.
   Aparece el plano de las 25 sillas.
3. **Toca una silla verde**. Abajo sale **"Abrir alquiler sin reserva"**.
4. Elige la duración (30 / 60 / 90 / 120 / 180 / 240 minutos) y pulsa **Abrir alquiler**.
   El panel avisa: *"Alquiler RES-… · RENT-… abierto. Ya puedes cobrarlo."*
   → *Captura `13-pos-alquiler-abierto.png`.*
5. Vuelve a la pestaña **Silla** del mostrador (o al **Tablero → Cobro**): la silla ya
   está **Ocupada** y aparece el alquiler con su código, hora de inicio y de fin, y los
   botones **Ampliar 30 min** y **Terminar y cobrar en el local**.
6. Pulsa **Ampliar 30 min** → confirma. La hora de fin se mueve 30 minutos.
   → *Captura `06-alquiler-ampliado-30min.png`.*
7. Pulsa **Terminar y cobrar en el local** → confirma. Se cobra el tiempo realmente usado
   con un mínimo de 30 minutos, y la silla queda en **Limpieza**, desde donde el personal
   la **libera** con un toque ("Marcar limpia").
   → *Capturas `07-alquiler-terminado-silla-en-limpieza.png` y
   `08-silla-vuelta-a-disponible.png`.*

Ese camino se verificó también **fuera de la app**, en la pestaña **Silla** del cajero,
sin tocar el POS: silla `TZ-06` → **Alquilar ahora por 1 h** → alquiler `RENT-900007`
→ **Ampliar 30 min** (la hora de fin pasó de 17:38 a 18:08) → **Terminar y cobrar**
(`totalMinor = 900000`, es decir $9.000 = 1 h + 30 min a $6.000/h) → silla en **Limpieza**.
→ *Capturas `05-alquiler-activo-RENT-900007.png`.*

### 5.3 El botón grande "Cobrar alquiler" del POS

**Ahora funciona de punta a punta** (los dos fallos que se documentaban en §10 están
arreglados, y estos APK ya llevan el arreglo): pulsar el botón crea el pedido
`CHAIR_RENTAL` **sin líneas de producto**, lo cobra, y **cierra el alquiler y deja la
silla en `LIMPIEZA`**, que el personal libera con un toque. Ya no hace falta añadir un
producto cualquiera al carrito para que el botón se despierte: con el carrito vacío y
el alquiler abierto, el botón se habilita y cobra el alquiler. Si aun así no se puede
cobrar, la app lo dice con el motivo en un diálogo, en vez de quedarse en silencio.

Se ve funcionando en `14-pos-cobro-alquiler.png` y `15-pos-cobro-registrado.png`
(pedido `ORD-900020`, `CHAIR_RENTAL`, $7.140, pagado).

### 5.4 Lo mismo, sin teléfono (por terminal)

Para comprobarlo en 30 segundos, con `curl`. `BASE` es la URL del §6.

```bash
BASE=https://his-eligibility-handbags-cohen.trycloudflare.com/api/v1

# 1) Entrar como cajero y quedarse con el token
TOKEN=$(curl -s -X POST "$BASE/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"cajero@lattecoffe.co","password":"LatteCofee#2026"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"]["accessToken"])')

# 2) Alquilar una silla libre una hora. Ojo: la respuesta va envuelta en "data".
#    Copia el "id" que devuelve.
curl -s -X POST "$BASE/rentals" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"chairId":9,"plannedMinutes":60}'

# 3) Ampliar 30 minutos
curl -s -X POST "$BASE/rentals/12/extend" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"additionalMinutes":30}'

# 4) Terminar y cobrar
curl -s -X POST "$BASE/rentals/12/complete" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{}'
```

> `chairId` es el **id numérico** de la silla, no su código (`IN-M03` → `9`). Para ver
> las sillas y sus ids: `curl -s "$BASE/chairs" -H "Authorization: Bearer $TOKEN"`.
> Si eliges una que ya tiene un alquiler abierto, el backend responde
> `409 CONFLICT_ERROR / CHAIR_OCCUPIED` con el código del alquiler que la ocupa.

Reglas de negocio que se pueden comprobar así (están implementadas, no son adornos):

- Un **cliente** que intenta `POST /rentals` recibe `403`
  `AUTHORIZATION_ERROR` ("No tiene permisos para realizar esta acción"): le falta el
  permiso `rentals:create`.
- Dos clientes que piden la **misma silla en la misma franja**: el segundo recibe
  `409 CONFLICT_ERROR` "La silla ya está reservada en esa franja horaria".
- La reserva se cancela con `POST /reservations/:id/cancel` (**no** con `DELETE`; esa ruta
  no existe y devuelve `404`).
- El cobro de un pedido **exige cabecera `Idempotency-Key`** (UUID v4). Sin ella:
  `400 VALIDATION_ERROR` "El cobro requiere la cabecera Idempotency-Key".

---

## 6. ¿Dónde está el backend? (URL del túnel)

```
https://his-eligibility-handbags-cohen.trycloudflare.com/api/v1
```

Comprobado desde fuera de la red del proyecto:

```
$ curl -s https://his-eligibility-handbags-cohen.trycloudflare.com/api/v1/health
{"success":true,"data":{"status":"ok","name":"LatteCoffe API","version":"1.0.0",
 "database":{"connected":true,"migrationsPending":0},"checks":{"database":"ok",...}}}

$ curl -s https://his-eligibility-handbags-cohen.trycloudflare.com/api/v1/menu | \
    python3 -c "import json,sys; d=json.load(sys.stdin)['data'];
    print(len(d),'categorías,',sum(len(c['products']) for c in d),'productos')"
6 categorías, 24 productos
```

### Carácter temporal de la URL — léase

Es un **quick tunnel** de Cloudflare:

- **Es gratuita y no pide cuenta**, pero **la URL es aleatoria**: cambia cada vez que se
  levanta el túnel.
- **No hay garantía de disponibilidad.** Cloudflare la puede cortar; el túnel se cae si
  se reinicia el servidor; el contenedor tiene `restart: unless-stopped` pero eso no
  protege de una caída de red larga.
- **Sirve sólo para una demostración.** No es una dirección estable para un negocio.

Para un despliegue de verdad: dominio propio + túnel con cuenta de Cloudflare + nginx y
certificados. La app no cambia; sólo se recompila con la URL buena.

### Cómo levantar y parar el túnel

Todo se hace **en el servidor** (`ssh TuDeliDatabase`):

```bash
cd ~/lattecoffe

# Levantar (perfil opcional "tunnel")
docker compose --profile tunnel up -d tunnel

# Leer la URL pública que acaba de generar
docker compose logs tunnel | grep -o 'https://[a-z-]*\.trycloudflare\.com' | head -1

# Ver que responde
curl -s https://<la-url-del-paso-anterior>/api/v1/health

# Parar el túnel (el API sigue funcionando por dentro)
docker compose --profile tunnel stop tunnel

# Volver a levantarlo
docker compose --profile tunnel up -d tunnel
```

> `cloudflared` **no** se instala como dependencia del proyecto: corre como el contenedor
> `cloudflare/cloudflared:latest` declarado en `docker-compose.yml`, dentro del perfil
> opcional `tunnel`. No hay nada que instalar en el host.

**Cada vez que lo levantas de nuevo, la URL es otra.** Si cambias la URL, hay que
reconstruir el APK (§8).

---

## 7. Levantar el backend con Docker (para quien quiera montarlo)

No hace falta el servidor remoto: se levanta en cualquier máquina con Docker.

```bash
git clone <este-repositorio> lattecoffe
cd lattecoffe

# 1. Plantilla de configuración
cp .env.example .env

# 2. Generar un secreto real y pegarlo en .env (campo DATABASE_JWT_SECRET)
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

# 3. Poner también la contraseña de las cuentas de demo en .env
#    (campo SEED_SYSTEM_ACCOUNTS_PASSWORD) — por ejemplo LatteCofee#2026
#    ⚠️ en .env va entrecomillado, porque lleva '#'

# 4. Comprobar que el compose es válido
docker compose config --quiet && echo OK

# 5. Construir la imagen
docker compose build

# 6. Crear el esquema y sembrar los datos de demostración
docker compose run --rm api npm run migrate:prod
docker compose run --rm api npm run seed:prod

# 7. Levantar
docker compose up -d api

# 8. Comprobar
curl -s http://localhost:3000/api/v1/health
curl -s http://localhost:3000/api/v1/menu | head -c 200
```

**Parar y borrar todo:**

```bash
docker compose down          # para los contenedores
docker compose down -v       # para los contenedores Y la base de datos
```

**Copiar la base de datos** (SQLite va en el volumen Docker `lattecoffe-api-data`):

```bash
docker run --rm -v lattecoffe-api-data:/data -v "$PWD":/out alpine \
  tar czf /out/lattecoffe-backup.tgz -C /data .
```

### Notas de la imagen (decisiones que se tomaron y por qué)

- **Imagen en dos etapas.** La primera instala todo (incluidas las dependencias de
  desarrollo) y compila TypeScript + el módulo nativo `better-sqlite3` con
  compilador. La segunda copia **sólo** el JavaScript compilado y las dependencias de
  producción. La imagen final no tiene ni compilador.
- **Trampa 1 — `npm run migrate` usa `tsx`, que es una dependencia de desarrollo.**
  Un `npm ci --omit=dev` rompería las migraciones. En la imagen **no se usa `tsx`**: el
  CLI de base de datos (`src/database/cli.ts`) es TypeScript normal, `tsc` lo compila a
  `dist/database/cli.js`, y las migraciones se ejecutan con `node` pelado
  (`npm run migrate:prod`). Por eso los scripts de producción son distintos de los de
  desarrollo. Comprobado dentro del contenedor:
  `docker exec lattecoffe-api npm run migrate` → `sh: 1: tsx: not found`.
- **Trampa 2 — `tsc` no copia los ficheros `.sql` a `dist/`,** y el migrador localiza la
  carpeta de migraciones probando rutas relativas. Eso es frágil dentro de un
  contenedor. Solución: los `.sql` se copian a una ruta fija (`/app/migrations`) y se
  fija la variable `MIGRATIONS_DIR=/app/migrations`, que es el override que el propio
  migrador respeta. Además se copia una segunda vez a la ruta que el sondeo encontraría,
  como red de seguridad. Reproducido: quitando `/app/src` y `/app/migrations` y sin
  `MIGRATIONS_DIR`, el migrador aborta con *"Defina MIGRATIONS_DIR…"*.
- **Usuario no root:** el proceso corre como `node` (uid 1000), nunca como root.
- **Persistencia:** la base de datos vive en el volumen Docker `lattecoffe-api-data`
  montado en `/data`, fuera del código. `docker compose down` no se la lleva;
  `docker compose down -v` sí (a propósito).
- **Apagado ordenado:** `tini` es el PID 1 para que Node reciba el `SIGTERM` y pueda
  drenar el HTTP y cerrar SQLite con `wal_checkpoint`. Sin init, el contenedor muere con
  la base a medio escribir.
- **Sonda de vida:** `HEALTHCHECK` contra `GET /api/v1/health`, con `--fail` para que un
  503 (base caída) cuente como fallo y no como "sano".
- **Falla rápido si la configuración es insegura:** antes de arrancar, el contenedor
  valida el secreto. En `APP_ENV=production` **aborta** (código de salida 78) si el
  secreto JWT es débil, y también si se intenta sembrar cuentas de sistema. La
  comprobación **no está reimplementada en el script**: el contenedor importa la función
  `isWeakSecret()` del propio backend, así que hay una sola definición de "secreto
  débil" en todo el sistema. Comprobado:

  ```
  $ docker run --rm -e APP_ENV=production \
      -e DATABASE_JWT_SECRET="changeme-secret-de-lattecoffe-demo-2026" \
      lattecoffe-api:1.0.0 true
  [lattecoffe] CONFIGURACION INVALIDA: DATABASE_JWT_SECRET es débil para
  APP_ENV=production. … El contenedor NO arranca.
  [lattecoffe] Preflight FALLIDO. El contenedor no arranca (exit 78).
  ```

---

## 8. Cómo reconstruir el APK (si el túnel cambia)

```bash
# Entorno (Java 25 rompe Gradle: hay que forzar el 17)
export PATH=$PATH:~/development/flutter/bin
export ANDROID_HOME=$HOME/Android/Sdk
export ANDROID_SDK_ROOT=$ANDROID_HOME
export JAVA_HOME=/usr/lib/jvm/java-17-amazon-corretto

cd frontend

# APK de release apuntando al túnel NUEVO
flutter build apk --release \
  --dart-define=API_BASE_URL=https://<la-url-nueva-del-tunel>/api/v1

# El resultado SIEMPRE se llama app-release.apk.
# El destino NO es entrega/ del repositorio: los APK ya no se versionan (ver .gitignore),
# van a la carpeta de entrega de al lado, que es donde se espera el instalable.
cp build/app/outputs/flutter-apk/app-release.apk \
   /home/arch-tarok/Escritorio/LatteCoffe-ENTREGA/LatteCoffee-release.apk

# Comprobar que la URL correcta quedó dentro
cd /tmp && rm -rf verif && mkdir verif && cd verif
unzip -o -q -j /home/arch-tarok/Escritorio/LatteCoffe-ENTREGA/LatteCoffee-release.apk 'lib/*/libapp.so'
strings lib/arm64-v8a/libapp.so | grep -E 'trycloudflare|localhost:3000'

# Actualizar la suma
cd /home/arch-tarok/Escritorio/LatteCoffe-ENTREGA
sha256sum LatteCoffee-release.apk LatteCoffee-local.apk > SHA256SUMS.txt
```

Tarda unos 100 segundos por APK.

Para el APK local (el que usa `adb reverse`):

```bash
flutter build apk --release --dart-define=API_BASE_URL=http://localhost:3000/api/v1
cp build/app/outputs/flutter-apk/app-release.apk \
   /home/arch-tarok/Escritorio/LatteCoffe-ENTREGA/LatteCoffee-local.apk
```

Y para usarlo con `adb reverse`:

```bash
# El backend tiene que estar escuchando en el puerto 3000 de ESTE computador
curl -s http://localhost:3000/api/v1/health

adb reverse tcp:3000 tcp:3000    # el localhost del teléfono -> localhost del computador
adb reverse --list              # debe mostrar: tcp:3000 tcp:3000
adb install -r /home/arch-tarok/Escritorio/LatteCoffe-ENTREGA/LatteCoffee-local.apk
```

### Decisión de seguridad: tráfico en claro

Un agente anterior había puesto `android:usesCleartextTraffic="true"` en el manifiesto
principal, para que la app pudiera hablar con un backend en `http://`. **Se ha cambiado.**

La app entregada al instructor habla con un túnel **HTTPS**, así que **no necesita
tráfico en claro**. Permitirlo globalmente dejaría la app —y con ella todos los tokens
de sesión— expuesta a cualquier sniffing en una red Wi-Fi ajena. Lo que hay ahora en
`frontend/android/app/src/main/res/xml/network_security_config.xml` es:

- **prohibido** el tráfico en claro **por defecto**, para cualquier host;
- **permitido sólo** contra `localhost`, `127.0.0.1` y `10.0.2.2`.

Es una **lista blanca mínima**, no un interruptor general, y aplica igual a los dos APK
porque el fichero está en `src/main/res`. Así:

- `LatteCoffee-release.apk` (túnel `https://…`) → **sólo TLS**.
- `LatteCoffee-local.apk` (`adb reverse` a `http://localhost:3000`) → funciona, porque
  `localhost` está en la lista.

El manifiesto además lleva `android.permission.INTERNET` en `src/main/` (no sólo en
`debug`): el template de Flutter lo deja únicamente en los build types de desarrollo, y
un APK de release sin ese permiso no puede hacer **ninguna** petición HTTP.

---

## 9. Qué se verificó, y cómo

| Qué | Resultado |
|---|---|
| `docker compose config` | válido |
| `docker build` (imagen multi-stage) | correcto, 28 pasos |
| Contenedor en `TuDeliDatabase` | `Up (healthy)` |
| `GET /api/v1/health` | `200`, `status: ok`, `migrationsPending: 0` |
| `GET /api/v1/menu` | `200`, **6 categorías / 24 productos** |
| Migraciones dentro del contenedor | 3 en disco, 3 aplicadas, 0 pendientes |
| Login de las 5 cuentas | `200` en las cinco |
| APK release instalado en teléfono real | arranca, login, catálogo real, alquiler, ampliar, terminar |
| APK local con `adb reverse` | arranca, login, catálogo real |
| `flutter analyze` | **0 errores** (sólo `info`/`warning` de estilo, no fatales) |
| `flutter test` | **209 tests, todos verdes** |
| `npm test` (backend) | **636 tests, todos verdes** |
| `npm run typecheck` (backend) | **0 errores** |

---

## 10. Limitaciones y bugs conocidos (sin adornos)

### Bugs reales encontrados al probar — **arreglados** en esta entrega

Estos dos fallos se encontraron probando la app en un teléfono real. **Los dos están
arreglados**, y **los APK de esta entrega ya llevan los arreglos** (§2): no hace falta
ningún rodeo para la demostración de clase.

1. **El botón "Cobrar alquiler" del POS dejaba el alquiler abierto.** *(arreglado)*
   El flujo creaba el pedido `CHAIR_RENTAL`, lo cobraba y lo marcaba `COMPLETED`, pero
   el alquiler quedaba `ACTIVE` y la silla `OCCUPIED`. La causa estaba en el
   **backend**: el cierre de alquiler al completar el pedido (BR-ORDER-015) se saltaba
   porque el auto-completado por pago escribía el estado con un `UPDATE` directo.
   **Arreglado** en el backend con un único punto de liquidación
   (`OrderSessionSettlement` / `closeLiveRental`) del que cuelgan las tres puertas de
   cierre: manual, check-out de reserva y autocompletado por cobro. Commit `381ee4c`.
2. **El botón "Cobrar alquiler" no hacía nada con el carrito vacío.** *(arreglado)*
   El flujo se cortaba en dos sitios cuando el carrito estaba vacío, aunque un pedido de
   alquiler **no lleva** líneas de producto (BR-ORDER-012) — el backend prohíbe
   mezclarlas con `422 MIXED_ORDER_TYPE_NOT_ALLOWED`, así que el flujo correcto de
   alquiler **siempre** tiene el carrito vacío. El panel habilitaba el botón y el flujo
   lo mataba: botón visible que no hacía nada.
   **Arreglado** con un veredicto único compartido (`posChargeGateProvider`): el panel, la
   pantalla y el flujo leen la misma decisión, así que no pueden discrepar; y cuando no
   se puede cobrar, la app **explica por qué** en vez de volver en silencio.

### Limitaciones del diseño

3. **La URL del túnel es temporal.** El APK de release deja de servir en cuanto el
   túnel se levanta de nuevo. Hay que reconstruirlo (§8). Es la limitación más
   importante de esta entrega.
4. **La clave de firma está en el repositorio y escrita en este documento.** Es una
   clave de demostración. No sirve para publicar en Play Store.
5. **Las cuentas de prueba comparten contraseña.** Cualquiera que lea este documento
   puede entrar como `owner`. En producción hay que crear el primer usuario a mano
   (`APP_ENV=production` desactiva la siembra y lo obliga).
6. **Los pagos son un simulacro.** `PAYMENT_PROVIDER=MOCK`: no se toca ninguna pasarela
   real y la app no cobra nada. El dinero se paga en el mostrador.
7. **El catálogo tiene 24 productos y las 25 sillas son fijas.** No hay carga de
   imágenes: las "fotos" de los productos son las iniciales sobre un color.
8. **Los datos de la demostración se pueden ensuciar** si la clase prueba mucho. Para
   volver a empezar desde cero hay que rehacer el `seed` (§7). No hay botón de "borrar
   todo" en la app, y es a propósito.
9. **El backend es monoinstancia con SQLite.** Aguanta bien una clase, pero no es un
   diseño para varias instancias a la vez. SQLite en un volumen de Docker tampoco es
   un sustituto de un servidor de base de datos.
10. **No hay notificaciones push.** La app avisa dentro de la sesión; no llegan SMS ni
    notificaciones a segundo plano.
11. **El horario del negocio marca "Cerrado"** porque la fecha de la demostración es un
    martes y la cafetería abre los miércoles. No afecta al funcionamiento: el sistema
    no bloquea pedidos ni alquileres por horario.

---

## 11. Qué hay en esta carpeta

Lo que sigue es el contenido de la **carpeta de entrega**,
`LatteCoffe-ENTREGA/`, que está **fuera** del repositorio. Lo único que de esto se
versiona es `LEEME.md`, `SHA256SUMS.txt` y `capturas/`.

```
LatteCoffe-ENTREGA/                       (fuera del repositorio)
├── LEEME.md                              este documento (copia idéntica a entrega/LEEME.md)
├── LatteCoffee-release.apk               el que se instala en clase (túnel HTTPS)
├── LatteCoffee-local.apk                 el de `adb reverse` (localhost)
├── SHA256SUMS.txt                        sumas de verificación de los APK
├── capturas/                             evidencia real, en un Motorola Edge 60 (Android 16)
│   ├── 01-login-como-cajero.png            login
│   ├── 02-catalogo-real-del-backend.png   inicio con el catálogo del servidor
│   ├── 03-categorias-con-conteos.png      los 6 chips de categoría con sus conteos
│   ├── 04-mapa-25-sillas.png              mapa del local: 5 zonas, 25 sillas
│   ├── 05-alquiler-activo-RENT-900007.png alquiler en curso (RENT-900007)
│   ├── 06-alquiler-ampliado-30min.png      alquiler ampliado 30 minutos
│   ├── 07-alquiler-terminado-…png         alquiler terminado, silla en limpieza
│   ├── 08-silla-vuelta-a-disponible.png    la misma silla, liberada
│   ├── 09-apk-local-con-adb-reverse.png    el APK local funcionando con adb reverse
│   ├── 10-release-sin-reverse-4g.png       el APK de release por 4G, sin cables
│   ├── 11-perfil-rol-cajero.png            perfil del cajero
│   ├── 12-pos-cajero.png                   el tablero del mostrador
│   ├── 13-pos-alquiler-abierto.png         alquiler abierto desde el POS
│   ├── 14-pos-cobro-alquiler.png           diálogo de cobro del alquiler
│   └── 15-pos-cobro-registrado.png         "Cobro registrado", pedido ORD-900020
└── (el resto del proyecto está en el repositorio:
     backend/, frontend/, docs/, docker-compose.yml, .env.example)

Y en el repositorio, junto a este documento, queda sólo la evidencia:

```
entrega/
├── LEEME.md                              este documento
├── SHA256SUMS.txt                        sumas de verificación de los APK
├── capturas/                             las mismas 15 capturas
└── (los dos APK NO están: 28 MB cada uno; se reconstruyen con §8
     y se entregan en LatteCoffe-ENTREGA/)
```

---

## 12. Resumen para la evaluación

- La app **arranca, hace login y carga el catálogo real** desde un backend en Docker
  desplegado en otro servidor, a través de internet, sin cables.
- Se **reserva** una silla, se **alquila**, se **amplía** y se **termina con cobro**,
  todo desde el teléfono y con el estado sincronizado con la base de datos: comprobado
  mirando la API por `curl` mientras la app estaba en pantalla.
- Las **reglas de negocio están implementadas y comprobadas**: permisos por rol (403),
  solapamiento de sillas (409), transiciones de estado, precio con impuestos.
- Los **636 tests del backend**, los **209 del frontend** y el **análisis estático sin
  errores** pasan.
- Todo lo que hay aquí **se ha ejecutado de verdad**: no hay capturas de una maqueta ni
  salidas inventadas. Los dos bugs de §10 son reales, **están arreglados** y se cuentan
  tal cual: qué pasaba, por qué, y qué se tocó.
