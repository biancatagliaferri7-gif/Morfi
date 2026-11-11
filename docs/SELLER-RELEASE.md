# Registro emprendedor, horarios y avisos de MORFI

## Qué cambia

La rama `codex/registro-vendedor` parte de `main ac9a14c` y conserva la integración de Bianca. El cliente se registra en `/register`; el emprendedor usa `/register/emprendedor`. El asistente guarda un borrador privado desde que existe la cuenta y finaliza el comercio, su membresía y sus horarios en una transacción idempotente. La contraseña solo permanece en memoria durante el envío a Auth.

Al terminar se abre Mis productos con «¿Qué vendés?». El primer producto habilita «Publicar mi comercio». Los comercios nuevos permanecen ocultos hasta esa acción. El panel permite pausar, reactivar, abrir excepcionalmente y agregar sucursales. Datos, horarios y notificaciones quedan en configuración secundaria. Los comercios anteriores conservan su modo manual hasta guardar horarios.

Efectivo siempre está disponible. La transferencia pide banco o billetera, alias, titular y CUIT/CUIL; el servidor normaliza sus once números. Las opciones históricas se muestran mediante «Otro». Las existencias siguen siendo opcionales y las ventas nuevas no descuentan inventario.

## Contratos del servidor

| Operación | Quién puede usarla |
| --- | --- |
| `morfi_save_seller_identity` | Titular autenticado; DNI único |
| `morfi_get_seller_draft`, `morfi_save_seller_draft` | Titular; propietario para sucursales |
| `morfi_complete_seller_setup` | Titular del borrador; resultado estable ante reintentos |
| `morfi_managed_availability`, `morfi_save_business_hours`, `morfi_set_order_reception` | Propietario o administrador |
| `morfi_public_business_availability` | Visitantes; solo comercios publicados |
| `morfi_register_push`, `morfi_revoke_push` | Vendedor y su dispositivo; sesión vigente |
| `morfi_claim_push_deliveries`, `morfi_finish_push_delivery` | Solo servidor con service role |

PostgreSQL calcula disponibilidad con `America/Argentina/La_Rioja`; el frontend solo presenta el resultado. Un trigger comprueba disponibilidad al insertar pedidos desde cualquiera de las versiones de checkout. El catálogo vuelve a consultar cada 30 segundos y al regresar a la pestaña; confirmar una compra siempre pasa por la comprobación del servidor.

Las pausas de comercios programados vencen en el próximo tramo. Las aperturas excepcionales vencen en el próximo límite de apertura/cierre. Los horarios que cruzan medianoche se admiten; los tramos superpuestos, incluidos domingo/lunes, se rechazan. El modo manual heredado requiere reactivación manual hasta configurar horarios.

## Estado y evidencia del 11 de noviembre de 2026

**Implementado:** registros separados, asistente, borradores, sucursales, horarios, controles manuales, pagos, panel, Web Push, cola transaccional, registro de cada intento y worker protegido. No requiere SMTP para los avisos.

**Verificado localmente:** pruebas PostgreSQL/PGlite de privacidad, idempotencia, horarios, banco y cola; validaciones puras; recorridos Playwright en 360 px, GPS rechazado, coordenadas por teclado, transferencia con Otro, texto al 200 %, reanudación tras recarga, respuesta perdida, pausa y sucursal; compilación PWA y cifrado Web Push en Deno.

La prueba del service worker usa un evento push sintético y reemplaza la presentación de la notificación: comprueba contenido genérico, deduplicación, aislamiento de usuario, caché sin API ni sesiones y navegación sin conexión. **No acredita entrega a un celular real.**

**Verificado en MORFI real, con autorización expresa para usar sus datos demo:** lectura del esquema y triggers; aplicación de las migraciones nuevas; las ocho comprobaciones de `seller-release-verify.sql` devuelven true. Una prueba con dos cuentas demo confirmó borrador en otra sesión, alta idempotente, privacidad frente al comprador, compra con stock cero y total $200, lectura desde otra sesión vendedora, rechazo de compra durante pausa y sucursal sin productos. El pedido **#4** quedó rechazado como fin de prueba y el stock permaneció en cero. El comercio demo quedó oculto; su sucursal nunca fue publicada. No se enviaron mensajes de WhatsApp.

Se usó el proyecto publicado `upsmoqivykcgvhhopckf` porque el usuario autorizó expresamente ensayos allí y confirmó que todo su contenido es demo. La suite automática predeterminada continúa aislada. El conector conserva otra organización; no usar sus proyectos de cierre de caja para MORFI. El usuario autenticó la CLI con acceso a MORFI para desplegar la función y configurar Vault/cron.

**Verificado en servicios:** `order-push` desplegado en MORFI, secretos en Edge/Vault, pg_net y pg_cron habilitados, aviso de nuevos eventos y trabajo de reintento cada minuto activo. Invocación sin secreto: HTTP 401; con secreto: HTTP 200 (`processed: 0`, cola sin dispositivos).

**Pendiente hasta registrarse nueva evidencia:** frontend Ready en Vercel, avisos reales en Android/iOS/escritorio, actualización desde una PWA anterior instalada, prueba física entre dispositivos, lector de pantalla y validación con cinco personas (objetivo 4/5). No marcar estas actividades como terminadas por pasar las pruebas simuladas.

## Cómo verificar el código

Desde la raíz del repositorio:

```powershell
npm ci
npx playwright install chromium
npm test
npm run build
npm run test:e2e
npm run test:pwa
npm run test:edge
```

Playwright de registro usa `morfi-test.invalid` y respuestas preparadas. El ensayo PWA abre exclusivamente un servidor local; no crea cuentas ni pedidos. Deno cifra una solicitud con claves temporales y fetch sustituido, sin contactar dispositivos.

Para repetir una prueba real hace falta autorización para ese proyecto. Configurar las dos variables **públicas** en la terminal y ejecutar explícitamente:

```powershell
node scripts/verify-demo-release.mjs --project-ref REFERENCIA_DEL_PROYECTO --allow-demo-writes
```

El script se niega a trabajar si la referencia no coincide con `VITE_SUPABASE_URL` o falta la autorización explícita. Crea cuentas y registros identificados como demo, oculta su comercio al terminar y conserva sus pedidos como evidencia. No guarda contraseñas ni tokens. El informe local se escribe en `.morfi-evidence.local/demo-release.json`, ignorado por Git.

## Migraciones

No ejecutar todas las variantes SQL históricas de la raíz. `docs/PILOT-RELEASE.md` identifica la base existente y los pasos anteriores. Para una base nueva, reproducir primero ese esquema en el proyecto de ensayo y resolver sus prerrequisitos; estas migraciones incrementales no crean toda la plataforma desde cero.

1. Ejecutar `supabase/seller-preflight.sql` como lectura y comparar columnas, firmas, triggers y políticas.
2. Ejecutar completo `supabase/migrations/20261111195426_seller_setup_and_hours.sql`.
3. Ejecutar completo `supabase/migrations/20261111200951_order_push_notifications.sql`.
4. Ejecutar `supabase/migrations/20261111210516_seller_hours_boundary_validation.sql` (usar `00:00` para medianoche).
5. Ejecutar `supabase/migrations/20261111211140_seller_manual_pause_guard.sql` (la configuración de cobro no reabre comercios pausados).
6. Ejecutar `supabase/seller-release-verify.sql`: todos los resultados deben ser true.
7. Recorrer el alta y los pedidos con cuentas preparadas para ese ensayo.

Las migraciones ya fueron aplicadas al proyecto MORFI demo el 11/11. No es necesario repetirlas para desplegar el frontend. Las migraciones realizadas mediante SQL Editor deben registrarse/reconciliarse antes de introducir `supabase db push`; no reinicializar la base ni afirmar que la CLI conoce automáticamente las ejecuciones manuales.

## Activar el servidor de avisos

La función está en `supabase/functions/order-push`, con biblioteca fijada a `@negrel/webpush@0.5.0` y lockfile Deno. Cada pedido nuevo crea el evento y sus entregas en la misma transacción. El worker toma lotes de 25 con bloqueo y lease, registra intentos, reintenta errores temporales y desactiva endpoints 404/410. Nunca envía datos personales ni bancarios al bloqueo de pantalla.

1. Autenticar una CLI que tenga acceso a MORFI. Usar la cuenta con acceso a MORFI:

```powershell
npx --yes supabase@2.81.3 login
```

2. Generar claves distintas para cada entorno:

```powershell
node scripts/generate-push-keys.mjs
```

El comando informa la ruta de un JSON y un archivo `.env` dentro de `.morfi-secrets.local`, ignorado por Git. No publicar ni adjuntar esos archivos. El JSON contiene la clave **pública** que corresponde al frontend; el `.env` solo contiene secretos del servidor.

3. Sustituir la referencia y la ruta por las del entorno correcto:

```powershell
npx --yes supabase@2.81.3 secrets set --project-ref REFERENCIA --env-file .morfi-secrets.local/push-FECHA.env
npx --yes supabase@2.81.3 functions deploy order-push --project-ref REFERENCIA --use-api
```

La configuración `verify_jwt=false` se usa porque el webhook emplea `x-morfi-worker-secret`, validado por la función antes de leer datos. Una invocación sin ese secreto debe devolver 401. El service role provisto por Supabase solo se usa dentro de Edge Functions; jamás copiarlo a Vercel ni al navegador.

4. En Database → Extensions del proyecto, habilitar `pg_net` y `pg_cron` si faltan. En Vault crear dos secretos: `morfi_push_worker_url` con `https://REFERENCIA.supabase.co/functions/v1/order-push`; `morfi_push_worker_secret` con el mismo valor de `MORFI_PUSH_WORKER_SECRET` del archivo privado. No pegar secretos en consultas guardadas o en el chat.
5. Ejecutar `supabase/push-runtime-setup.sql`. Configura el aviso del nuevo evento y el trabajo `morfi-order-push-retry` cada minuto. `pg_net` procesa las solicitudes después del commit. Si el aviso falla, el pedido queda guardado y la cola permite reintento.
6. Verificar en Functions → Logs invocaciones exitosas; en SQL revisar estado y resultado de `morfi_order_push_deliveries` y `morfi_push_delivery_attempts`, sin exportar endpoints ni claves. Probar un pedido nuevo, no uno histórico.

## Vercel y comprobación final

En el entorno que se despliega conservar `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` y `VITE_MORFI_ORDER_CHECKOUT_V2=true`. Agregar solo `VITE_VAPID_PUBLIC_KEY` con la clave pública correspondiente. Las claves privadas y el secreto del worker pertenecen a Supabase. Redeployar: Vite incorpora variables durante la compilación.

Primero preparar un Preview con backend identificado; después publicar el mismo código en producción y comprobar commit, estado Ready y dominio `morfi-ten.vercel.app`. Si el backend demo compartido se usa también para Preview, no activar allí avisos contra dispositivos reales de producción; separar claves y suscripciones cuando exista un entorno independiente.

En cada dispositivo vendedor: ingresar, Configuración del comercio → Notificaciones → Activar avisos de pedidos. En iPhone/iPad instalar primero en pantalla de inicio. El sonido se habilita voluntariamente y puede necesitar una interacción después de recargar. La entrega depende de permisos, red y restricciones del sistema.

Comprobar compra en otro dispositivo, aparición del pedido, pausa y apertura, notificación en primer plano/segundo plano/app cerrada, permiso bloqueado, cierre de sesión y cambio de cuenta. Confirmar que el dispositivo anterior no muestra información de la cuenta anterior.

Sin red la PWA abre sus pantallas y conserva imágenes públicas visitadas; registrar cuentas, guardar borradores, consultar pedidos y comprar requieren conexión. No presentar el modo sin conexión como confirmación de una compra.

## Incidencias y reversión

Si falla el frontend, volver en Vercel al despliegue anterior mientras se investiga; las migraciones conservan los contratos antiguos. No borrar tablas ni pedidos para revertir la interfaz. Si falla push, desactivar temporalmente su cron/webhook y mantener la cola para diagnóstico; el pedido funciona sin ese servicio.

La compilación informa un chunk de MapLibre mayor a 500 KB, cargado a demanda, y una deprecación de configuración interna del plugin PWA. `npm audit` conserva cuatro avisos de severidad baja en dependencias de desarrollo relacionadas con deepmerge; la corrección sugerida implica cambiar la versión mayor del plugin y necesita una actualización separada. No aplicar `npm audit fix --force` durante esta entrega.

La recuperación de contraseñas sigue necesitando un proveedor de correo funcional para destinatarios externos, aunque el piloto no exija confirmar correos nuevos. Este cambio no incorpora otro método de acceso ni un proveedor SMTP.
