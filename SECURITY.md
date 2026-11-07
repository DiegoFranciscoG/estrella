# Política de seguridad

## Reportar una vulnerabilidad
No abras un issue público. Escríbeme por GitHub (perfil DiegoFranciscoG) con los pasos para reproducir el problema. Respondo en un máximo de 7 días.

## Prácticas aplicadas en este proyecto
- Secretos solo por variables de entorno (`.env` no se versiona; ver `.env.example`).
- Escaneo de secretos con gitleaks en cada push y pull request, y sobre la carpeta compilada antes de publicar.
- Dependencias con versión exacta, publicadas hace al menos dos semanas, revisadas con `npm audit` y con la lista de licencias permitidas (prueba T-02).
- Autenticación y autorización deny-by-default; validación de entradas; errores sin detalles internos.
- La contraseña nunca llega al servidor; los proyectos sincronizados se cifran en el equipo del estudiante (AES-GCM) y el servidor no puede leerlos.
- App web instalable: la API nunca pasa por los service workers, y una versión nueva solo se aplica cuando el estudiante lo pide, después de guardar lo abierto.
- ESTRELLA para Windows: corre sin permisos de administrador y sigue la guía de seguridad de WebView2 (navegaciones filtradas, sin objetos del host, un solo mensaje aceptado y solo desde ESTRELLA, permisos sensibles negados). Instala programas oficiales solo desde una lista cerrada, con confirmación nativa, y winget verifica el hash. El `.exe` no está firmado; ver `docs/escritorio.md`.
- Asistente de IA: la llave de OpenRouter de cada estudiante se obtiene por OAuth PKCE, nunca llega al navegador y se guarda cifrada (AES-256-GCM con `AI_KEY_SECRET`, que no está en la base). Solo modelos gratuitos, límite de preguntas por minuto, una pregunta a la vez y respuestas mostradas como texto (OWASP Top 10 for LLM Applications 2025).
- En producción la API solo acepta las peticiones que el proxy del panel firma (Netlify, `x-nf-sign` con HS256), la documentación OpenAPI y Swagger UI están apagadas y los correos salen por HTTPS (API de Brevo). Auditoría OWASP completa, con la prueba que respalda cada control, en `docs/seguridad.md`.

## Si se vulneran datos personales (LOPDP, arts. 43 y 46)

Datos que podrían verse afectados: correos, fechas de cuenta y sesiones, consentimientos, fotos de perfil, proyectos y nombres **cifrados** (sin la llave del estudiante no se pueden leer) y llaves de OpenRouter **cifradas** (sin `AI_KEY_SECRET` no se pueden leer).

1. **Contener, el mismo día.** Revocar todas las sesiones, cambiar `JWT_SECRET` y las credenciales de la base de datos y de correo, y apagar o aislar el componente afectado. Si pudo filtrarse `AI_KEY_SECRET` junto con la base, cambiarlo, borrar la tabla `ai_connection` y pedir a cada estudiante con el asistente conectado que borre esa llave en su cuenta de OpenRouter.
2. **Evaluar.** Qué datos, de cuántas cuentas, desde cuándo y cómo. Anotar la fecha y hora en que se tuvo constancia: desde ahí corren los plazos.
3. **Avisar a la Autoridad.** A la Superintendencia de Protección de Datos Personales tan pronto sea posible, y a más tardar en el término de **5 días** desde que se tuvo constancia, salvo que sea improbable un riesgo para los derechos de las personas. También, para coordinación técnica, al CSIRT correspondiente (art. 43). Si se avisa después, explicar por qué.
4. **Avisar a cada persona afectada.** Al correo de su cuenta, en un término de **3 días** cuando haya riesgo para sus derechos (art. 46). No hace falta si los datos afectados estaban protegidos con medidas que se puede demostrar que son efectivas, como el contenido cifrado de los proyectos.
5. **Proveedores.** Los proveedores que tratan datos por encargo (servidor, base de datos, correo) deben avisar al responsable en un máximo de **2 días** (art. 43). Ese compromiso se revisa antes de contratar a cada uno.
6. **Registrar.** Guardar un registro del incidente: hechos, datos afectados, medidas tomadas, avisos enviados y fechas.
