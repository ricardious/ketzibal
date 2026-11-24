# Ketzibal

Convierte imágenes PNG, JPG y WebP en SVG **reconstruyendo las figuras originales** en lugar de calcar píxeles. Cada figura se convierte en una capa vectorial independiente, ordenada de afuera hacia adentro. Cuando es posible, la figura se reconoce como una primitiva exacta (círculo, elipse, rectángulo, polígono regular, estrella); si no, se conserva como un trazado Bézier limpio y, cuando corresponde, simétrico.

Todo el procesamiento ocurre en el navegador, dentro de un Web Worker. Ninguna imagen sale del equipo.

```bash
pnpm install
pnpm dev        # http://localhost:5173
pnpm build      # comprobación de tipos y compilación de producción en dist/
pnpm test       # pruebas del motor geométrico
```

## Arquitectura

```
src/
├── engine/          Motor de vectorización: TypeScript puro, sin DOM ni React
│   ├── quantize.ts  Paleta k-means++ en OKLab
│   ├── regions.ts   Componentes conexas, limpieza de ruido y huecos
│   ├── contour.ts   Seguimiento de bordes por aristas de píxel
│   ├── curve.ts     Esquinas, suavizado y ajuste de Bézier (Schneider)
│   ├── shapes.ts    Reconocimiento y ajuste de primitivas
│   ├── symmetry.ts  Ejes de simetría y simetrización
│   ├── pipeline.ts  Orquestación por capas, orden Z y compleción de ocultas
│   ├── svg.ts       Serialización SVG mínima
│   ├── worker.ts    Punto de entrada del Web Worker
│   └── client.ts    API asíncrona y cancelable para la interfaz
└── ui/              Interfaz React (estado con Zustand)
    ├── components/  Componentes del sistema de diseño Ketzvia
    ├── store.ts     Estado, historial (deshacer y rehacer) y métrica de precisión
    └── …            Barra superior, panel de capas, lienzo e inspector
```

La interfaz solo usa `engine/index.ts`. El motor recibe un búfer RGBA y devuelve capas tipadas (`Layer`), así que se puede probar y reutilizar sin navegador.

## Algoritmo

1. **Paleta.** Se ejecuta k-means++ en el espacio perceptual OKLab, entrenado solo con píxeles *planos* (sin gradiente local) para que el antialiasing y los artefactos JPEG no generen colores intermedios. Los centros casi idénticos se fusionan.
2. **Limpieza.** Las regiones menores que el *detalle mínimo* y las franjas de 1–2 px cuyo color real está entre el de sus dos vecinas (bordes con antialiasing) se reparten entre las regiones vecinas, creciendo desde el borde.
3. **Jerarquía de afuera hacia adentro.** Para cada región se calculan sus huecos. Una región dentro del hueco de otra es su hija. Un hueco es *real* (se ve a través de él) cuando su contenido tiene el color de lo que hay debajo de la figura; en caso contrario se rellena y el contenido se pinta encima. Esto convierte, por ejemplo, un anillo en un círculo con un hueco circular en vez de dos figuras.
4. **Orden Z entre hermanas.** Si dos figuras se tocan, la que presenta un borde cóncavo hacia la otra (la frontera queda hundida dentro de su cierre convexo) está *debajo*.
5. **Contornos.** El borde se recorre por aristas de píxel con 4-conectividad. Las esquinas se detectan por giro local y se afinan intersecando las tangentes de ambos lados. Entre esquinas se aplica suavizado gaussiano y se ajustan cúbicas de Bézier con el algoritmo de Schneider. Los tramos rectos se exportan como `L`.
6. **Reconocimiento de formas.** Se prueban, en orden de simplicidad: círculo (Kåsa + refinamiento geométrico de Landau), elipse (ajuste directo de Halir–Flusser), rectángulo rotado y redondeado (rectángulo mínimo con calibres rotatorios y radio estimado por déficit de área), y polígono por rectas de mínimos cuadrados (con ángulos de 0°, 45° y 90° fijados y regularización de polígonos regulares y estrellas). Se acepta la primera forma cuyo error medio y percentil 95 quedan dentro de la tolerancia.
7. **Figuras ocultas.** Los puntos del borde que lindan con una capa superior (o con el límite de la imagen) se marcan como no visibles. El ajuste usa solo los bordes visibles y la forma completada se valida: debe extenderse únicamente bajo capas superiores. Así, un círculo tapado por un cuadrado se exporta como el círculo completo. Los trazados libres se extienden 2 px bajo sus vecinas superiores para evitar rendijas.
8. **Simetría.** El eje de cada figura se busca entre el vertical, el horizontal y los ejes principales, maximizando el IoU entre la máscara y su reflejo, con refinamiento subpíxel. Si supera el 94 %, se promedia cada mitad con el reflejo de la otra, se ajusta media figura y se refleja, lo que da un trazado exactamente simétrico. También se detecta un eje global de la composición: las figuras gemelas a ambos lados se vuelven reflejos exactos.

## Uso

- **Importar imagen**: con el botón, arrastrando el archivo al lienzo o pegándolo con Ctrl+V. También hay una imagen de ejemplo.
- **Vistas**: *Original*, *Vectorizado*, *Comparar* (divisor arrastrable) y *Superponer* (opacidad ajustable). *Contornos* muestra la estructura alámbrica y *Ejes de simetría* muestra las guías.
- **Capas**: selecciona una capa en la lista o en el lienzo. Arrastra para reordenar (o Alt+↑/↓). Doble clic o F2 para renombrar. Usa el ojo para ocultarla.
- **Inspector → Capa**: relleno, opacidad, desplazamiento, alternar entre la forma reconocida y el trazado libre, convertir en trazado, *Aislar capa*, cambiar el orden y eliminar.
- **Lienzo**: arrastra una capa para moverla, usa las flechas para desplazarla 1 px (Mayús: 10 px), Ctrl + rueda para hacer zoom y la rueda o arrastrar el fondo para desplazarte.
- **Ctrl+Z / Ctrl+Mayús+Z**: deshacer y rehacer. **Supr**: eliminar la capa. **Esc**: quitar la selección.
- **Exportar SVG**: una capa por elemento, con identificadores legibles, primitivas nativas (`circle`, `ellipse`, `rect`, `polygon`), huecos con `fill-rule="evenodd"` y números sin ceros sobrantes.

La métrica **Precisión** rasteriza el SVG resultante y lo compara píxel a píxel con el original.

## Limitaciones conocidas

- Está pensado para ilustraciones, logotipos e iconos de colores planos. Las fotografías y los degradados se reducen a la paleta y no se generan degradados SVG.
- La compleción de figuras ocultas solo es posible cuando se ve al menos parte de cada lado. Si un lado queda completamente tapado, se conserva la forma visible.
- Los bordes se sitúan con una precisión de unos 0,3 px (no se aprovecha aún la cobertura subpíxel del antialiasing). En vértices muy agudos ese error se amplifica.
