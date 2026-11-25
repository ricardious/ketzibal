/** Atajos del editor. Se usan tanto para el diálogo de ayuda como para los títulos de los botones. */
export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = isMac ? '⌘' : 'Ctrl';

export const SHORTCUT_GROUPS: { title: string; items: [string[], string][] }[] = [
  {
    title: 'Archivo',
    items: [
      [[MOD, 'O'], 'Abrir imagen o proyecto'],
      [[MOD, 'V'], 'Pegar imagen'],
      [[MOD, 'S'], 'Guardar proyecto'],
      [[MOD, 'E'], 'Exportar SVG'],
      [[MOD, 'Mayús', 'C'], 'Copiar SVG'],
    ],
  },
  {
    title: 'Vista',
    items: [
      [['1'], 'Original'],
      [['2'], 'Vectorizado'],
      [['3'], 'Comparar'],
      [['4'], 'Superponer'],
      [['O'], 'Contornos'],
      [['E'], 'Ejes de simetría'],
      [['+', '−'], 'Acercar o alejar'],
      [['0'], 'Ajustar a la vista'],
      [['Espacio'], 'Mantén y arrastra para desplazarte'],
    ],
  },
  {
    title: 'Dibujo',
    items: [
      [['V'], 'Seleccionar y mover'],
      [['C'], 'Círculo'],
      [['R'], 'Rectángulo'],
      [['T'], 'Triángulo'],
      [['L'], 'Línea'],
      [['P'], 'Forma libre'],
      [['B'], 'Pluma Bézier'],
      [['K'], 'Dividir la capa seleccionada'],
      [['Mayús'], 'Al dibujar: proporciones iguales'],
      [['Alt'], 'Al dibujar: desde el centro'],
    ],
  },
  {
    title: 'Capas',
    items: [
      [['Clic'], 'Seleccionar'],
      [['Mayús', 'Clic'], 'Añadir a la selección'],
      [['Doble clic'], 'Editar nodos en aislamiento'],
      [['Doble clic en vacío'], 'Salir del aislamiento'],
      [['Clic derecho'], 'Más acciones'],
      [['↑', '↓', '←', '→'], 'Mover 1 px (Mayús: 10 px)'],
      [[MOD, 'D'], 'Duplicar'],
      [['H'], 'Ocultar o mostrar'],
      [['[', ']'], 'Bajar o subir en la pila'],
      [['Supr'], 'Eliminar'],
      [[MOD, 'Z'], 'Deshacer'],
      [[MOD, 'Mayús', 'Z'], 'Rehacer'],
      [['Esc'], 'Quitar selección o herramienta'],
    ],
  },
];
