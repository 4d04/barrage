/** Canonical JSON: sorted keys, no undefined. Byte-identical across nodes for the same value. */
export function canonicalJSON(v: unknown): string {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(canonicalJSON).join(',') + ']';
    const o = v as Record<string, unknown>;
    const parts: string[] = [];
    for (const k of Object.keys(o).sort()) {
        if (o[k] === undefined) continue;
        parts.push(JSON.stringify(k) + ':' + canonicalJSON(o[k]));
    }
    return '{' + parts.join(',') + '}';
}
