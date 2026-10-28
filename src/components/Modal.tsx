import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export default function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return (
    <dialog ref={ref} aria-label={title} onCancel={event => { event.preventDefault(); onClose(); }} className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-3xl border border-zinc-700 bg-zinc-950 p-0 text-zinc-100 shadow-2xl backdrop:bg-black/80">
      <div className="max-h-[calc(var(--app-height)-3rem)] overflow-y-auto p-5 sm:p-6">
        <div className="mb-5 flex items-start justify-between gap-4">
          <h2 className="text-xl font-bold">{title}</h2>
          <button type="button" onClick={onClose} aria-label={`Close ${title}`} className="rounded-xl p-2 text-zinc-400 hover:bg-zinc-800 focus-visible:outline focus-visible:outline-emerald-400"><X size={20} /></button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
