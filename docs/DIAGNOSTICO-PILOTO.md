# Diagnóstico técnico y operativo de MORFI

Actualizado: 2026-11-07. Este documento registra el estado verificable del repositorio y de las consultas públicas al proyecto Supabase de MORFI. No reemplaza las pruebas autenticadas en staging.

## Estado de los flujos

| Flujo | Estado | Evidencia | Límite actual |
| --- | --- | --- | --- |
| Catálogo de Comidas | Conectado y probado | Consultas públicas devuelven emprendimiento y productos publicados | Requiere imágenes en Storage para evitar filas pesadas |
| Mercado | Conectado y probado | La vista `morfi_public_market_catalog` responde en la base real | Faltaba en las migraciones; queda conciliada |
| Registro por correo | Implementado sin probar | Usa Supabase Auth, confirmación de correo habilitada | Probar alta, confirmación y recuperación en staging |
| Pedido de Comidas | Implementado sin probar | Frontend llama a `morfi_create_order` con clave idempotente | Aplicar la migración de conciliación y probar con dos cuentas |
| Panel vendedor | Implementado sin probar | Lista pedidos, se actualiza cada 30 segundos y llama a `morfi_update_order_status` | Requiere el contacto instantáneo agregado a `morfi_orders` |
| Stock | Implementado sin probar | La función SQL bloquea producto/receta y descuenta en transacción | Debe probarse simultaneidad y reversión de rechazo/cancelación |
| Costos, recetas y producción | Simulado | Persisten en `localStorage` | No sincronizan entre dispositivos todavía |
| Historial de pedidos de Comidas | Implementado sin probar | El cliente consulta `morfi_orders` filtrado por su propia cuenta | Requiere prueba autenticada en staging |
| Compra en Mercado | Incompleto | Muestra ofertas y contacto | El piloto coordina estas compras con el proveedor, no por checkout |
| Acceso con Google o teléfono | Bloqueado | Ambos proveedores están deshabilitados en Supabase | No se habilitan sin configuración externa y prueba de costos/entrega |
| PWA y revisión visual | Implementado sin probar | El build genera manifiesto, actualización automática, shell offline e imágenes públicas de catálogo cacheadas por hasta siete días | Pedidos, sesión y catálogo actualizado requieren red; falta prueba en teléfonos, red lenta e instalación real |

## Hallazgos corregidos en el repositorio

- Se eliminó el parámetro duplicado de `morfi_create_order`.
- Se alinearon la migración base y una migración de conciliación con `show_in_market` y `morfi_public_market_catalog`.
- La conciliación restringe la lectura anónima directa a las columnas públicas del catálogo. Los contactos publicados continúan expuestos solo mediante las RPC de consentimiento.
- El checkout deja de inventar un envío fijo: utiliza la tarifa, entrega, retiro y medios de pago que devuelve cada comercio.
- El checkout usa una clave idempotente estable por intento, por lo que un reintento no debe duplicar el pedido.
- Las fotos nuevas de productos se suben al bucket `morfi-catalog`; no se guardan como datos base64 en la fila.
- El catálogo de Comidas usa la vista pública para reunir comercio y producto en una sola consulta; los contactos todavía se consultan por comercio para respetar el consentimiento.
- La PWA nunca guarda respuestas de pedidos, perfiles o autenticación. Solo conserva recursos estáticos y fotografías públicas del catálogo.

## Riesgos y verificaciones obligatorias

1. Aplicar `morfi_reconciliation_migration.sql` primero en staging. No aplicarla en producción sin la prueba de dos cuentas indicada en `PILOT-RELEASE.md`.
2. Confirmar que el bucket `morfi-catalog` y sus políticas permiten al propietario subir a `businesses/{business_id}/products/`.
3. Confirmar que una cuenta de otro comercio no lista ni actualiza pedidos ajenos; el SQL usa membresías y RLS para ello.
4. Crear un comercio abierto, un producto con stock mayor que cero y probar efectivo, transferencia, retiro y entrega. Un producto sin stock debe ser rechazado por el servidor.
5. Probar el pedido desde un navegador comprador y el panel desde un navegador vendedor. Recargar ambos antes de avanzar estados.

## Acceso simple

El formulario ya no solicita DNI, teléfono, alias, titular ni dirección al crear una cuenta. El único desvío es la casilla “También quiero vender”; el resto se completa cuando la persona registra su emprendimiento. Para el piloto se mantiene correo y contraseña porque es el único método configurado. Google requiere configurar OAuth y teléfono requiere proveedor SMS, costos, entregabilidad y recuperación de cuenta antes de elegirlos.

## Prueba con personas

Reclutar cinco personas: tres compradores potenciales y dos emprendedores. Pedirles completar estas tareas sin guía: crear cuenta, encontrar un comercio, realizar un pedido; crear emprendimiento, publicar producto con stock, aceptar y entregar pedido. Registrar dónde dudan, mensajes que no entienden y tiempo de cada tarea. El objetivo es que cuatro de cinco completen su recorrido sin ayuda.
