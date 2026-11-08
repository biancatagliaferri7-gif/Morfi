# Backlog de correcciones para el piloto

## P0 — antes de invitar comercios

| Trabajo | Dependencia | Aceptación |
| --- | --- | --- |
| Aplicar y verificar migración de conciliación en staging | Acceso administrativo a Supabase | La migración termina sin error; Comidas y Mercado siguen visibles; contactos privados no se leen con clave pública |
| Prueba de pedidos entre dos cuentas | P0 anterior | Un pedido aparece para el vendedor después de recargar; cada transición permitida llega al comprador; no se duplica al reintentar |
| Crear y editar stock inicial | Migración aplicada | Vendedor carga stock; pedido descuenta; rechazo o cancelación lo devuelve una única vez |
| Configurar variables de despliegue | Proyecto Supabase y hosting | El build publicado usa `VITE_SUPABASE_URL` sin `/rest/v1/` y una publishable key; no contiene claves secretas |
| Controlar publicación operativa | Configuración de comercio | Un comercio cerrado o pausado no acepta pedidos; el checkout muestra solo retiro, entrega y pagos realmente habilitados |

## P1 — durante el piloto controlado

| Trabajo | Dependencia | Aceptación |
| --- | --- | --- |
| Actualización de pedidos en tiempo real o refresco visible | Implementado; requiere prueba P0 | Cliente y vendedor consultan pedidos cada 30 segundos; el panel vendedor también ofrece “Actualizar pedidos” |
| Configuración simple de comercio | Implementado; requiere prueba P0 | Nombre, abierto, retiro, entrega, tarifa, alias, titular y contacto público se editan desde el panel |
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
