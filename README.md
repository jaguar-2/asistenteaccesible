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


## Versión 7 — cuentas Detroit y preparación de integración

- Añade `account-auth.js` a la raíz y actualiza `server.js` y `public/index.html`.
- Configura `DATABASE_URL` en Render con una base PostgreSQL propia para habilitar usuarios y persistir suscripciones push. No es necesario cambiar `ADMIN_TOKEN` ni las claves VAPID existentes.
- Abre Ajustes > Cuenta Detroit. La primera cuenta se crea una sola vez utilizando la clave inicial `ADMIN_TOKEN`; después inicia sesión con correo y contraseña **distintos de Amazon**.
- Las contraseñas Detroit se derivan con scrypt y sal aleatoria; las sesiones usan cookies HttpOnly/Secure/SameSite=Strict y vencen en 7 días.
- El sistema conserva temporalmente el acceso anterior mediante ADMIN_TOKEN para no bloquear el servicio actual. Después de verificar la migración, se recomienda retirarlo en una actualización posterior.
- La integración Amazon Flex NO está implementada: no hay una API autorizada confirmada. El indicador de conexión informa de esta limitación. No se piden ni almacenan credenciales Amazon. Las reservas siguen siendo ficticias.
- Los usuarios comparten el mismo motor de simulación (una instancia). Esta versión NO proporciona aislamiento multiusuario.
