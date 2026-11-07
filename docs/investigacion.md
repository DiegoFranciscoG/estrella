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
| Llamadas desde navegador | OpenRouter | https://openrouter.ai/docs/use-cases/oauth-pkce | Hay ejemplos con `fetch`, pero CORS no está documentado | YA NO APLICA: en la fase 7 el navegador no llama a OpenRouter (sección 10) |
| Registro de prompts | OpenRouter | https://openrouter.ai/docs/guides/privacy/data-collection | No guarda prompts por defecto; cada proveedor gratuito tiene su política | VERIFICADO; por proveedor, ver sección 10 |
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

## 7. Hallazgos de la fase 4: Visor (2026-11-06)

Regla de versiones: solo se instalan versiones publicadas hace al menos dos semanas, para no ser de los primeros en recibir un paquete comprometido. Fechas leídas del registro npm el 2026-11-06.

| Biblioteca | Versión elegida | Más nueva | Licencia | Motivo |
|---|---|---|---|---|
| three.js | 0.186.1 (24-sep) | 0.187.0 (30-oct) | MIT | Regla de dos semanas |
| ag-psd | 31.0.3 (07-oct) | 34.1.0 (28-oct) | MIT | Cuatro versiones mayores en una semana: se espera a que se estabilice |
| web-ifc | 0.0.78 (21-sep) | la misma | MPL-2.0 | |
| @mlightcad/libredwg-web | 0.7.5 (20-jun) | 0.8.4 (04-nov) | GPL-3.0 | Ver la prueba siguiente |

**Prueba del lector de DWG** con los siete archivos de ejemplo del proyecto LibreDWG (versiones R14, 2000, 2004, 2007, 2010, 2013 y 2018; descargados solo para probar, no se guardan en el repositorio):

| Versión del lector | Archivos que abre | Falla |
|---|---|---|
| 0.8.0, 0.8.1, 0.8.2 | 6 de 7 | DWG 2000: `memory access out of bounds` |
| 0.7.10, 0.7.14 | 5 de 7 | R14 y 2000 |
| 0.7.17 | — | Lee 2000 pero falla al dibujarlo |
| **0.7.0 y 0.7.5** | **7 de 7** | — |

Se eligió la 0.7.5. Antes de subir de versión, hay que repetir esta prueba.

| Hallazgo | Cómo se detectó | Decisión |
|---|---|---|
| El lector de DWG trae su conversión a SVG y también a DXF (`dwg_write_dxf`), pero no lee DXF | Prueba en Node | DWG → SVG para ver y DWG → DXF para editar en Plano. DXF se lee con el lector de Plano |
| El SVG que genera inserta los textos del plano sin escapar | Lectura de su código (`svgConverter.js`) | Se muestra siempre dentro de `<img>`: ahí un SVG no ejecuta código ni carga nada externo |
| Las líneas de construcción infinitas (XLINE, RAY) inflan la extensión del plano y lo abren como un punto | Ejemplo 2018: extensión de 3,5 millones de unidades | El encuadre se calcula solo con la geometría finita (`cad-bounds.ts`) |
| El código de Emscripten del lector usa `new Function`; la política de seguridad lo bloqueó en el navegador | Prueba de extremo a extremo: `EvalError` en el worker | `unsafe-eval` **solo** para ese worker, que no tiene página, almacenamiento ni red externa. Recompilarlo sin eso exigiría modificar y volver a publicar código GPL |
| WebAssembly necesita `'wasm-unsafe-eval'` | Documentación de CSP (W3C) | Solo en `/apps/visor/` y en los workers; permite compilar wasm del propio sitio, no `eval()` |
| El lector avisa del resultado por consola, no como valor de retorno | Prueba en Node | El worker lee ese aviso; desde 128 el archivo no se pudo leer (umbral crítico de LibreDWG) |
| web-ifc con hilos exige aislamiento entre orígenes, que rompe los editores integrados | Documentación de web-ifc | Modo de un solo hilo |
| Las fotos RAW guardan una vista previa JPG completa | Formatos TIFF/EP y DNG | Se extrae esa vista previa con código propio (sin biblioteca) en vez de revelar el sensor |
| La auditoría de dependencias marcó 12 fallas conocidas (9 altas) en paquetes que trae Excalidraw: lodash-es, nanoid, katex | `npm audit` al instalar | Versiones parchadas forzadas con `overrides`; queda en 0 vulnerabilidades y Pizarra pasa sus pruebas |
| El paquete publicado de Excalidraw (desde la fase 3) incrusta su llave web de Firebase para colaboración en vivo, que ESTRELLA no usa | gitleaks sobre la carpeta compilada | Se quita al compilar y la compilación falla si queda cualquier llave con ese patrón. El escaneo de gitleaks del repositorio no lo veía porque revisa el código, no lo compilado |

### Peso de Visor (comprimido)

| Parte | Cuándo se descarga | Peso |
|---|---|---|
| Visor | Al abrirlo | 12 KB |
| PDF | Al abrir un PDF o AI | 128 KB más el worker |
| PSD | Al abrir un PSD | 81 KB |
| 3D | Al abrir OBJ, STL, 3MF, PLY o glTF | 178 KB |
| IFC | Al abrir un IFC | 1,1 MB (3D + 364 KB + wasm 583 KB) |
| DWG | Al abrir un DWG | 1,75 MB (worker 52 KB + wasm 1,7 MB) |

## 8. Fase 5: guía de equivalencias (2026-11-06)

**Regla:** cada ficha cita el manual oficial del programa libre, o la prueba automática del proyecto que demuestra que un programa de ESTRELLA hace esa tarea. La validación (`src/core/guide.ts`) rechaza fuentes fuera de los manuales oficiales, y una prueba unitaria comprueba que cada prueba citada existe.

**Cómo se verificó:** se leyó el texto de cada página, no solo su código de respuesta. Dos sitios engañan a una verificación automática:
- La wiki de FreeCAD responde 200 con una página antirobots; su contenido se leyó en un navegador.
- La wiki de Scribus responde 404 aunque la página exista; se leyó el contenido igual.

Los pasos de Lienzo y Plano se tomaron de su interfaz real (menús de miniPaint en español y botones de Plano).

37 fichas: 20 de arquitectura y 17 de diseño gráfico. 22 manuales oficiales y 13 fichas respaldadas por pruebas.

| Fuente oficial | URL | Fichas |
|---|---|---|
| LibreCAD — Tools (Modify: Trim) | https://docs.librecad.org/en/latest/ref/tools.html | recortar-lineas, sombreado |
| LibreCAD — Using Blocks | https://docs.librecad.org/en/latest/guides/blocks.html | bloques |
| LibreCAD — Completing and Printing | https://docs.librecad.org/en/latest/guides/completion.html | imprimir-a-escala |
| Manual de Blender — Extrude Region | https://docs.blender.org/manual/en/latest/modeling/meshes/tools/extrude_region.html | extruir-cara |
| FreeCAD Documentation — PartDesign Pad | https://wiki.freecad.org/PartDesign_Pad | solido-desde-croquis |
| FreeCAD Documentation — Arch Wall | https://wiki.freecad.org/Arch_Wall | muros-bim |
| FreeCAD Documentation — Arch IFC | https://wiki.freecad.org/Arch_IFC | editar-ifc |
| Manual de Blender — Cycles | https://docs.blender.org/manual/es/latest/render/cycles/index.html | render-realista |
| Manual de Blender — EEVEE | https://docs.blender.org/manual/es/latest/render/eevee/index.html | render-tiempo-real |
| FreeCAD Documentation — Sketcher CreateBSpline | https://wiki.freecad.org/Sketcher_CreateBSpline | curvas-libres |
| Blender Extensions — Sun Position | https://extensions.blender.org/add-ons/sun-position/ | asoleamiento |
| miniPaint — Features | https://github.com/viliusle/miniPaint#features | recortar-imagen, cambiar-tamano |
| Manual de GIMP 3.0 — Selección del primer plano | https://docs.gimp.org/3.0/es/gimp-tool-foreground-select.html | quitar-fondo |
| Manual de GIMP 3.0 — Saneado | https://docs.gimp.org/3.0/es/gimp-tool-heal.html | corregir-manchas |
| Manual de GIMP 3.0 — Curvas | https://docs.gimp.org/3.0/es/gimp-tool-curves.html | curvas-color |
| Inkscape Beginners' Guide — The Pen Tool | https://inkscape-manuals.readthedocs.io/en/latest/pen-tool.html | pluma-vector |
| Inkscape Beginners' Guide — Tracing an Image | https://inkscape-manuals.readthedocs.io/en/latest/tracing-an-image.html | vectorizar |
| Scribus Wiki — Get Started With Scribus (6) | https://wiki.scribus.net/canvas/Get_Started_With_Scribus%3A6 | paginas-maestras |
| Scribus Wiki — Get Started With Scribus (10): PDF for Press | https://wiki.scribus.net/canvas/Get_Started_With_Scribus%3A10 | pdf-imprenta |
| darktable user manual — process | https://docs.darktable.org/usermanual/stable/en/overview/workflow/process/ | revelar-raw |
| digiKam Manual — Captions View (Tags Tree) | https://docs.digikam.org/en/right_sidebar/captions_view.html | etiquetar-fotos |
| Kdenlive Manual — Editing | https://docs.kdenlive.org/en/cutting_and_assembling/editing.html | cortar-video |

| Hallazgo | Cómo se detectó | Decisión |
|---|---|---|
| miniPaint trae traducción al español y la elige con `?lang=es` | Lectura de su código y prueba en el navegador | Lienzo abre en español con un script previo (`apps/static/lienzo/es.js`). Algunos nombres de herramientas siguen en inglés y algunas traducciones son literales ("Abierto", "Rebautizar") |
| docs.excalidraw.com ahora redirige a la página comercial de Excalidraw+ | Lectura de la página | Las fichas de Pizarra citan la prueba del proyecto, no esa página |
| La guía de Scribus es de la versión 1.3 | Texto del tutorial | Las fichas lo avisan: los nombres del menú pueden variar |
| **SUPUESTO:** los nombres en español de los menús de GIMP, Inkscape y Scribus | Los manuales consultados muestran los menús en inglés | Las fichas dan el nombre en inglés entre paréntesis cuando hay duda |

## 9. Fase 6: sincronización cifrada y privacidad (2026-11-06)

| Tema | Fuente | URL | Qué sale de ahí |
|---|---|---|---|
| Contenido del aviso de privacidad | LOPDP art. 12 (texto de Ediciones Legales, reforma R.O. 290-5S) | https://www.dspace.espol.edu.ec/bitstream/123456789/57303/1/LEY%20ORG%C3%81NICA%20DE%20PROTECCI%C3%93N%20DE%20DATOS%20PERSONALES.pdf | Los 17 puntos que el aviso cubre, incluido domicilio, teléfono y correo del responsable |
| Acceso, eliminación, portabilidad | LOPDP arts. 13, 15 y 17 (misma fuente) | (ídem) | 15 días para atender; revocar el consentimiento da derecho a borrar (15.6); formato "estructurado, común, inter-operable y de lectura mecánica" |
| Vulneraciones | LOPDP arts. 43 y 46 (misma fuente) | (ídem) | Autoridad en 5 días y CSIRT; titular en 3 días si hay riesgo, salvo medidas efectivas como el cifrado; proveedores en 2 días |
| Datos fuera de Ecuador | LOPDP art. 60 (misma fuente) | (ídem) | Consentimiento explícito tras informar los riesgos: se pide al activar la nube |
| Autoridad | Superintendencia de Protección de Datos Personales | https://www.spdp.gob.ec/ | Dónde reclamar (enlazada en el aviso) |
| Límite de AES-GCM | NIST SP 800-38D, §8.3 | https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-38d.pdf | Con nonces aleatorios, como máximo 2^32 cifrados por clave |
| Compresión en el navegador | MDN, CompressionStream | https://developer.mozilla.org/en-US/docs/Web/API/CompressionStream | Disponible en todos los navegadores principales desde mayo de 2023 |
| Versiones sin pisarse | RFC 9110, §13.1.1 y §15.5.13 | https://www.rfc-editor.org/rfc/rfc9110.html | `If-Match`, `ETag` y 412 cuando la versión de partida no coincide |
| Tamaño de los pedidos | nginx, `client_max_body_size` | https://nginx.org/en/docs/http/ngx_http_core_module.html | 1 MB por defecto: se sube a 11 MB solo en `/api/` |
| Formato ZIP | PKWARE APPNOTE.TXT | https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT | Encabezados, directorio central, CRC-32 y nombres UTF-8 (bit 11) |

| Hallazgo | Cómo se detectó | Decisión |
|---|---|---|
| **Error previo (fase 2):** si el estudiante escribía y volvía al panel en menos de 1,2 s, se perdían esas últimas palabras: el panel dejaba de escuchar al programa antes de recibir su último guardado | Prueba de extremo a extremo de sincronización: la edición del segundo equipo nunca llegó al servidor | "Volver al panel" espera la confirmación del programa (`estrella:flushed`, máximo 1,5 s) y el panel escucha 2 s más tras cerrar. Prueba de regresión nueva |
| Retirar la nube y volver a activarla habría hecho que otro equipo borrara sus proyectos, al verlos "borrados en la nube" | Revisión del diseño antes de programar | `sync_epoch`: si cambia, cada equipo vuelve a subir lo suyo en lugar de borrarlo |
| Al salir de un programa se subía una versión idéntica a la anterior | Prueba de extremo a extremo | Un guardado idéntico no cuenta como cambio |
| Con dos clases de pruebas de integración, la segunda usaba una base ya detenida | Batería completa del backend | Un solo contenedor de PostgreSQL para toda la corrida |
| `SECURITY.md` decía que Dependabot revisaba las dependencias, pero el repositorio no lo tiene configurado | Revisión del repositorio | Se corrigió el texto; activar Dependabot queda a tu decisión |
| Una cuenta con un proyecto que no cupo quedaba con su nombre en la nube y sin contenido; el siguiente intento cortaba toda la sincronización | Prueba unitaria con servidor simulado | La versión 0 se trata como "falta subir el contenido" |

**Cuota:** 25 MiB por estudiante y 10 MiB por versión cifrada. Con 0,5 GB de Neon alcanza para unos veinte estudiantes que la llenen; un plano pesa kilobytes, así que en la práctica son muchos más.

**SUPUESTOS de esta fase:**
1. **Copias de seguridad del proveedor de base de datos:** no verifiqué cuánto tiempo conserva Neon datos borrados en su plan gratuito. El aviso dice que el plazo se publicará antes de abrir registros.
2. **"Término" de 5 y 3 días (arts. 43 y 46):** en la normativa ecuatoriana suele significar días hábiles; conviene confirmarlo con un abogado.
3. **Transferencia internacional:** se pide consentimiento explícito (art. 60.2), pero la lista de proveedores y sus garantías debe revisarla un abogado antes de publicar.
4. **Delegado de protección de datos (art. 48):** sigue sin confirmar si un proyecto gratuito pequeño debe designarlo.

## 10. Fase 7: asistente de IA (2026-11-06)

| Tema | Fuente | URL | Qué sale de ahí |
|---|---|---|---|
| Conectar sin copiar la llave | OpenRouter, OAuth PKCE | https://openrouter.ai/docs/guides/overview/auth/oauth | `/auth` con `callback_url`, `code_challenge` (S256), `state` y `key_label`. El código se canjea en `POST /api/v1/auth/keys`, sirve una sola vez y vence a los 10 minutos. Errores 400, 403 y 405. `localhost` funciona en cualquier puerto |
| PKCE | RFC 7636, §4.1, §4.2 y apéndice B | https://www.rfc-editor.org/rfc/rfc7636 | Verificador de 43 a 128 caracteres; S256 obligatorio si el cliente puede usarlo; el vector del apéndice B se usa en las pruebas |
| Que nunca cueste | OpenRouter, variante `:free` | https://openrouter.ai/docs/guides/routing/model-variants/free | Un modelo de pago en la lista de respaldo **se cobra**. Para que la petición sea gratis, solo modelos `:free` o `openrouter/free` |
| Respaldo entre modelos | OpenRouter, Free Models Router y Model Fallbacks | https://openrouter.ai/docs/guides/routing/routers/free-router · https://openrouter.ai/docs/guides/routing/model-fallbacks | `models` en orden de prioridad; `openrouter/free` solo elige entre gratuitos y su documentación lo recomienda para educación |
| Proveedores que no guardan | OpenRouter, Provider Routing | https://openrouter.ai/docs/guides/routing/provider-selection | `provider.data_collection: "deny"` usa solo proveedores que no recogen datos |
| Qué guarda cada uno | OpenRouter, Data Collection y Provider Logging | https://openrouter.ai/docs/guides/privacy/data-collection · https://openrouter.ai/docs/guides/privacy/provider-logging | OpenRouter no guarda prompts salvo que el usuario lo active. Cada proveedor tiene su política, con ajustes separados para modelos gratis y de pago |
| Errores | OpenRouter, Errors and Debugging | https://openrouter.ai/docs/api/reference/errors-and-debugging | 401 llave inválida, 402 sin saldo, 403 bloqueo o moderación, 408 tiempo agotado, 429 límite (con `Retry-After`), 502 modelo caído, 503 ningún proveedor cumple las condiciones pedidas |
| Edad y obligaciones | Términos de OpenRouter, actualizados el 31-ago-2026, §2, §5.2 y §6.2 | https://openrouter.ai/terms | 18 años o más. Quien integra el servicio debe exigir a sus usuarios esos mismos términos. El registro de prompts con licencia amplia existe solo si el usuario lo activa en su cuenta |
| Atribución de la app | OpenRouter, App Attribution | https://openrouter.ai/docs/app-attribution | Encabezados `HTTP-Referer` y `X-OpenRouter-Title` |
| Modelos disponibles hoy | API pública de modelos | https://openrouter.ai/api/v1/models | 453 modelos; 11 con `:free` más `openrouter/free`. Cambian seguido, así que la lista va en una variable de entorno |
| Riesgos de aplicaciones con LLM | OWASP Top 10 for LLM Applications 2025 | https://genai.owasp.org/llm-top-10/ | LLM01 a LLM10, con su medida en la tabla de abajo |

| Hallazgo | Decisión |
|---|---|
| El plan aprobado dejaba la llave de IA en el navegador, pero tu regla global dice: "Nada de API keys en el frontend: si una API necesita key, crea un endpoint proxy en el backend con rate limiting" | El servidor canjea el código PKCE, guarda la llave cifrada (AES-256-GCM con `AI_KEY_SECRET`, atada a la cuenta) y hace de proxy con límites. La llave nunca llega al navegador. La prueba de CORS prevista para esta fase ya no hace falta |
| OpenRouter exige 18 años; ESTRELLA admite desde los 15 | El asistente pide declarar 18 años o más al conectar (consentimiento `AI_ASSISTANT`). Para todos hay "Guía (sin IA)" dentro de cada programa |
| Un modelo de pago en la lista de respaldo se cobra | El servidor no arranca si un modelo de la lista no es `:free` u `openrouter/free` |
| Los modelos gratuitos suelen servirlos proveedores que pueden guardar o entrenar con lo enviado, y la tabla de políticas por proveedor se dibuja en el navegador, así que no se pudo leer | Por defecto se pide `data_collection: "deny"`. Si ningún proveedor cumple (503), se dice tal cual, y el estudiante puede aceptar proveedores que guardan solo para esa pregunta |
| El cliente reintenta los 502 a 504 para esperar a que despierte el servidor gratuito | Solo se reintenta si la respuesta no es un error propio de la API (`application/problem+json`), para no repetir seis veces un error del proveedor |
| Cada estudiante tiene su cuenta y su cupo gratuito (50 por día) | No hay una llave compartida del proyecto: no se agota para todos ni cuesta dinero al responsable |

| Riesgo OWASP (2025) | Medida en ESTRELLA |
|---|---|
| LLM01 Inyección de prompt | El modelo no tiene herramientas ni acceso a datos: lo peor que puede pasar es una respuesta engañosa. Las instrucciones fijas dicen que el texto del proyecto son datos, no órdenes |
| LLM02 Divulgación de información sensible | Solo sale lo que el estudiante ve en la vista previa, sin correo ni identificadores. Nada de preguntas ni respuestas en los registros del servidor; `data_collection: "deny"` por defecto |
| LLM03 Cadena de suministro | Un solo intermediario (OpenRouter) y una lista de modelos fijada en el entorno |
| LLM04 Envenenamiento de datos y modelos | ESTRELLA no entrena modelos ni guarda conversaciones |
| LLM05 Manejo inseguro de la salida | La respuesta se muestra como texto (`textContent`), nunca como HTML, y sus enlaces no se activan |
| LLM06 Agencia excesiva | El modelo no puede tocar proyectos ni llamar funciones; el estudiante copia lo que le sirva |
| LLM07 Fuga del prompt de sistema | No contiene secretos y se le muestra al estudiante |
| LLM08 Debilidades de vectores y embeddings | No hay búsqueda por embeddings; la guía se busca por palabras en el equipo |
| LLM09 Desinformación | Aviso de que puede equivocarse y, al lado, la guía con fuentes oficiales |
| LLM10 Consumo sin límites | Por estudiante: preguntas por minuto, una a la vez, máximo de caracteres de entrada y de tokens de salida, tiempo máximo. Encima, los límites gratuitos de OpenRouter |

**SUPUESTOS de esta fase:**
1. **No probé con una cuenta real de OpenRouter:** requiere iniciar sesión y ser mayor de edad. El flujo se probó contra un simulador local que sigue la documentación.
2. **Qué modelos gratuitos aceptan `data_collection: "deny"`:** no se pudo verificar; puede que ninguno. Por eso existe la opción explícita de aceptar proveedores que guardan.
3. **La vuelta de OpenRouter** agrega `code` y `state` a una `callback_url` sin fragmento (`https://dominio/`), según la documentación. Falta confirmarlo con la cuenta real.
4. **Transferencia internacional:** las preguntas van a OpenRouter (EE. UU.) y al proveedor del modelo. Se pide consentimiento explícito al conectar (art. 60), pero debe revisarlo un abogado.

## 11. Fase 8: escritorio y móvil (2026-11-06)

| Tema | Fuente | URL | Qué sale de ahí |
|---|---|---|---|
| Cuándo se puede instalar una web | web.dev, Install criteria | https://web.dev/articles/install-criteria | HTTPS y un manifiesto con `name` o `short_name`, íconos de **192 y 512 px**, `start_url`, `display` standalone (o similar) y sin `prefer_related_applications` |
| Navegadores que instalan | MDN, Making PWAs installable | https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable | El service worker no es requisito para instalar. Safari 17 en macOS Sonoma: Archivo > Añadir al Dock. iOS 16.4 o posterior: desde el menú Compartir de Safari, Chrome, Edge o Firefox. Firefox de escritorio no instala con manifiesto |
| Manifiesto | W3C, Web Application Manifest | https://www.w3.org/TR/appmanifest/ | Miembros `id`, `start_url`, `scope`, `display`, `icons` (con `purpose` maskable), `shortcuts` y `lang` |
| Que no se borren los datos | MDN, Storage quotas and eviction criteria; MDN, `persist()` | https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria · https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist | Por defecto el almacenamiento es "best-effort" y el navegador puede borrarlo; con `persist()` solo lo borra el usuario. Chrome, Edge y Safari aprueban o niegan sin preguntar; Firefox pregunta |
| Política de Safari | WebKit, Updates to Storage Policy | https://webkit.org/blog/14403/updates-to-storage-policy/ | Safari puede borrar los datos de un sitio sin uso. Concede `persist()` según heurísticas, por ejemplo si la web está instalada en la pantalla de inicio. Un marco de otro origen tiene una cuota de solo el 10 % |
| Ciclo de vida del service worker | web.dev, The service worker lifecycle | https://web.dev/articles/service-worker-lifecycle | Una versión nueva queda "en espera" hasta que se cierran las pestañas, o hasta que la página le pide `skipWaiting()` |
| WebView2 en Windows | Microsoft Learn, Distribute your app and the WebView2 Runtime | https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution | Viene con Windows 11 y está en casi todos los Windows 10. Si falta, hay un instalador oficial de unos 2 MB |
| .NET Framework 4.8 | Microsoft Learn, .NET Framework versions and dependencies | https://learn.microsoft.com/en-us/dotnet/framework/install/versions-and-dependencies | Viene preinstalado desde Windows 10 May 2019 Update (1903) y en Windows 11. Se seguirá incluyendo en Windows |
| WebView2 con .NET Framework | Microsoft Learn, Get started with WebView2 in WinForms apps | https://learn.microsoft.com/en-us/microsoft-edge/webview2/get-started/winforms | Funciona con .NET Framework 4.7.2 o posterior |
| Seguridad de WebView2 | Microsoft Learn, Develop secure WebView2 apps | https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/security | Verificar el origen de cada mensaje; mensajes específicos, no puentes genéricos; desactivar objetos del host; filtrar navegaciones con `NavigationStarting` y `FrameNavigationStarting` |
| Datos de WebView2 | Microsoft Learn, Manage user data folders | https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/user-data-folder | La carpeta de datos puede ir en una ubicación propia con permisos de lectura y escritura |
| Probar la app de escritorio | Playwright, WebView2 | https://playwright.dev/docs/webview2 | `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=…` y `connectOverCDP`. Microsoft Learn remite a esta guía |
| Instalar por usuario | Medición propia en este equipo (registro de Windows) | `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall` | Windows lista allí, sin permisos de administrador, programas instalados por usuario, con `DisplayName`, `UninstallString` e `InstallLocation` |
| Programas oficiales | Microsoft Learn, `winget install` | https://learn.microsoft.com/en-us/windows/package-manager/winget/install | `--id`, `--exact`, `--source winget`. winget verifica el hash del instalador; saltarlo exige `--ignore-security-hash`, "no recomendado" |
| Identificadores de winget | Medición propia (`winget show`, solo consulta) | — | Los 9 programas de escritorio de la guía existen, y sus instaladores salen de sus fuentes oficiales (releases del proyecto, download.blender.org, download.gimp.org, download.kde.org…) |
| Firma de código | Microsoft Learn, Code signing options for Windows app developers | https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options | Microsoft Store (MSIX): firma gratis y sin avisos de SmartScreen. Azure Artifact Signing: unos USD 9,99 al mes, para personas solo en EE. UU. y Canadá. Certificados OV: USD 150–300 al año; EV: más de USD 400. Autofirmado: bloquea la instalación |
| Cuenta de la Microsoft Store | Microsoft Learn, Account types, locations, and fees | https://learn.microsoft.com/en-us/windows/apps/publish/partner-center/account-types-locations-and-fees | Sin costo de registro, ni para personas ni para empresas |
| Google Play | Ayuda de Play Console | https://support.google.com/googleplay/android-developer/answer/6112435 | USD 25 una sola vez, con tarjeta; las cuentas personales deben cumplir requisitos de prueba |
| App Store | Apple Developer Program | https://developer.apple.com/programs/enroll/ | USD 99 por año |
| Licencia del SDK de WebView2 | NuGet, Microsoft.Web.WebView2 1.0.4258.31 | https://www.nuget.org/packages/Microsoft.Web.WebView2/1.0.4258.31/license | Licencia tipo BSD: se puede redistribuir conservando el aviso de copyright |

| Hallazgo | Decisión |
|---|---|
| El manifiesto actual solo trae un SVG; Chrome pide PNG de 192 y 512 px, y iOS no usa SVG para la pantalla de inicio | Íconos PNG generados desde la estrella (normal, *maskable* y Apple) con un script que se puede repetir |
| El service worker toma el control apenas hay una versión nueva, y sirve primero el `index.html` guardado: puede mezclar versiones | La página principal siempre se pide primero a la red y, si no hay conexión, sale de la caché. Los archivos con hash, primero de la caché. Una versión nueva espera hasta que el estudiante pulsa "Actualizar", y antes se guarda el programa abierto |
| Los programas corren en otro origen, y el service worker del panel no los guarda: sin conexión no abrían | Service worker propio en el origen de los programas, que guarda cada programa la primera vez que se abre. No se guardan todos de una vez, para no gastar datos móviles |
| Tauri necesita Rust y el compilador C++ de Visual Studio, que no hay en este equipo; Electron pesa unos 80–100 MB | App de Windows con .NET Framework 4.8 y WebView2, que ya vienen con Windows: un solo archivo de 1,3 MB (medido) que se instala por usuario, sin permisos de administrador |
| "Instalador pequeño que baja los programas oficiales" (plan) | La app de Windows instala FreeCAD, Blender, GIMP y los demás con winget, solo desde una lista cerrada, previa confirmación nativa, y con el hash verificado por winget |
| Firmar fuera de la Store cuesta dinero, y la opción barata de Azure no está disponible para personas en Ecuador | El instalador va sin firma y Windows mostrará un aviso, como se explica en la página "Instalar". La vía gratis es publicar en la Microsoft Store: queda como tu decisión |
| Tiendas móviles: Google Play (USD 25 con tarjeta) y App Store (USD 99 al año) | No se usan; en el móvil, ESTRELLA se instala como PWA. Regla del proyecto: avisar antes de cualquier pago |
| Los datos del panel y de los programas son "best-effort" | Se pide `persist()` y se muestra el estado en el medidor de recursos. La nube cifrada de la fase 6 es el respaldo. La app de Windows guarda sus datos aparte y nunca los toca al actualizar; al desinstalar, se conservan salvo que el estudiante elija borrarlos |

**SUPUESTOS de esta fase:**
1. **macOS, Linux y teléfonos reales:** no hay esos equipos aquí. Se prueba con la emulación móvil de Playwright y Chromium; Safari queda sin probar.
2. **Service worker dentro del marco de otro origen:** solo se prueba en Chromium. Firefox y Safari también particionan, pero no lo comprobé.
3. **SmartScreen con el instalador sin firma:** no se probó una descarga real con "marca de la web"; el aviso se describe según la documentación.
4. **Windows 10 anterior a 1903 o sin WebView2:** no se probó. La app avisa y enlaza la descarga oficial de WebView2.

## 12. Fase 9: cierre (2026-11-06 y 2026-11-07)

| Tema | Fuente | URL | Qué sale de ahí |
|---|---|---|---|
| Riesgos web | OWASP Top 10:2025 | https://top10.owasp.org/2025 | Las diez categorías, de A01 Broken Access Control a A10 Mishandling of Exceptional Conditions. Auditoría completa en `docs/seguridad.md` |
| Riesgos de API | OWASP API Security Top 10:2023 | https://api-security.owasp.org/editions/2023/en/0x11-t10 | API1 a API10. API9 pide: «Make API documentation available only to those authorized to use the API» y generar la documentación con estándares abiertos dentro de CI/CD |
| Riesgos de IA | OWASP Top 10 for LLM Applications 2025 | https://genai.owasp.org/llm-top-10/ | LLM01 Prompt Injection a LLM10 Unbounded Consumption |
| Accesibilidad | W3C, WCAG 2.2 | https://www.w3.org/TR/WCAG22/ | Recomendación del 12-dic-2024; se exige el nivel AA |
| Prueba automática de accesibilidad | Deque, axe-core y @axe-core/playwright 4.14.0 | https://github.com/dequelabs/axe-core | Reglas por etiqueta: `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22a`, `wcag22aa` |
| "Perfil modesto" (T-06) | Lighthouse, Throttling | https://github.com/GoogleChrome/lighthouse/blob/main/docs/throttling.md | Perfil móvil: 150 ms de latencia, 1,6 Mbps de bajada, 750 Kbps de subida y CPU 4 veces más lenta |
| Dirección del cliente detrás de proxies | Apache Tomcat, Remote IP Valve | https://tomcat.apache.org/tomcat-11.0-doc/config/valve.html#Remote_IP_Valve | Lee `X-Forwarded-For` de derecha a izquierda y solo confía en proxies internos |
| Qué se puede repetir | RFC 9110, §9.2.2 | https://www.rfc-editor.org/rfc/rfc9110#section-9.2.2 | GET, HEAD, PUT y DELETE son idempotentes; POST no |
| OpenAPI con Spring Boot 4.1 | springdoc-openapi, FAQ | https://springdoc.org/faq.html | Boot 4.1.x va con springdoc 3.1.x–3.2.x; recomienda la última estable, 3.2.0, compilada sobre Boot 4.1.2 |
| Render gratis | Render, Deploy for Free | https://render.com/docs/free | Duerme a los 15 min sin tráfico y tarda cerca de 1 min en despertar. 750 h al mes por workspace; al agotarlas suspende hasta el mes siguiente. **Bloquea la salida a los puertos 25, 465 y 587 (SMTP).** Sin medio de pago, un exceso suspende en vez de cobrar |
| Blueprint de Render | Render, Blueprint YAML Reference | https://render.com/docs/blueprint-spec | `runtime: docker`, `plan: free` (0,1 CPU y 512 MB), `generateValue: true` (256 bits en base64), `sync: false` (se pide en el panel), `healthCheckPath`, `autoDeployTrigger` |
| Carpeta del servicio | Render, Monorepo support | https://render.com/docs/monorepo-support | Con `rootDir`, el Dockerfile y el contexto son relativos a esa carpeta, y solo los cambios dentro de ella redespliegan |
| Health check | Render, Health checks | https://render.com/docs/health-checks | Sano si responde 2xx o 3xx en 5 s; reinicia la instancia tras 60 s fallando |
| Cabeceras en Netlify | Netlify, Custom headers | https://docs.netlify.com/manage/routing/headers/ | Si una cabecera se repite, Netlify une los valores en uno. Las cabeceras propias no se aplican a lo que se reenvía a otro servidor |
| Proxy de Netlify | Netlify, Rewrites and proxies | https://docs.netlify.com/manage/routing/redirects/rewrites-proxies/ | Corta a los 26 s. Una regla no tapa un archivo existente salvo con `force`. **Proxy firmado:** `signed = "VARIABLE"` envía `x-nf-sign`, un JWS HS256 con `deploy_context`, `exp`, `iss` (netlify), `netlify_id` y `site_url`; solo en `netlify.toml` |
| Orden de las reglas | Netlify, Redirects overview | https://docs.netlify.com/manage/routing/redirects/overview/ | Primero `_redirects`, luego `netlify.toml`; gana la primera que coincide |
| Dos sitios, un repositorio | Netlify, Monorepos | https://docs.netlify.com/build/configure-builds/monorepos/ | Un sitio por *package directory* (solo desde la interfaz), cada uno con su `netlify.toml` |
| No construir sin cambios | Netlify, Ignore builds | https://docs.netlify.com/build/configure-builds/ignore-builds/ | `ignore`: la salida 0 cancela el build. Sin caché, `CACHED_COMMIT_REF` es igual a `COMMIT_REF` |
| Variables y ámbitos | Netlify, Environment variables overview | https://docs.netlify.com/build/environment-variables/overview/ | El ámbito *Runtime* incluye los proxies firmados; limitar ámbitos es de los planes Pro y Enterprise |
| Créditos de Netlify | Netlify, How credits work; Pricing | https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/ · https://www.netlify.com/pricing/ | 300 créditos al mes con tope duro. Un despliegue de producción cuesta 15; 1 GB, 20; 10 000 peticiones, 2. Los despliegues de rama no cuestan. Al agotarse, **todos los sitios se pausan** hasta el siguiente ciclo |
| Versión de Node en Netlify | Netlify, Manage dependencies | https://docs.netlify.com/build/configure-builds/manage-dependencies/ | `NODE_VERSION` acepta una versión exacta |
| Neon gratis | Neon, Pricing; Plans | https://neon.com/pricing · https://neon.com/docs/introduction/plans | **1 GB por proyecto** (era 0,5 GB el 2026-11-05), 100 CU-hora al mes, 5 GB de transferencia, se apaga tras 5 min, sin tarjeta, historial de 6 h |
| Conexión segura a Neon | Neon, Connect securely; Java guide | https://neon.com/docs/connect/connect-securely · https://neon.com/docs/guides/java | Certificados de Let's Encrypt (ISRG Root X1). Para Java: `sslmode=require&channelBinding=require` |
| TLS en pgJDBC | pgJDBC, SSL; Connection parameters | https://jdbc.postgresql.org/documentation/ssl/ · https://jdbc.postgresql.org/documentation/use/ | `require` acepta cualquier certificado; `verify-full` verifica el nombre. `channelBinding=require` exige SCRAM ligado al canal (PostgreSQL 11 o posterior) |
| Correo por API | Brevo, Send a transactional email | https://developers.brevo.com/reference/sendtransacemail | `POST https://api.brevo.com/v3/smtp/email`, cabecera `api-key`, `sender`, `to`, `subject`, `htmlContent` y `textContent`; responde 201 |
| Plan gratuito de Brevo | Brevo, Email API | https://www.brevo.com/features/email-api/ | 300 correos al día, sin tarjeta, con la API completa, después de aprobar la cuenta. La página de precios se arma con JavaScript y no se pudo leer |
| Vulnerabilidades conocidas | OSV.dev | https://osv.dev | 0 vulnerabilidades en las 103 dependencias Maven de ejecución, springdoc incluido (2026-11-07) |

| Hallazgo | Decisión |
|---|---|
| Con `forward-headers-strategy: framework`, la API creía la primera dirección de `X-Forwarded-For`, que escribe el cliente: cualquiera podía cambiar de dirección para esquivar los frenos | `native` (Remote IP Valve de Tomcat). Una prueba con servidor real falla con la configuración anterior. Además: freno por cuenta, independiente de la dirección, y techo global de correos por hora |
| Spring lee el cuerpo JSON entero antes de validarlo | Filtro previo: 411 sin tamaño declarado y 413 sobre 128 KB |
| El proxy corta a los 26 s y Render tarda cerca de un minuto en despertar. Si se perdía la respuesta a una renovación de sesión, la detección de reutilización cerraba todas las sesiones | Tras 10 minutos sin contacto, antes de escribir, la app pregunta a `/health` hasta que responde la API misma. Solo repite GET, HEAD, PUT y DELETE. El asistente espera 20 s como máximo |
| axe encontró en Plano botones de capa sin nombre propio y un texto atenuado por debajo de 4.5:1 | Nombre accesible con la capa; encendido y apagado se distinguen por grosor y borde, no por transparencia |
| nginx servía el manifiesto como `application/octet-stream` | Tipo propio, `application/manifest+json` |
| Render gratis bloquea SMTP | Transporte por la API HTTPS de Brevo (`APP_MAIL_PROVIDER=brevo`); SMTP queda para el stack local |
| Detrás de Netlify, la API ve a todos los estudiantes con la dirección de Netlify: los frenos por dirección serían de todos | Proxy firmado. Con `APP_PROXY_SECRET`, `/api` exige un `x-nf-sign` válido (HS256, `iss`, `exp`, `site_url`). Solo entonces la dirección del estudiante sale de la cabecera de Netlify |
| Netlify une los valores de una cabecera repetida: dos CSP serían dos políticas a la vez | Generador que lee `nginx.conf.template` y nunca da la misma cabecera dos veces a una ruta. Comparado con nginx: 511 archivos, 0 diferencias |
| Cada despliegue de producción gasta 15 de 300 créditos, y al agotarlos se pausan los sitios | `ignore` en cada sitio: solo se construye si cambió `frontend/`. El primer build siempre corre |
| OWASP API9: documentación solo para quien usa la API | Swagger UI y `/api/v1/openapi` solo con `APP_API_DOCS=true` (stack local). El contrato está en `docs/openapi.json` y CI lo compara con el código |
| Con la CSP estricta, Swagger UI solo perdía el `<style>` de su logo | Se permite ese bloque por su SHA-256, sin `unsafe-inline` |
| Con `sslmode=require`, pgJDBC acepta cualquier certificado | La forma de Neon para Java, con `channelBinding=require`: un intermediario no puede completar la autenticación SCRAM |
| Brevo gratis envía 300 correos al día | `APP_MAIL_PER_HOUR=12` en producción |

**Mediciones de esta fase:**

| Medición | Resultado |
|---|---|
| T-06, «Entrar», primera visita, perfil móvil de Lighthouse | 1,88–2,0 s y 148 KB (cota superior: Playwright descomprime antes de contar) |
| T-06, «Entrar», app instalada | 311–636 ms |
| T-06, panel con sesión, app instalada | 428–543 ms |
| axe, WCAG 2.2 AA | 0 incumplimientos en todas las pantallas del panel (temas claro y oscuro) y en los 4 programas propios |
| Cabeceras de Netlify frente a nginx | 511 archivos, 0 diferencias |

**SUPUESTOS de esta fase:**
1. **T-06 («panel en menos de 1 s en perfil modesto»)** se cumple con la app instalada, que es como se usa a diario. La primera visita tarda unos 2 s en ese perfil: solo transferir 148 KB a 1,6 Mbps lleva unos 0,74 s, más 150 ms por cada ida y vuelta. Falta que confirmes esta lectura.
2. **Dirección del visitante en Netlify:** no está documentado qué cabecera llega al origen. Se usa `X-Nf-Client-Connection-Ip` y, si falta, `X-Forwarded-For`; el primer despliegue lo confirma en el registro.
3. **Builds cancelados por `ignore`:** no encontré escrito que no consuman créditos; se infiere porque no son despliegues exitosos.
4. **Tarjeta en Netlify:** su página de precios no lo dice.
5. **Brevo:** las cifras del plan gratuito salen de sus páginas de producto, no de la de precios.
6. **Accesibilidad:** axe no revisa todos los criterios (por ejemplo, la experiencia con lector de pantalla). No se probó con NVDA ni VoiceOver.
7. **Imágenes Docker:** no se escanearon; trivy no está instalado y Docker Scout no respondió.

## 13. Conclusiones de diseño

- **La línea legal se mantiene:** cambiar el nombre no legaliza una copia. Código, interfaz, nombre e íconos propios, y programas libres con su licencia.
- **"Todas las opciones de los 19 programas" no es alcanzable.** ESTRELLA debe decir qué hace cada herramienta y qué no.
- **"Archivo Java" no aplica a estos programas:** están escritos en C++ o JavaScript. La descarga es un instalador pequeño o la app web instalable.
- **Nadie puede garantizar cero fallos ni que el equipo no se caliente.** Sí se puede medir fluidez, aislar fallos y recuperar el trabajo.
