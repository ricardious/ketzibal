import { ImageUp, Moon, Sun, SunMoon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ACCEPTED, APP_URL, stashFile } from '../shared/handoff';
import { HeroDemo } from './HeroDemo';
import { HowItWorks } from './HowItWorks';

type Theme = 'system' | 'light' | 'dark';
const NEXT: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' };
const THEME_LABEL: Record<Theme, string> = { system: 'Tema: sistema', light: 'Tema: claro', dark: 'Tema: oscuro' };
const readTheme = (): Theme => { try { return (localStorage.getItem('ketzibal-theme') as Theme) || 'system'; } catch { return 'system'; } };

const FEATURES: { title: string; text: string }[] = [
  { title: 'Una capa por figura', text: 'Con nombres legibles y en el orden en que se pintan. Ocúltalas, renómbralas, reordénalas arrastrando o recolorea toda la ilustración.' },
  { title: 'Dibujo lineal con su trazo', text: 'Las líneas de contorno se reconocen como tinta y se exportan con stroke y su grosor real, no como rellenos delgados.' },
  { title: 'Edición sobre el lienzo', text: 'Mueve nodos y manejadores, dibuja figuras nuevas, divide una pieza con un corte recto o une trazos.' },
  { title: 'Simetría exacta', text: 'Si una figura es simétrica en más de un 94 %, se ajusta media figura y se refleja. Las figuras gemelas de una composición quedan idénticas.' },
  { title: 'Compara con el original', text: 'Divisor, superposición con opacidad y una medida de precisión que compara el SVG con la imagen píxel a píxel.' },
  { title: 'SVG que se puede leer', text: 'Primitivas nativas como circle, rect o polygon, huecos con fill-rule y números sin ceros sobrantes.' },
];

export function Landing() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const depth = useRef(0);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', theme);
    try { localStorage.setItem('ketzibal-theme', theme); } catch { /* sin almacenamiento */ }
  }, [theme]);

  const open = async (f: File | undefined) => {
    if (!f) return;
    if (!ACCEPTED.includes(f.type)) { setError('Ese archivo no es PNG, JPG ni WebP.'); return; }
    setBusy(true);
    setError('');
    await stashFile(f);
    location.href = APP_URL;
  };

  // Soltar una imagen en cualquier parte de la página la abre en el editor.
  useEffect(() => {
    const isFile = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
    const enter = (e: DragEvent) => { if (isFile(e)) { depth.current++; setOver(true); } };
    const leave = (e: DragEvent) => { if (isFile(e) && --depth.current <= 0) { depth.current = 0; setOver(false); } };
    const overFn = (e: DragEvent) => { if (isFile(e)) e.preventDefault(); };
    const drop = (e: DragEvent) => {
      if (!isFile(e)) return;
      e.preventDefault(); depth.current = 0; setOver(false);
      void open([...(e.dataTransfer?.files ?? [])][0]);
    };
    const paste = (e: ClipboardEvent) => {
      const f = [...(e.clipboardData?.files ?? [])].find((x) => ACCEPTED.includes(x.type));
      if (f) { e.preventDefault(); void open(f); }
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', overFn);
    window.addEventListener('drop', drop);
    window.addEventListener('paste', paste);
    return () => {
      window.removeEventListener('dragenter', enter); window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', overFn); window.removeEventListener('drop', drop); window.removeEventListener('paste', paste);
    };
  }, []);

  const ThemeIcon = theme === 'light' ? Sun : theme === 'dark' ? Moon : SunMoon;
  const pick = () => input.current?.click();

  return (
    <div className="lp">
      <input ref={input} type="file" accept={ACCEPTED.join(',')} hidden onChange={(e) => { void open(e.target.files?.[0]); e.target.value = ''; }} />

      <header className="lp-nav">
        <a className="lp-brand" href="./">
          <img src={`${import.meta.env.BASE_URL}ketzvia-quetzal.svg`} alt="" />
          <span>Ketzibal</span>
        </a>
        <nav aria-label="Secciones">
          <a href="#proceso">Cómo funciona</a>
          <a href="#editor">El editor</a>
          <a href="#privacidad">Privacidad</a>
        </nav>
        <button type="button" className="lp-icon" aria-label={THEME_LABEL[theme]} title={THEME_LABEL[theme]} onClick={() => setTheme(NEXT[theme])}><ThemeIcon /></button>
        <a className="lp-btn lp-btn--small" href={APP_URL}>Abrir el editor</a>
      </header>

      <main>
        <section className="lp-hero">
          <div className="lp-hero__copy">
            <h1>De píxeles<br />a figuras.</h1>
            <p className="lp-lede">
              Ketzibal convierte un logotipo, un icono o una ilustración en SVG reconstruyendo sus figuras:
              los círculos salen como círculos, los triángulos con sus tres vértices exactos, y cada figura en su propia capa.
            </p>
            <div className="lp-drop" data-over={over}>
              <button type="button" className="lp-btn" onClick={pick} disabled={busy}>
                <ImageUp aria-hidden />{busy ? 'Abriendo el editor…' : 'Elegir una imagen'}
              </button>
              <span>o suéltala en cualquier parte de esta página</span>
            </div>
            {error && <p className="lp-error" role="alert">{error}</p>}
            <p className="lp-small">
              PNG, JPG o WebP. ¿No tienes una a mano? <a href={`${APP_URL}?ejemplo`}>Prueba con el ejemplo</a>.
            </p>
          </div>
          <HeroDemo />
        </section>

        <section className="lp-section" id="proceso" aria-labelledby="proceso-t">
          <div className="lp-section__head">
            <h2 id="proceso-t">Cómo lee una imagen</h2>
            <p>Calcar píxeles produce cientos de nodos temblorosos. Ketzibal hace lo que haría una persona con una pluma: decide qué figura es cada mancha de color. Recorre los pasos con el quetzal.</p>
          </div>
          <HowItWorks />
        </section>

        <section className="lp-section lp-editor" id="editor" aria-labelledby="editor-t">
          <div className="lp-section__head">
            <h2 id="editor-t">El resultado se puede retocar</h2>
            <p>La vectorización es un punto de partida. Compara con el original, corrige lo que haga falta y exporta.</p>
          </div>
          <dl className="lp-features">
            {FEATURES.map((f) => (
              <div key={f.title}><dt>{f.title}</dt><dd>{f.text}</dd></div>
            ))}
          </dl>
          <p className="lp-fit">
            Funciona mejor con colores planos. Las fotografías y los degradados se reducen a la paleta detectada, así que el resultado será un póster, no una copia.
          </p>
        </section>

        <section className="lp-privacy" id="privacidad" aria-labelledby="priv-t">
          <h2 id="priv-t">Tu imagen no sale de tu equipo</h2>
          <p>Todo el cálculo ocurre en tu navegador, en un proceso aparte para que la página no se congele. No hay servidor que reciba archivos, ni cuenta que crear.</p>
          <div className="lp-cta">
            <button type="button" className="lp-btn" onClick={pick} disabled={busy}><ImageUp aria-hidden />Elegir una imagen</button>
            <a className="lp-btn lp-btn--ghost" href={APP_URL}>Abrir el editor vacío</a>
          </div>
        </section>
      </main>

      <footer className="lp-foot">
        <span>Ketzibal, parte del sistema Ketzvia.</span>
        <a href={APP_URL}>Editor</a>
      </footer>

      {over && <div className="lp-veil" aria-hidden><span>Suelta la imagen para vectorizarla</span></div>}
    </div>
  );
}
