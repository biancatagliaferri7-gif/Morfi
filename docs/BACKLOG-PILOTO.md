# Backlog de correcciones para el piloto

Revisado sobre Bianca `22d1208`. Seguir `PILOT-RELEASE.md` para migraciones y configuración; no usar el instructivo anterior basado solo en `main`.

## P0 — antes de invitar comercios

| Trabajo | Dependencia | Aceptación |
| --- | --- | --- |
| Verificar esquema de Bianca y aplicar conciliación revisada | Acceso administrativo a Supabase | Precondiciones y verificación de checkout pasan; registro rápido y completo funcionan; la RPC privada rechaza cuentas ajenas |
| Prueba de pedidos entre dos cuentas | P0 anterior | Un pedido aparece para el vendedor después de recargar; cada transición permitida llega al comprador; no se duplica al reintentar |
| Crear y editar stock inicial | Migración aplicada | Vendedor carga stock; pedido descuenta; rechazo o cancelación lo devuelve una única vez |
| Configurar variables y Auth | Proyecto Supabase y hosting | URL base, clave pública y flag de checkout coinciden con la base; `/auth/callback` y recuperación funcionan |
| Controlar publicación operativa | Configuración de comercio | Un comercio cerrado o pausado no acepta pedidos; el checkout muestra solo retiro, entrega y pagos realmente habilitados |

## P1 — durante el piloto controlado

| Trabajo | Dependencia | Aceptación |
| --- | --- | --- |
| Actualización de pedidos en tiempo real o refresco visible | Implementado; requiere prueba P0 | Realtime y consulta de respaldo cada 30 segundos con pestaña visible mantienen estados entre dispositivos |
| Configuración simple de comercio | Implementado; requiere prueba P0 | Apertura, retiro, entrega, cotización/tarifa, pagos y consentimiento de teléfono se guardan; se conservan mapa y banco de Bianca |
| Migrar costos, recetas y producción a Supabase | Modelo de negocio validado | La misma cuenta ve sus datos desde dos dispositivos; producción y pedidos ajustan stock con RPCs |
| Reducir peso de imágenes heredadas | Inventario de filas con base64 | Las imágenes se almacenan en Storage y el catálogo deja de transferir datos inline pesados |
| Auditoría de accesibilidad móvil | Dispositivo físico | Texto ampliado, foco de teclado, nombres de botones y áreas táctiles se verifican con casos reales |

## P2 — después de validar la operación

| Trabajo | Dependencia | Aceptación |
| --- | --- | --- |
| Checkout para Mercado | Modelo de pedido de proveedores | El pedido contiene reglas propias de proveedor, no reutiliza sin cambios la orden gastronómica |
| Google o acceso por teléfono | Decisión de producto y proveedor | Se mide alta, recuperación, costo y entrega antes de habilitarlo a usuarios |
| Cobro integrado y logística | Acuerdos comerciales y legales | Pagos, conciliación, repartidores y soporte se diseñan como un proyecto separado |
| Observabilidad | Flujo estable | Se registran errores de auth, checkout y RPC sin datos personales innecesarios |
