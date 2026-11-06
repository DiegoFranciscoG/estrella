# Política de seguridad

## Reportar una vulnerabilidad
No abras un issue público. Escríbeme por GitHub (perfil DiegoFranciscoG) con los pasos para reproducir el problema. Respondo en un máximo de 7 días.

## Prácticas aplicadas en este proyecto
- Secretos solo por variables de entorno (`.env` no se versiona; ver `.env.example`).
- Escaneo de secretos con gitleaks en cada push y pull request, y sobre la carpeta compilada antes de publicar.
- Dependencias con versión exacta, publicadas hace al menos dos semanas, revisadas con `npm audit` y con la lista de licencias permitidas (prueba T-02).
- Autenticación y autorización deny-by-default; validación de entradas; errores sin detalles internos.
- La contraseña nunca llega al servidor; los proyectos sincronizados se cifran en el equipo del estudiante (AES-GCM) y el servidor no puede leerlos.

## Si se vulneran datos personales (LOPDP, arts. 43 y 46)

Datos que podrían verse afectados: correos, fechas de cuenta y sesiones, consentimientos, fotos de perfil, y proyectos y nombres **cifrados** (sin la llave del estudiante no se pueden leer).

1. **Contener, el mismo día.** Revocar todas las sesiones, cambiar `JWT_SECRET` y las credenciales de la base de datos y de correo, y apagar o aislar el componente afectado.
2. **Evaluar.** Qué datos, de cuántas cuentas, desde cuándo y cómo. Anotar la fecha y hora en que se tuvo constancia: desde ahí corren los plazos.
3. **Avisar a la Autoridad.** A la Superintendencia de Protección de Datos Personales tan pronto sea posible, y a más tardar en el término de **5 días** desde que se tuvo constancia, salvo que sea improbable un riesgo para los derechos de las personas. También, para coordinación técnica, al CSIRT correspondiente (art. 43). Si se avisa después, explicar por qué.
4. **Avisar a cada persona afectada.** Al correo de su cuenta, en un término de **3 días** cuando haya riesgo para sus derechos (art. 46). No hace falta si los datos afectados estaban protegidos con medidas que se puede demostrar que son efectivas, como el contenido cifrado de los proyectos.
5. **Proveedores.** Los proveedores que tratan datos por encargo (servidor, base de datos, correo) deben avisar al responsable en un máximo de **2 días** (art. 43). Ese compromiso se revisa antes de contratar a cada uno.
6. **Registrar.** Guardar un registro del incidente: hechos, datos afectados, medidas tomadas, avisos enviados y fechas.
