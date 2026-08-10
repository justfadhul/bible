// Step 1: prove the data contract before anything visual exists.
import { CATEGORIES, ENTRIES_BY_CATEGORY, TOTAL, catalogProblems, meta } from './lib/catalog.js'

export default function App() {
  return (
    <main>
      <h1>{meta.title}</h1>
      <p>
        {TOTAL} entries across {CATEGORIES.length} categories.
      </p>
      {catalogProblems.length > 0 && (
        <ul>
          {catalogProblems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {CATEGORIES.map((c) => (
        <section key={c.id}>
          <h2>
            {c.name} ({ENTRIES_BY_CATEGORY.get(c.id).length})
          </h2>
          <p>{c.blurb}</p>
          <ol>
            {ENTRIES_BY_CATEGORY.get(c.id).map((e) => (
              <li key={e.id}>
                {e.topic} — {e.reference} [{e.size}, {e.testament}]
              </li>
            ))}
          </ol>
        </section>
      ))}
    </main>
  )
}
