// Display name for a run: explicit title, else "<disease> · MM-DD HH:mm" where the
// time is decoded from the campaign id's base36 suffix (set at creation by startRun,
// e.g. "egfr-mpw61ksv" -> egfr + the run's create time). Falls back to the raw id
// for legacy/manual campaigns whose suffix isn't a plausible timestamp.
export function runDisplayName(c: { campaign: string; disease: string | null; title: string | null }): string {
    if (c.title) return c.title
    const m = c.campaign.match(/-([0-9a-z]+)$/)
    if (m && c.disease) {
        const ts = parseInt(m[1], 36)
        if (ts > 1.5e12 && ts < 4e12) {
            const d = new Date(ts)
            const p = (n: number) => String(n).padStart(2, '0')
            return `${c.disease} · ${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
        }
    }
    return c.campaign
}
