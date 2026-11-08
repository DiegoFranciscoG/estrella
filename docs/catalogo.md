# Catálogo — programa por programa

Verificado el **2026-11-05**; los programas propios de la fase 10 se agregaron el **2026-11-08**. Los nombres de programas de pago aparecen aquí solo de forma descriptiva.

**Sobre las mediciones:** Chrome 152 en un solo equipo de 16 GB, red doméstica, con transferencia real. "Abre" significa que la interfaz cargó; **no se probaron todas las herramientas**.

## 1. Los 19 programas

| # | Programa de pago | Opción libre | Licencia | En ESTRELLA | Cobertura honesta |
|---|---|---|---|---|---|
| 1 | AutoCAD | LibreCAD web + MLightCAD | GPL-2.0 / MIT | Web | Dibujo 2D sí; automatización y ecosistema, no |
| 2 | SketchUp | **Sólido** (propio, three.js); Blender o FreeCAD en escritorio | MIT / GPL / LGPL-2.1 | Web + escritorio | Maqueta por sólidos con medidas exactas y prismas desde una planta; empujar caras y booleanas, en escritorio |
| 3 | Revit | **BIM** (propio, web-ifc + three.js); FreeCAD BIM en escritorio | MPL-2.0 / MIT / LGPL-2.1 | Web + escritorio | Recorrer por niveles, propiedades, cantidades, plantas por corte, medidas y cuadros CSV; modelar BIM, en escritorio |
| 4 | Enscape | Blender EEVEE | Por confirmar | Escritorio | Depende de la GPU; no hay sincronía en vivo con BIM |
| 5 | V-Ray | Blender Cycles, LuxCore | Por confirmar / Apache-2.0 | Escritorio | Render de calidad, pero materiales incompatibles |
| 6 | 3ds Max | Blender | Por confirmar | Escritorio | Amplio; los plugins propios no funcionan |
| 7 | Illustrator | **Trazo** (propio); Inkscape en escritorio | MIT / GPL | Web + escritorio | Formas, pluma, lápiz, texto y capas; SVG y PNG. Bézier editables y degradados, en escritorio |
| 8 | Photoshop | miniPaint; Krita o GIMP en escritorio | MIT / GPL-3.0 | Web + escritorio | Capas y filtros sí; IA generativa y funciones avanzadas, no |
| 9 | InDesign | Scribus | Por confirmar | Escritorio | Maquetación sí; INDD no se abre |
| 10 | Acrobat | PDF.js + pdf-lib | Apache-2.0 / MIT | Web | Ver, anotar, unir, dividir. OCR y edición profunda: por evaluar |
| 11 | Lightroom | **Revelado** (propio); darktable en escritorio | MIT / GPL-3.0 | Web + escritorio | Luz, color, recorte y giro; de un RAW revela su vista previa JPG. Datos del sensor y ajustes por zonas, en escritorio |
| 12 | Bridge | **Archivo** (propio); digiKam en escritorio | MIT / GPL | Web + escritorio | Miniaturas, estrellas, etiquetas, palabras clave, filtros, renombrado en lote a ZIP y lista CSV; EXIF y catálogos enormes, en escritorio |
| 13 | Adobe Express | Plantillas propias sobre miniPaint o Excalidraw | Propio / MIT | Web | Sin banco de imágenes de pago |
| 14 | Rhino | **Sólido** para volúmenes; FreeCAD en escritorio | MIT / LGPL-2.1 | Web + escritorio | Sólidos exactos sí; NURBS libres limitadas y Grasshopper sin equivalente directo |
| 15 | Blender | Blender | Por confirmar | Enlace al oficial | Ya es libre: solo se guía y se configura |
| 19 | Notion | Editor propio de apuntes | Propio | Web | Notas y tablas simples; no la plataforma completa |
| 20 | Autodesk Forma | **Análisis de sitio** (propio, ecuaciones de la NOAA); QGIS en escritorio | MIT / GPL-2.0 | Web + escritorio | Sol, sombras, horas de sol, carta solar y COS sobre terreno plano; pendientes, viento, ruido y mapas, en QGIS |
| 21 | Miro | Excalidraw | MIT | Web | Muy bueno; colaboración en vivo, en una fase posterior |
| 22 | Premiere Pro | Kdenlive, Shotcut | GPL-3.0 | Escritorio | Edición real sí; en navegador no se ofrece |

## 2. Componentes web medidos

| Componente | Estado | Descarga medida | Memoria JS al abrir | Navegadores | Exigencia |
|---|---|---|---|---|---|
| miniPaint | Estable; último commit 2026-04-19 | 354 KB | 6 MB | Falta probar fuera de Chrome | Baja |
| Excalidraw | Estable | 651 KB | 8 MB | Falta probar fuera de Chrome | Baja |
| OpenSCAD web | **Alfa** | 8,7 MB | 27 MB | Falta probar fuera de Chrome | Media |
| LibreCAD web | **Experimental** | **25,2 MB** | 33 MB (sin contar memoria WebAssembly) | **Solo Chrome/Edge 137+** | Media |
| FreeCAD web | **Experimental** | ~96 MB, según su autor; no medido | No medido | Solo Chrome/Edge 137+ | **Alta**: no apto para el equipo modesto |
| MLightCAD | Activo; `cad-editor` sigue en preview | Falta medir la app | No medido | Falta probar | Por medir |

Para comparar: el panel de ESTRELLA tiene como límite 300 KB.

## 3. Descartados

| Candidato | Motivo |
|---|---|
| Outline | BSL 1.1, no es código abierto |
| tldraw | Producción exige licencia |
| Stirling-PDF | Necesita servidor y tiene partes con otra licencia |
| AFFiNE | Licencia mixta y backend aparte |
| AppFlowy, Logseq, SiYuan | AGPL-3.0: viable, pero pesa más de lo que aporta en la primera versión |
| Penpot | MPL-2.0 válida, pero probablemente requiere servidor (por confirmar) |

## 4. Conversor: qué se puede prometer

| Formato | Biblioteca | Qué hace Visor | Estado (2026-11-06) |
|---|---|---|---|
| DXF | dxf-parser (MIT), lector de Plano | Ver y convertir a SVG o PNG; avisa qué elementos no dibuja | Probado (T-07) |
| DWG R14–2018 | LibreDWG 0.7.5 (GPL-3.0) en un worker aparte | Ver, convertir a DXF, SVG o PNG. Tramas, cotas y textos especiales pueden variar | Probado con 7 archivos de ejemplo; e2e con uno real |
| PSD / PSB | ag-psd 31.0.3 (MIT) | Imagen combinada y lista de capas; si falta la combinada, se rearma con aviso | Probado (T-07) |
| PDF | PDF.js | Ver por páginas; página a PNG | Probado (T-07) |
| PNG, JPG, WebP, GIF, AVIF, BMP | Navegador | Ver y convertir entre PNG, JPG y WebP | Probado (T-07) |
| SVG | Navegador (dentro de `<img>`) | Ver sin ejecutar scripts ni cargar nada externo; a PNG | Probado (T-07) |
| RAW de cámara | Código propio | Vista previa JPG incrustada; se descarga sin recomprimir | Probado con un RAW simulado; falta con fotos reales |
| OBJ, STL, 3MF, PLY, glTF/GLB | three.js 0.186.1 (MIT) | Ver en 3D; convertir a GLB, OBJ, STL o captura PNG | OBJ y STL probados; 3MF, PLY y glTF sin archivo de prueba |
| IFC | web-ifc 0.0.78 (MPL-2.0) | Ver en 3D y contar muros, losas, puertas, ventanas…; a GLB, OBJ o STL | Probado (T-07) |
| AI | PDF.js | Solo si guarda copia PDF; si no, explica qué pedir | Detección probada |
| SKP, RVT, 3DM, MAX, FBX, BLEND | Sin lector libre en la web | **No se promete.** Visor dice qué exportación pedir | Mensaje probado |
| INDD, IDML, XD | Sin lector libre | **No se promete.** Pide PDF o IDML | Mensaje probado |
| TIFF, HEIC | — | Todavía no; Visor lo dice | Pendiente |

## 5. Programas propios de la fase 10 (2026-11-08)

| Programa | Reemplaza | Descarga al abrir (comprimido) | Prueba de extremo a extremo |
|---|---|---|---|
| Trazo | Illustrator | 16 KB | `tests/e2e/trazo.spec.ts` |
| Revelado | Lightroom | 10 KB | `tests/e2e/revelado.spec.ts` |
| Sólido | SketchUp, Rhino | 181 KB (incluye three.js) | `tests/e2e/solido.spec.ts` |
| BIM | Revit | 14 KB; el lector IFC (1,1 MB) y el 3D se descargan al abrir un modelo | `tests/e2e/bim.spec.ts` |
| Archivo | Bridge | 14 KB | `tests/e2e/archivo.spec.ts` |
| Análisis de sitio | Autodesk Forma | 17 KB | `tests/e2e/sitio.spec.ts` |

La descarga se mide como en la fase 3: HTML, estilos y scripts que el programa carga al abrirse, comprimidos. Cada programa pasa la revisión automática WCAG 2.2 AA (`tests/e2e/a11y.spec.ts`).
