import { FolderOpen, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, IconButton } from './components/Button';
import { relativeTime, type ProjectSummary } from './lib/library';
import { useStore } from './store';

/** Miniaturas: el SVG del resultado si cabe; si no, la imagen original. */
function useThumbs(projects: ProjectSummary[]) {
  const urls = useMemo(() => new Map(projects.map((p) => [p.id,
    p.thumb ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(p.thumb)}` : URL.createObjectURL(p.image)])), [projects]);
  useEffect(() => () => urls.forEach((u) => { if (u.startsWith('blob:')) URL.revokeObjectURL(u); }), [urls]);
  return urls;
}

function ProjectCard({ p, thumb, current }: { p: ProjectSummary; thumb?: string; current: boolean }) {
  const { openProject, renameProject, removeProject } = useStore.getState();
  const [editing, setEditing] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) input.current?.select(); }, [editing]);
  const commit = () => { setEditing(false); const v = input.current?.value.trim(); if (v && v !== p.name) void renameProject(p.id, v); };

  return (
    <li className="project" data-current={current}>
      <button type="button" className="project__open" onClick={() => void openProject(p.id)} aria-label={`Abrir ${p.name}`} disabled={editing}>
        <span className="project__thumb">
          {thumb && <img src={thumb} alt="" draggable={false} />}
        </span>
      </button>
      <div className="project__info">
        {editing ? (
          <input ref={input} className="project__rename" defaultValue={p.name} aria-label="Nombre del proyecto"
            onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { e.stopPropagation(); setEditing(false); } }} />
        ) : (
          <b title={p.name}>{p.name}</b>
        )}
        <span>{current ? 'Abierto ahora' : relativeTime(p.updatedAt)} · {p.layerCount} capas</span>
      </div>
      <div className="project__actions">
        <IconButton size="sm" label="Cambiar nombre" onClick={() => setEditing(true)}><Pencil /></IconButton>
        <IconButton size="sm" label="Eliminar del navegador" onClick={() => void removeProject(p.id)}><Trash2 /></IconButton>
      </div>
    </li>
  );
}

export function ProjectGrid({ limit }: { limit?: number }) {
  const projects = useStore((s) => s.projects);
  const current = useStore((s) => s.projectId);
  const shown = useMemo(() => (limit ? projects.slice(0, limit) : projects), [projects, limit]);
  const thumbs = useThumbs(shown);
  return (
    <ul className="projects__grid">
      {shown.map((p) => <ProjectCard key={p.id} p={p} thumb={thumbs.get(p.id)} current={p.id === current} />)}
    </ul>
  );
}

/** Recientes en la pantalla de inicio, para retomar el trabajo con un clic. */
export function RecentProjects() {
  const count = useStore((s) => s.projects.length);
  if (!count) return null;
  return (
    <section className="recent" onPointerDown={(e) => e.stopPropagation()}>
      <div className="recent__head">
        <h2 className="section__title">Proyectos recientes</h2>
        {count > 4 && <Button size="sm" variant="outline" onClick={() => useStore.getState().set({ projectsOpen: true })}>Ver los {count}</Button>}
      </div>
      <ProjectGrid limit={4} />
    </section>
  );
}

export function ProjectsDialog() {
  const open = useStore((s) => s.projectsOpen);
  const count = useStore((s) => s.projects.length);
  const hasSource = useStore((s) => !!s.source);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) { d.showModal(); void useStore.getState().refreshProjects(); }
    if (!open && d.open) d.close();
  }, [open]);
  const close = () => useStore.getState().set({ projectsOpen: false });
  return (
    <dialog ref={ref} className="projects" aria-labelledby="pj-title" onClose={close}
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="shortcuts__head">
        <div>
          <h2 id="pj-title" className="t-headline-md">Proyectos</h2>
          <p className="projects__note">Se guardan solos en este navegador mientras trabajas. Para llevarlos a otro equipo, usa «Guardar proyecto».</p>
        </div>
        <div className="projects__head-actions">
          {hasSource && <Button size="sm" variant="primary" icon={<Plus />} onClick={() => useStore.getState().newProject()}>Nuevo</Button>}
          <IconButton label="Cerrar" onClick={close}><X /></IconButton>
        </div>
      </div>
      {open && (count ? <ProjectGrid /> : (
        <div className="projects__empty"><FolderOpen /><p>Aún no hay proyectos. Abre una imagen y se guardará aquí automáticamente.</p></div>
      ))}
    </dialog>
  );
}
