# Plan de construcción

Las horas son estimaciones, no mediciones. Parten de las 56 h del documento original y suben porque esta investigación añadió trabajo.

## Arquitectura propuesta

| Pieza | Elección | Por qué |
|---|---|---|
| Panel | Vite + TypeScript, sin framework pesado | Límite de 300 KB |
| Programas | Cada uno en su iframe con `sandbox`, cargado al abrirlo | Fallos y licencias quedan aislados |
| Sin instalar | PWA con caché de programas | Offline y sin tiendas |
| Guardado local | IndexedDB / OPFS en un worker | No bloquea la pantalla |
| Cifrado | Web Crypto en el dispositivo | El servidor no ve contenido |
| API | Spring Boot + PostgreSQL + Flyway | Tu estándar de portafolio |
| Despliegue | Frontend estático; API en Render; base en Neon | Gratis. Render duerme a los 15 min: la app funciona offline y sincroniza al despertar |
| IA | OpenRouter con PKCE y la cuenta de cada estudiante; el servidor guarda su llave cifrada y hace de proxy | Sin costo para ti ni para el estudiante (solo modelos gratuitos), y la llave nunca llega al navegador |
| Escritorio | Instalador pequeño que baja los programas oficiales | No redistribuye programas pesados |

Medición útil: las demos de LibreCAD y OpenSCAD abrieron con `crossOriginIsolated` en falso. Los programas elegidos no parecen exigir esas cabeceras, lo que simplifica el hosting; se confirma al integrarlos.

## Fases

| Fase | Horas | Entregable | Cómo se comprueba |
|---|---|---|---|
| F2 Base | 14 | Plantilla del repo, CI, API de cuentas, login, panel, temas, logo, marcos aislados, autoguardado y recuperación | T-03, T-04, T-11; Testcontainers |
| F3 Cuatro programas | 12 | Imagen (miniPaint), pizarra (Excalidraw), PDF (PDF.js + pdf-lib), CAD 2D (MLightCAD; LibreCAD como "avanzado" solo en Chromium) | Playwright herramienta por herramienta; T-05, T-06 |
| F4 Conversor | 10 | Abrir sin subir nada, con avisos honestos y archivos de prueba legales | T-07 |
| **Primera publicación posible** | | Con F4 ya resuelve el problema principal | Tú decides con "VOY A SUBIR" |
| F5 Guía | 8 | Equivalencias de arquitectura y diseño gráfico, con buscador | Cada ficha con fuente |
| F6 Sincronización | 10 | Cifrado, versiones, exportar todo, borrar cuenta, aviso de privacidad | T-08, T-09, T-10 |
| F7 IA | 6 | PKCE, contexto visible antes de enviar, modo sin IA | Integración contra un OpenRouter falso y e2e contra el simulador local. La prueba de CORS ya no aplica: el navegador no llama a OpenRouter |
| F8 Escritorio y móvil | 10 | Instalador para Windows; macOS y Linux según lo que se pueda probar. PWA móvil | Instalar, desinstalar y actualizar sin perder datos. **Hecho:** PWA instalable y sin conexión en todas las plataformas; ESTRELLA para Windows de 1,3 MB, probada de verdad en este equipo. macOS, Linux y teléfonos reales quedan sin probar (`docs/escritorio.md`) |
| F9 Cierre | 8 | Auditoría OWASP, accesibilidad, rendimiento, README | T-01, T-02, T-06; checklist "VOY A SUBIR" |

**Total: unas 78 h.** T-12 (cinco estudiantes reales) depende de ti: no se puede simular.

## Qué se puede garantizar y qué no

| Se mide y se garantiza | No se puede garantizar |
|---|---|
| Recuperar el trabajo tras un cierre brusco, con menos de 30 s de pérdida | "Cero errores" o "nunca se traba" |
| Que un programa caído no tumbe el panel | Las mismas opciones que cada programa de pago |
| Panel en menos de 1 s en perfil modesto | Que el equipo no se caliente nunca |
| Ningún contenido legible en el servidor | Render, video o 3D pesado fluidos en equipos de 4 GB |
| Cero marcas ajenas fuera de equivalencias | Fidelidad total de DWG, PSD o AI |

## Decisiones que necesito de ti

| # | Decisión | Recomendación |
|---|---|---|
| 1 | Aceptar el enfoque de plataforma sobre programas libres, sin clones renombrados | Sí: es lo legal y lo alcanzable |
| 2 | Nombre definitivo | ESTRELLA (falta buscar conflictos de marca en SENADI antes de publicar) |
| 3 | Si olvida contraseña **y** código de recuperación, el trabajo sincronizado se pierde | Aceptarlo y explicarlo al registrarse: es el precio de que nadie más pueda leerlo. **Aplicado en F6** con la recomendación (se explica al registrarse y en Mi cuenta); puedes cambiarlo |
| 4 | Almacenamiento: Neon solo da 0,5 GB | Empezar con guardado local y una cuota pequeña; evaluar otro almacén sin tarjeta. Te aviso si alguno la pide. **Aplicado en F6:** 25 MiB por estudiante en la misma base (configurable); ningún almacén con tarjeta |
| 5 | Datos del responsable para el aviso de privacidad (LOPDP art. 12): domicilio legal y teléfono se publicarían | Dármelos antes de abrir registros reales, o revisar con un abogado otra forma de identificarte. **Pendiente:** el aviso muestra "pendiente" y un banner de borrador hasta tenerlos (`frontend/src/data/contacto.json`, campo `responsable`) |
| 6 | Donaciones | Como pediste, al final; queda preparado por configuración |
| 7 | Dónde vive la llave de IA | El plan la dejaba en el navegador, pero tu regla global prohíbe llaves en el frontend. **Aplicado en F7:** el servidor la guarda cifrada y hace de proxy con límites |
| 8 | El asistente es solo para mayores de 18 años | Lo exigen los términos de OpenRouter (§2 y §5.2). **Aplicado en F7:** de 15 a 17 años se usa la guía sin IA. Dar IA a menores requeriría otro proveedor que lo permita, por investigar |
| 9 | Firmar ESTRELLA para Windows | Fuera de la Store cuesta USD 150–400 al año, y Azure Artifact Signing no está disponible para personas en Ecuador. **Pendiente:** se publica sin firma (Windows avisa una vez), o tú la publicas en la Microsoft Store, gratis y con firma incluida |
| 10 | Apps en tiendas móviles | Google Play cobra USD 25 con tarjeta y la App Store USD 99 al año. **Aplicado en F8:** no se usan; en el móvil, ESTRELLA se instala como PWA. Si quieres estar en las tiendas, es tu decisión y tu pago |
