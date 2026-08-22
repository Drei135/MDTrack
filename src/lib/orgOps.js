import { supabase, isOnline } from './supabaseClient';
import { cacheRows, getCachedRows, upsertCachedRow, removeCachedRow, queueSuiteAction } from './offlineDbSuite';

const uuid = () =>
  crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export async function listCommittees() {
  if (isOnline()) {
    const { data, error } = await supabase
      .from('committees_officers')
      .select('*')
      .order('group_order', { ascending: true })
      .order('position_order', { ascending: true });
    if (error) throw error;
    await cacheRows('committees', data);
    return data;
  }
  const rows = await getCachedRows('committees');
  return rows.sort((a, b) => a.group_order - b.group_order || a.position_order - b.position_order);
}

/** Groups a flat committees_officers list into { group_name, group_order, positions: [] } tiers. */
export function groupByTier(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.group_name)) {
      map.set(row.group_name, { group_name: row.group_name, group_order: row.group_order, positions: [] });
    }
    map.get(row.group_name).positions.push(row);
  }
  return [...map.values()].sort((a, b) => a.group_order - b.group_order);
}

/** Unique list of committee/group labels, for Task assignment + MOM committee selectors. */
export function committeeLabels(rows) {
  return [...new Set(rows.map((r) => r.group_name))];
}

/**
 * Committee labels for the MOM committee-assignment checklist. Excludes the
 * "Adviser" group, which isn't a task-taking committee.
 */
export function momCommitteeLabels(rows) {
  return committeeLabels(rows).filter((name) => name.toLowerCase() !== 'adviser');
}

/**
 * Filled (non-vacant) officer seats from the org chart, for the "Presiding
 * officer" / "Prepared by" / "Reviewed by" dropdowns on the MOM Generator.
 * Each entry keeps the position title and the plain name separately so the
 * UI can choose to show one or both.
 */
export function listOfficers(rows) {
  return rows
    .filter((r) => (r.officer_name || '').trim() && r.group_name.toLowerCase() !== 'adviser')
    .map((r) => ({
      id: r.id,
      name: r.officer_name.trim(),
      title: r.position_title,
      group: r.group_name,
      label: `${r.position_title} - ${r.officer_name.trim()}`
    }));
}

/** The currently filled Adviser seat, if any (auto-fills the MOM "Noted by" line). */
export function getAdviser(rows) {
  const row = rows.find((r) => r.group_name.toLowerCase() === 'adviser' && (r.officer_name || '').trim());
  if (!row) return null;
  return { name: row.officer_name.trim(), title: row.position_title };
}

export async function updateOfficer(id, patch) {
  await upsertCachedRow('committees', { id, ...patch, updated_at: new Date().toISOString() });
  if (isOnline()) {
    const { data, error } = await supabase.from('committees_officers').update(patch).eq('id', id).select().single();
    if (error) throw error;
    await upsertCachedRow('committees', data);
    return data;
  }
  await queueSuiteAction('committee', 'update', { id, ...patch });
  return { id, ...patch };
}

export async function addPosition(groupName, groupOrder, positionTitle, positionOrder) {
  const id = uuid();
  const row = {
    id,
    group_name: groupName,
    group_order: groupOrder,
    position_title: positionTitle,
    position_order: positionOrder,
    officer_name: '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  await upsertCachedRow('committees', row);
  if (isOnline()) {
    const { data, error } = await supabase.from('committees_officers').insert(row).select().single();
    if (error) throw error;
    await upsertCachedRow('committees', data);
    return data;
  }
  await queueSuiteAction('committee', 'create', row);
  return row;
}

export async function removePosition(id) {
  await removeCachedRow('committees', id);
  if (isOnline()) {
    const { error } = await supabase.from('committees_officers').delete().eq('id', id);
    if (error) throw error;
  } else {
    await queueSuiteAction('committee', 'delete', { id });
  }
}

/** Persists a full reorder (drag-and-drop result) as a batch of position_order updates. */
export async function reorderPositions(groupName, orderedIds) {
  await Promise.all(
    orderedIds.map((id, index) => updateOfficer(id, { position_order: index + 1 }))
  );
}

export async function reorderGroups(orderedGroupNames, rowsByGroup) {
  await Promise.all(
    orderedGroupNames.flatMap((groupName, index) =>
      (rowsByGroup.get(groupName) || []).map((row) => updateOfficer(row.id, { group_order: index + 1 }))
    )
  );
}
