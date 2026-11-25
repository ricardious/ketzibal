import { Circle, RectangleHorizontal, Slash, Triangle } from 'lucide-react';
import type { ReactNode } from 'react';
import type { FigureType } from './figures';

export const EllipseIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><ellipse cx="12" cy="12" rx="10" ry="6.5" /></svg>;
export const SemicircleIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M3 16a9 9 0 0 1 18 0Z" /></svg>;

export const FIGURE_ICONS: Record<FigureType, ReactNode> = {
  circle: <Circle />,
  ellipse: <EllipseIcon />,
  rect: <RectangleHorizontal />,
  triangle: <Triangle />,
  semicircle: <SemicircleIcon />,
  line: <Slash />,
};
