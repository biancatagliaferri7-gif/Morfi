# Diagnóstico técnico y operativo de MORFI

Revisión de integración del 8 de noviembre de 2026. Base funcional y visual: `feature/bianca`, commit `22d1208fba73433a6e83035eeafee99db59af627`. Esta revisión reemplaza el diagnóstico anterior, elaborado sobre un `main` que no incluía los siete últimos commits de Bianca. Las consultas públicas antiguas no acreditan la compatibilidad de la base publicada con esta integración.

## Estado de los flujos

| Flujo | Estado | Evidencia reproducible | Límite |
| --- | --- | --- | --- |
| Home y navegación | Recuperado; revisión visual pendiente | Home, CSS, logo, portada, footer institucional y `vercel.json` proceden de Bianca | No se validó en navegador real |
| Registro y recuperación | Implementado; validación real pendiente | Auth conserva confirmación `/auth/callback`, reenvío de correo y recuperación; el registro rápido permite diferir el comercio | Requiere la nueva conciliación y redirect URLs correctas |
| Catálogo y reseñas | Implementado; validación real pendiente | `publicCatalogService.ts` conserva coordenadas, reseñas y compatibilidad con checkout de Bianca | Hay consultas de contactos por comercio; optimización adicional pendiente |
| Pedidos | Implementado; validación real pendiente | `createMealOrder` usa clave idempotente y RPC existente o v2 según flag | Comprobar versión instalada antes de activar `VITE_MORFI_ORDER_CHECKOUT_V2` |
| Entrega y transferencias | Implementado; validación real pendiente | Se mantienen cotización, snapshots, motivos de estado y revisión de transferencia de Bianca | Deben probarse los importes y estados entre dos cuentas |
| Sincronización | Implementado; validación real pendiente | Realtime existente más consulta cada 30 segundos con pestaña visible y red | Realtime depende de publicación de tablas y configuración del proyecto |
| Configuración comercial | Probada parcialmente en PostgreSQL local | La RPC privada exige owner/manager; panel permite apertura, modalidades, tarifa y medios de pago | Probar RLS y guardado real en Supabase |
| Stock | Probado parcialmente en PostgreSQL local | Test comprueba edición propia, rechazo de stock negativo y aislamiento | Reservas, concurrencia y devoluciones necesitan prueba con RPCs reales |
| Fotos de producto | Implementado; validación real pendiente | Fotos nuevas se suben a `morfi-catalog/businesses/{id}/products/` como archivos | Imágenes base64 heredadas no se migraron; falta prueba de Storage |
| Costos, recetas y producción | Local | `BusinessWorkflow` y calculadora usan almacenamiento del navegador por cuenta | No hay sincronización de estas herramientas entre dispositivos |
| Ahorro y Mercado | Código existente conservado | Se preservan servicios y migraciones de Bianca | Bianca retiró Ahorro de la navegación; la ruta sigue existiendo |
| PWA | Compilable; instalación real pendiente | Iconos PNG de Bianca y caché de imágenes públicas; sin caché de respuestas privadas | Falta probar instalación, actualización, red lenta y offline en teléfonos |

## Integración realizada

- Recuperados todos los archivos de Bianca, incluidos mapa, confirmación de correo, checkout con cotización, reseñas e imágenes.
- Conservados pruebas, documentación, dependencia `tsx`, eliminación de `supabase-js` no usado y caché PWA de nuestro trabajo.
- Adaptada la configuración comercial a `payment_methods text[]` del comercio y al `delivery_fee_status` del checkout. `payment_method` es el alias usado por algunas RPC; los productos también mantienen `payment_methods`.
- Recuperada la carga de stock y fotos a Storage; los productos vinculados a recetas conservan el inventario de esa receta.
- Registro rápido con nombre, correo y contraseña; configuración completa de Bianca disponible como opción. La migración acepta el registro diferido y preserva el alta completa con pagos.
- La conciliación ya no reemplaza vistas de Bianca ni agrega snapshots alternativos. Sus datos de contacto y bancarios siguen protegidos; la nueva RPC privada comprueba pertenencia.
- Se agrega PostgreSQL local de prueba para ejecutar la conciliación y comprobar permisos y ambas variantes del registro. Ese entorno mínimo no es una copia de producción.

## Lo que falta antes de publicar

Seguir `PILOT-RELEASE.md`: verificar esquema instalado, ejecutar la conciliación revisada, confirmar flag de checkout y URLs de Auth, luego probar comprador/vendedor/tercero en la base existente. No se aplicó SQL ni se modificó Vercel desde esta integración.

La aplicación no se considera validada para pedidos reales solo porque compile. Deben completarse aislamiento, stock, doble toque, reintento, sesión vencida, teléfono compartido, correos y recorrido en móvil. Probar con cinco personas del público objetivo; objetivo: cuatro completan su recorrido sin ayuda.
