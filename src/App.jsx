// Step 3: static wheel render check — wheel 1 (categories) and wheel 2
// (the largest category's entries) drawn straight from the catalog.
import Wheel from './components/Wheel.jsx'
import { CATEGORIES, ENTRIES_BY_CATEGORY, TOTAL } from './lib/catalog.js'

const biggest = [...CATEGORIES].sort(
  (a, b) => ENTRIES_BY_CATEGORY.get(b.id).length - ENTRIES_BY_CATEGORY.get(a.id).length,
)[0]

export default function App() {
  const catSegments = CATEGORIES.map((c) => ({ key: c.id, label: c.name, color: c.color }))
  const entrySegments = ENTRIES_BY_CATEGORY.get(biggest.id).map((e) => ({
    key: e.id,
    label: e.topic,
    color: biggest.color,
    tint: true,
  }))

  return (
    <main className="mx-auto max-w-md p-4 space-y-8">
      <p className="eyebrow">Wheel 1 — {CATEGORIES.length} categories, {TOTAL} entries</p>
      <Wheel segments={catSegments} hubLabel={TOTAL} hubSub="LEFT" maxLines={2} title="Category wheel" />
      <p className="eyebrow">
        Wheel 2 — {biggest.name}, {entrySegments.length} entries
      </p>
      <Wheel segments={entrySegments} hubLabel={entrySegments.length} hubSub="LEFT" title="Entry wheel" />
    </main>
  )
}
