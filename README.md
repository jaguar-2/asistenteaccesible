# AsistenteAccesible Detroit v6 — demostración en servidor

**No conecta con Amazon Flex.** Las ofertas y reservas son completamente ficticias. El motor continúa en un servidor activo aunque se cierre el navegador. No hay automatización de terceros.

## Archivos
- `server.js`: API protegida por clave, motor simulado, parada obligatoria tras confirmación y notificaciones web push.
- `public/index.html`: panel web móvil con filtros de Detroit y ajustes.
- `public/sw.js`: service worker para notificaciones push.
- `public/manifest.webmanifest`: instalación tipo aplicación web.
- `package.json`: dependencias.

## Instalación en servidor Node.js
1. Crea un servicio web Node.js en Render u otro proveedor que admita procesos persistentes. Conecta este repositorio.
2. Comando de instalación: `npm install`. Comando de inicio: `npm start`.
3. Genera las claves VAPID **en un entorno privado** con `npx web-push generate-vapid-keys` (no publiques la clave privada).
4. Configura estas variables de entorno en el servicio: `ADMIN_TOKEN` (contraseña larga y aleatoria), `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_EMAIL` (correo válido). Opcional y recomendado: `DATABASE_URL` de PostgreSQL.
5. Despliega. Abre la URL HTTPS que entrega el proveedor, entra en **Ajustes**, pega `ADMIN_TOKEN`, pulsa **Conectar servidor** y luego **Autorizar notificaciones**.
6. En iPhone, abre la URL HTTPS en Safari, elige **Compartir → Añadir a pantalla de inicio**, abre la aplicación instalada y concede notificaciones.

## Persistencia y costos
Sin `DATABASE_URL` la configuración, el estado y las suscripciones se pierden al reiniciar el proceso. Con PostgreSQL se conservan los datos, aunque el motor arranca **detenido** por seguridad. Algunos servicios gratuitos suspenden el servidor por inactividad; para operación continua se necesita un servicio que no duerma. GitHub Pages **no ejecuta Node.js**: esta versión debe alojarse en un servicio web con backend. No subas secretos al repositorio público.

## Reglas de seguridad
- Los switches nunca inician el motor.
- Solo los botones INICIAR y CONTINUAR activan el motor manualmente.
- Tras cada reserva simulada confirmada el motor se detiene, sin reanudación automática.
- Los horarios son preferencias; no se ejecuta inicio automático.
- `ADMIN_TOKEN` protege la API pero esta versión es de **un solo usuario** y no sustituye una autenticación de producción.
