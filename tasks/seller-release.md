# Registro vendedor, horarios y avisos

Base: main ac9a14c; rama codex/registro-vendedor. Versión de Bianca conservada.

## Implementado y verificado

- [x] Esquema y RPC de borradores, finalización idempotente, horarios y sucursales.
- [x] Registro cliente separado y asistente vendedor reanudable de cuatro pasos.
- [x] Panel simple, disponibilidad, sucursales y configuración compartida.
- [x] Web Push: service worker, suscripciones privadas, cola, intentos y worker protegido.
- [x] Pruebas PostgreSQL aisladas, validaciones, Playwright, Deno y compilación.
- [x] Lectura del esquema real de MORFI y comparación con contratos.
- [x] Migraciones aplicadas y ocho controles de permisos true en MORFI demo.
- [x] Prueba real autorizada: dos cuentas, dos sesiones vendedoras, pedido #4 sin stock, idempotencia, pausa, privacidad, sucursal, historial y rechazo sin inventario ficticio. Comercio demo oculto al finalizar.

## Pendiente de servicios o personas

- [x] Worker desplegado, secretos/Vault, webhook y reintento cada minuto activos. HTTP 401 sin secreto y 200 con autorización.
- [x] Aviso real Windows 11/Chrome del pedido DEMO #7: entrega `sent` en Supabase y recepción confirmada por el vendedor. Pedidos demo #6 y #7 cancelados tras la prueba.
- [x] PR #3 integrada; commit funcional 9cb4df0 Production Ready, dominio público y VAPID verificados. Preview configurado con el mismo backend demo autorizado.
- [x] Historial remoto de cuatro migraciones conciliado con CLI; lint SQL sin errores.
- [ ] Prueba física entre dispositivos, Android/iOS, Chrome con PWA cerrada/en segundo plano y cambio de usuario.
- [ ] Actualización desde la PWA anterior instalada y lector de pantalla.
- [ ] Cinco personas del público objetivo; al menos 4/5 completan las tareas.

El usuario autorizó expresamente usar `upsmoqivykcgvhhopckf` para registros y pedidos demo. La suite automática predeterminada continúa aislada. El proyecto suministrado es el publicado; no se identificó otro entorno. El conector pertenece a otra organización. La CLI quedó autenticada con acceso de Bianca; función y servicios de avisos desplegados.

Ver instrucciones, limitaciones y evidencia en `docs/SELLER-RELEASE.md`. No confundir envío cifrado simulado con una notificación recibida en un dispositivo real.
