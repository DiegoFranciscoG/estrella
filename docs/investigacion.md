# Investigación — ESTRELLA (Fase 1)

Fecha de consulta de todas las fuentes: **2026-11-05**. Este documento no es asesoría legal.

Etiquetas: **VERIFICADO** (fuente primaria leída o medición propia) · **SECUNDARIA** (solo prensa o comentarista) · **SUPUESTO** (no se pudo verificar; no construir encima sin confirmar).

## 1. Correcciones al documento ESTRELLA del 4-nov-2026

| # | El documento dice | Lo que se encontró | Consecuencia |
|---|---|---|---|
| 1 | LibreCAD "ya funciona" en navegador y pesa ~18 MB | Carga, pero su README lo declara **experimental y no oficial**, exige **Chrome/Edge 137+** y no recibe cambios desde 2026-07-02. Medido: **25,2 MB** de transferencia y 66,6 MB descomprimidos | No puede ser el único CAD 2D: Firefox y Safari quedan fuera |
| 2 | OpenSCAD web es "estable" | El propio editor dice que es una versión **alfa** | Se etiqueta como experimental |
| 3 | Outline es libre | **Business Source License 1.1**. Su licencia dice que no es de código abierto y prohíbe ofrecerlo como servicio de documentos comercial | Fuera del catálogo |
| 4 | tldraw cubre pizarra | Licencia propia: producción exige clave de licencia | Fuera. Se usa Excalidraw (MIT) |
| 5 | Stirling-PDF y AFFiNE son libres | **Licencia mixta**: MIT con directorios bajo otra licencia. Stirling además necesita servidor | No se integran enteros |
| 6 | Medidor con "carga del procesador" | Una página web no lee el % de CPU. **SUPUESTO**: la Compute Pressure API solo daría niveles y solo en Chromium; falta confirmarlo | Medidor honesto: memoria si el navegador la da, espacio usado, y niveles en vez de % |
| 7 | "Nunca se pierde nada" y cifrado en el dispositivo | Son incompatibles si olvida la contraseña: el servidor no puede descifrar | Hace falta **código de recuperación** (decisión 3) |
| 8 | Llave de OpenRouter pegada a mano | OpenRouter ofrece **OAuth PKCE**: el estudiante autoriza sin copiar nada | Mejor usar PKCE y dejar el pegado como alternativa |
| 9 | Solo blanco y negro en todo | Los programas embebidos traen su interfaz: LibreCAD tiene íconos verdes y miniPaint, selector de color | El blanco y negro aplica al **marco ESTRELLA**. Los programas conservan su interfaz salvo que se modifiquen |
| 10 | Mil usuarios a costo casi cero | Neon free da **0,5 GB** por proyecto: con 50 MB por estudiante alcanza para unos 10 | Hace falta otro almacén o una cuota muy baja (decisión 4) |

## 2. Fuentes

| Tema | Fuente | URL | Qué sale de ahí | Estado |
|---|---|---|---|---|
| Licencias y actividad | API de GitHub y archivos LICENSE | https://github.com/ (ver `licencias.md`) | Licencia de cada candidato | VERIFICADO |
| Tamaños de paquetes | Registro npm | https://registry.npmjs.org/ | Versión y licencia declarada | VERIFICADO |
| LibreCAD web | README de la bifurcación | https://github.com/magik6k/LibreCAD-Web | Experimental, Chrome/Edge 137+, JSPI | VERIFICADO |
| LibreCAD web | Demo, medida en Chrome 152 | https://magik.net/librecad/app.html | Abre sin errores en consola; 25,2 MB | VERIFICADO (solo apertura) |
| LibreCAD web | OSArch | https://osarch.org/2026/07/06/librecad-webassembly-browser-port/ | Funciones declaradas: DXF, lectura DWG, SVG/PDF | SECUNDARIA |
| FreeCAD web | Artículo del autor | https://magik.net/freecad/ | ~96 MB comprimidos, módulo de 196 MB, Chrome/Edge 137+ | VERIFICADO (declarado, no medido) |
| CAD por navegador | README de MLightCAD | https://github.com/mlightcad/cad-viewer | Base MIT; DWG opcional vía LibreDWG (GPL-3.0), con cobertura y memoria limitadas | VERIFICADO (declarado) |
| OpenSCAD web | Licencia del repo y demo | https://github.com/openscad/openscad-playground | Se despliega bajo GPLv3; 8,7 MB | VERIFICADO |
| miniPaint / Excalidraw | Demos medidas | https://viliusle.github.io/miniPaint/ · https://excalidraw.com/ | 354 KB y 651 KB | VERIFICADO (solo apertura) |
| Límites de IA | Documentación de OpenRouter | https://openrouter.ai/docs/api_reference/limits · https://openrouter.ai/pricing | 20 solicitudes/min y **50/día**; 1.000/día tras comprar 10 créditos; los intentos fallidos cuentan | VERIFICADO |
| OAuth de IA | OpenRouter | https://openrouter.ai/docs/use-cases/oauth-pkce | PKCE con llave del usuario | VERIFICADO |
| Llamadas desde navegador | OpenRouter | https://openrouter.ai/docs/use-cases/oauth-pkce | Hay ejemplos con `fetch`, pero CORS no está documentado | SUPUESTO: probar en F7 |
| Registro de prompts | OpenRouter | https://openrouter.ai/docs/guides/privacy/data-collection | No guarda prompts por defecto; cada proveedor gratuito tiene su política | VERIFICADO (proveedores: pendiente) |
| Datos personales | LOPDP, texto de Ediciones Legales con reforma R.O. 290-5S del 22-V-2026 | https://www.dspace.espol.edu.ec/bitstream/123456789/57303/1/LEY%20ORG%C3%81NICA%20DE%20PROTECCI%C3%93N%20DE%20DATOS%20PERSONALES.pdf | Ver sección 3 | VERIFICADO (copia no oficial; cotejar con el Registro Oficial) |
| Funciones y formatos | TJUE C-406/10 SAS v. WPL (comentarios) | https://www.europeanlawblog.eu/pub/c-40610-sas-institute-v-world-programming-ltd-wpl | En la UE, funcionalidad, lenguaje y formato de datos no se protegen como programa | SECUNDARIA; no aplica directo en Ecuador |
| Marcas y DWG | EFF, sobre Autodesk contra ODA | https://www.eff.org/deeplinks/2006/12/using-trademark-stymie-interoperability | El conflicto histórico fue por **marca**, no por leer el formato | SECUNDARIA |
| Formato SKP | OpenSKP | https://pypi.org/project/openskp/ | Lector MIT por ingeniería inversa, en Python y Dart; sin versión web comprobada | SECUNDARIA |
| Aislamiento | web.dev | https://web.dev/articles/cross-origin-isolation-guide | SharedArrayBuffer exige COOP y COEP | VERIFICADO |

## 3. Reglas legales que salen de la LOPDP

| Artículo | Regla | Efecto en el producto |
|---|---|---|
| 8 | Consentimiento libre, específico, informado e inequívoco; revocable | Casillas separadas por finalidad, sin marcar |
| 10.i | Conservar solo el tiempo necesario | Plazos escritos; purga de cuentas sin verificar |
| 12 | Información previa, **incluido domicilio legal, teléfono y correo del responsable** | **El aviso de privacidad necesita esos datos tuyos** (decisión 5) |
| 15 | Eliminación en 15 días | Borrado real e inmediato desde la app |
| 17 | Portabilidad en formato común | Exportar todo en ZIP |
| 21 | Consentimiento propio desde los 15 años | Casilla "tengo 15 años o más"; menores, con su representante |
| 43 | Notificar la vulneración a la Autoridad en 5 días como máximo | Procedimiento en `SECURITY.md` |
| 46 | Notificar al titular en 3 días cuando haya riesgo | Lo mismo; el correo de la cuenta basta para avisar |
| 55–60 | Reglas de transferencia internacional | Servidores en EE. UU.: hay que declararlo y **revisar con un abogado** |

## 4. Lo que quedó sin verificar (SUPUESTOS)

1. **Código Ingenios (Ecuador):** no encontré el artículo sobre programas de ordenador, descompilación e interoperabilidad. Por eso ESTRELLA **no hace ingeniería inversa propia**: solo usa bibliotecas libres existentes.
2. **Art. 48 y 51 de la LOPDP:** falta confirmar si un proyecto gratuito pequeño debe designar delegado o registrarse.
3. **Almacenamiento gratuito y sus condiciones:** falta confirmar límites actuales y si piden tarjeta.
4. **Compute Pressure y `navigator.deviceMemory`:** falta su soporte actual por navegador.
5. **Fidelidad real:** DWG, PSD, AI, INDD y SKP no se probaron con archivos reales. Es la primera tarea de F4.
6. **Funciones de los programas web:** se comprobó que abren y cuánto pesan; **no** se probó cada herramienta.
7. **Penpot:** creo que exige servidor propio pesado; falta confirmarlo. Por eso no está en el núcleo.
8. **Compilar LibreCAD web:** requiere Qt desde código fuente. No se ha intentado; no se puede enlazar la demo de un tercero como si fuera nuestra.
9. **Licencias de GIMP, Inkscape, Scribus y digiKam:** su repositorio principal no está en GitHub. **Blender** aparece sin identificar en la API.

## 5. Mediciones de la fase 2 (2026-11-05)

| Pregunta | Medición | Resultado | Decisión |
|---|---|---|---|
| ¿Un marco `sandbox` del mismo sitio aísla un programa colgado? | Bucle infinito en el marco; latidos del panel por consola | **No**: el panel se congeló | Los programas se sirven desde **otro sitio** |
| ¿Y con los programas en otro sitio? | Igual, en Chrome 156 y Edge 156 instalados | **Sí**: 25 de 25 latidos del panel siguieron llegando | Producción: dominio aparte para programas (p. ej. un subdominio en una lista de sufijos públicos) |
| ¿Sirve el Chromium que trae Playwright para probarlo? | Mismo caso | No: no separa procesos, y además no puede inspeccionar una página con un marco trabado | T-04 queda verificado con la medición manual y las pruebas unitarias del detector; no hay prueba automática de extremo a extremo |
| Límite de envíos de correo por IP (5/h) | Prueba de extremo a extremo | Un laboratorio entero comparte IP: el quinto estudiante quedaba bloqueado | 60 por IP y 3 por correo, por hora |
| Bloqueo de inicio de sesión por IP tras 5 fallos | Prueba de extremo a extremo | Un estudiante con errores bloqueaba a todo el laboratorio | 5 fallos por cuenta e IP; 100 por IP solo como freno masivo |
| Servidor gratuito dormido | Reinicio de la API durante una prueba | El proxy devuelve 502 y la app decía "respuesta inesperada" | Reintento automático breve y mensaje "el servidor está despertando" |
| Peso del panel | `vite build` | 20 KB comprimidos en total | Muy por debajo del límite de 300 KB |

## 6. Hallazgos de la fase 3 (2026-11-06)

| Hallazgo | Cómo se detectó | Decisión |
|---|---|---|
| El editor de MLightCAD (`cad-editor`) está en versión preliminar y depende de Vue, Element Plus y complementos de nube | Registro npm | **Plano propio** para 2D sencillo, más `dxf-parser` (MIT) para leer DXF. El visor de MLightCAD queda para Visor (fase 4) |
| miniPaint ya no se publica en npm | Registro npm: retirado en 2021 | Copia de la versión v4.14.3, con hash del tarball y procedencia en `SOURCE.txt` |
| miniPaint trae incrustadas las llaves de API de su autor (Pixabay, Google Fonts) | gitleaks en el commit | Se reemplazaron por cadenas vacías: no se redistribuyen llaves ajenas y esas funciones requieren internet, que está bloqueado |
| Excalidraw descargaba fuentes desde esm.sh aunque se le indicara la ruta local | Consola durante la prueba de extremo a extremo: la política de seguridad bloqueó 30 pedidos | La ruta se fija en un módulo importado primero; los `import` se ejecutan antes que el resto del código |
| nginx servía el worker de pdf.js (`.mjs`) como binario y Chrome no lo ejecutaba: Folio no abría ningún PDF | Prueba de extremo a extremo | Tipo explícito para `.mjs` en nginx |
| Los marcos sin `allow-modals` ignoran `confirm()`: borrar páginas nunca se habría confirmado | Revisión del código | `allow-modals` y `allow-popups` en el marco |
| `khroma` (dependencia indirecta) no declara licencia en su `package.json` | Control T-02 | Verificada a mano como MIT y registrada con su fuente |
| Un PDF de 15 MB supera el límite anterior de 20 millones de caracteres por guardado | Cálculo de base64 | Límite de 50 millones y aviso visible si se supera; nunca se descarta en silencio |

### Peso de cada programa al abrirlo por primera vez (comprimido)

| Programa | Descarga inicial | Nota |
|---|---|---|
| Apuntes | 2 KB | |
| Plano | 20 KB | |
| Lienzo | 312 KB | Más íconos (95 KB) |
| Folio | 334 KB | El worker de pdf.js se baja al abrir el primer PDF |
| Pizarra | 430 KB | Las fuentes (14 MB en total) se bajan solo las que se usan |

## 7. Conclusiones de diseño

- **La línea legal se mantiene:** cambiar el nombre no legaliza una copia. Código, interfaz, nombre e íconos propios, y programas libres con su licencia.
- **"Todas las opciones de los 19 programas" no es alcanzable.** ESTRELLA debe decir qué hace cada herramienta y qué no.
- **"Archivo Java" no aplica a estos programas:** están escritos en C++ o JavaScript. La descarga es un instalador pequeño o la app web instalable.
- **Nadie puede garantizar cero fallos ni que el equipo no se caliente.** Sí se puede medir fluidez, aislar fallos y recuperar el trabajo.
