import { useEffect, useRef } from 'react';

/** Rasteriza un SVG a baja resolución y lo muestra ampliado, con los píxeles a la vista. */
export function PixelImage({ markup, size, className, style }: { markup: string; size: number; className?: string; style?: React.CSSProperties }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      const c = canvas.current;
      if (!c) return;
      c.width = size; c.height = size;
      c.getContext('2d')!.drawImage(img, 0, 0, size, size);
    };
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  }, [markup, size]);
  return <canvas ref={canvas} className={className} style={style} aria-hidden />;
}
