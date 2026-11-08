# Validación de salida a piloto

1. Crear un proyecto de staging y cargar `VITE_SUPABASE_URL` y una publishable key solo en el entorno de hosting. Nunca incluir una `service_role` o `sb_secret` en la aplicación.
2. Ejecutar la migración base solo en una base vacía. En una base MORFI existente, ejecutar `morfi_reconciliation_migration.sql` y revisar los avisos de seguridad de Supabase.
3. Crear dos cuentas confirmadas: comprador y vendedor. El vendedor crea un comercio abierto con retiro o entrega, pago habilitado, producto publicado y stock mayor a cero.
4. Desde el navegador comprador, confirmar el mismo pedido dos veces mediante un reintento de red. Debe existir una sola orden y un único descuento de stock.
5. Desde el navegador vendedor, aceptar, preparar, marcar listo y entregar. Para delivery, verificar el paso “En camino”. Recargar ambos navegadores entre cada acción.
6. Intentar consultar o actualizar la orden desde una tercera cuenta sin membresía. Debe fallar. Probar también un producto agotado, comercio cerrado, pago no habilitado y dirección vacía.
7. Instalar la PWA en un teléfono Android y uno iPhone cuando sea posible; probar conexión lenta, recarga, texto ampliado y recuperación de sesión. Con red, abrir un producto con foto; sin red, comprobar que abre el shell y conserva solo imágenes ya visitadas. No debe mostrar ni permitir crear pedidos sin conexión.
8. Ejecutar `npm test` y `npm run build` sobre el commit que se despliega. Registrar los resultados junto con las observaciones de las cinco pruebas de uso.
