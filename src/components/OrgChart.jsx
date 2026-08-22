import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Users, Pencil, Check, X, Plus, Trash2, ArrowUp, ArrowDown, Loader2 } from 'lucide-react';
import { listCommittees, groupByTier, updateOfficer, addPosition, removePosition, reorderPositions } from '../lib/orgOps';
import { supabase } from '../lib/supabaseClient';

export default function OrgChart() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [toast, setToast] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listCommittees());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const channelNameRef = useRef(`committees-realtime-${Math.random().toString(36).slice(2)}`);
  useEffect(() => {
    const channel = supabase
      .channel(channelNameRef.current)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'committees_officers' }, () => refresh())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [refresh]);

  const tiers = groupByTier(rows);

  function notify(msg) {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  }

  async function handleRename(position, patch) {
    await updateOfficer(position.id, patch);
    refresh();
  }

  async function handleAddPosition(tier) {
    const nextOrder = Math.max(0, ...tier.positions.map((p) => p.position_order)) + 1;
    await addPosition(tier.group_name, tier.group_order, 'New position', nextOrder);
    refresh();
  }

  async function handleRemovePosition(id) {
    await removePosition(id);
    refresh();
  }

  async function handleMove(tier, index, direction) {
    const positions = [...tier.positions];
    const target = index + direction;
    if (target < 0 || target >= positions.length) return;
    [positions[index], positions[target]] = [positions[target], positions[index]];
    await reorderPositions(tier.group_name, positions.map((p) => p.id));
    notify('Order updated');
    refresh();
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 md:px-6 py-3 border-b border-slate-800 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Committees &amp; Org Chart</h1>
          <p className="text-xs text-slate-500">Synced with Task assignments and Meeting Notes committee selectors</p>
        </div>
        <button
          onClick={() => setEditMode((v) => !v)}
          className={`flex items-center gap-1.5 text-sm px-3 py-2 rounded-xl ${
            editMode ? 'bg-accent-500 hover:bg-accent-600' : 'bg-slate-800 hover:bg-slate-700'
          }`}
        >
          <Pencil size={14} /> {editMode ? 'Done editing' : 'Edit chart'}
        </button>
      </div>

      {toast && <div className="mx-4 mt-2 text-xs bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5">{toast}</div>}

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {loading ? (
          <div className="h-full flex items-center justify-center text-slate-500">
            <Loader2 className="animate-spin mr-2" size={18} /> Loading org chart…
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 max-w-3xl mx-auto">
            {tiers.map((tier, tierIdx) => (
              <React.Fragment key={tier.group_name}>
                {tierIdx > 0 && <div className="w-px h-4 bg-slate-700" />}
                <div className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-accent-400">{tier.group_name}</h3>
                    {editMode && (
                      <button
                        onClick={() => handleAddPosition(tier)}
                        className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300"
                      >
                        <Plus size={11} /> Add position
                      </button>
                    )}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
                    {tier.positions.map((position, i) => (
                      <PositionCard
                        key={position.id}
                        position={position}
                        editMode={editMode}
                        onRename={(patch) => handleRename(position, patch)}
                        onRemove={() => handleRemovePosition(position.id)}
                        onMoveUp={() => handleMove(tier, i, -1)}
                        onMoveDown={() => handleMove(tier, i, 1)}
                        isFirst={i === 0}
                        isLast={i === tier.positions.length - 1}
                      />
                    ))}
                  </div>
                </div>
              </React.Fragment>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function PositionCard({ position, editMode, onRename, onRemove, onMoveUp, onMoveDown, isFirst, isLast }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(position.position_title);
  const [name, setName] = useState(position.officer_name || '');

  function save() {
    onRename({ position_title: title, officer_name: name });
    setEditing(false);
  }

  return (
    <div className="border border-slate-800 rounded-xl p-3 bg-slate-950/60">
      {editing ? (
        <div className="space-y-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Position title"
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs"
          />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Officer name"
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs"
          />
          <div className="flex justify-end gap-1.5">
            <button onClick={() => setEditing(false)} className="p-1.5 rounded-md hover:bg-slate-800 text-slate-400">
              <X size={13} />
            </button>
            <button onClick={save} className="p-1.5 rounded-md bg-accent-500 hover:bg-accent-600">
              <Check size={13} />
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2 min-w-0">
            <Users size={15} className="text-slate-500 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-200 truncate">{position.position_title}</p>
              <p className="text-xs text-slate-500 truncate">{position.officer_name || 'Vacant'}</p>
            </div>
          </div>
          {editMode && (
            <div className="flex flex-col gap-1 shrink-0">
              <button onClick={() => setEditing(true)} className="p-1 rounded-md hover:bg-slate-800 text-slate-400">
                <Pencil size={12} />
              </button>
              <div className="flex gap-1">
                <button onClick={onMoveUp} disabled={isFirst} className="p-1 rounded-md hover:bg-slate-800 text-slate-400 disabled:opacity-30">
                  <ArrowUp size={12} />
                </button>
                <button onClick={onMoveDown} disabled={isLast} className="p-1 rounded-md hover:bg-slate-800 text-slate-400 disabled:opacity-30">
                  <ArrowDown size={12} />
                </button>
              </div>
              <button onClick={onRemove} className="p-1 rounded-md hover:bg-red-950/50 text-slate-500 hover:text-red-300">
                <Trash2 size={12} />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
