# Paridad de Plano con el dibujo 2D de pago

Medición de cuánto del dibujo 2D de un programa de CAD de pago cubre Plano. Los nombres de comandos aparecen solo para describir funciones.

## Método

1. **Alcance:** el dibujo 2D que hace un estudiante de arquitectura. Es decir, dibujar con medidas exactas, editar, anotar, organizar en capas y bloques, e imprimir a escala. El 3D, el render, la programación y los flujos profesionales quedan fuera; se marcan `skip` con su motivo.
2. **Fuente:** la lista pública de comandos y atajos del fabricante, <https://www.autodesk.com/shortcuts/autocad>, consultada el 2026-11-06. No se usó una cuenta ni el programa, ni se copió código, textos o íconos.
3. **Matriz:** [`features.csv`](features.csv). Cada función tiene prioridad (`must` imprescindible, `should` conveniente, `could` adicional) y dice si Plano la tiene (`yes`, `partial`, `no` o `skip`).
4. **Puntaje:** `parity.py` de la skill replica-diff. Pondera 3, 2 y 1 por prioridad, y lo parcial cuenta como la mitad. El informe está en [`parity.md`](parity.md).
5. **Evidencia:** una función se marca `yes` solo si hay una prueba automática que la ejerce. Están en `frontend/tests/unit/plano-edit.test.ts` y `frontend/tests/e2e/plano-edit.spec.ts`.

No hay comparación de capturas de pantalla. La interfaz de Plano es propia a propósito, y su aspecto no se compara con el del original.

## Resultado

| Fecha | Puntaje | Imprescindibles | Qué cambió |
|---|---|---|---|
| 2026-11-06 | 42,5 / 100 | 14 de 26 | Línea de base |
| 2026-11-06 | 76,0 / 100 | 27 de 27 | Arco, mover con distancia, copiar, rotar, simetría, escala, desfase, recortar, referencias a objetos completas, cotas H/V, sombreado, bloques, abrir DWG directo, PDF a escala, línea de comandos, medir, Ctrl+A/C/V |

## Lo que sigue, por orden del informe

Cotas de radio, diámetro y ángulo; directrices; texto de varias líneas; varias presentaciones; elipse; polígono regular; alargar; empalme y chaflán; matrices; capas con color, tipo y grosor de línea; ventana de propiedades.
