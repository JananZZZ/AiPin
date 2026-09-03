import { Plus } from "lucide-react";

export function EmptyPane({ onAdd }: { onAdd: () => void }) {
  return (
    <section className="pane empty-pane" aria-label="空模型窗格">
      <button type="button" onClick={onAdd} className="empty-pane-action">
        <span className="empty-plus"><Plus size={17} strokeWidth={1.5} /></span>
        <span>添加模型</span>
      </button>
    </section>
  );
}
