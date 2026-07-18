import styles from './About.module.css'

export function About() {
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <section className={styles.hero}>
          <span className={styles.eyebrow}>About the project</span>
          <h1 className={styles.title}>Finding the Finger</h1>
          <p className={styles.lede}>
            Finding the Finger is a semantic reading and exploration tool for comparing
            religious, philosophical, and historical texts inside a shared searchable space.
          </p>
          <p className={styles.quote}>
            “The finger pointing at the moon is not the moon.”
          </p>
        </section>

        <section className={styles.grid}>
          <article className={styles.card}>
            <h2 className={styles.sectionTitle}>What this site is for</h2>
            <p className={styles.text}>
              The project brings together corpora that are usually read inside separate
              traditions and lets you move between them through search, structure, and
              semantic proximity. Instead of treating each text as an isolated archive, the
              app is designed to make resonances, contrasts, and recurring themes easier to
              notice.
            </p>
            <p className={styles.text}>
              You can search across traditions, browse corpus hierarchies, read passages in
              context, and explore projection maps built from embedding data. The goal is
              not to flatten differences between sources, but to create a practical way to
              study them side by side.
            </p>
            <div className={styles.pillRow}>
              <span className={styles.pill}>Cross-tradition search</span>
              <span className={styles.pill}>Passage reading</span>
              <span className={styles.pill}>Corpus browsing</span>
              <span className={styles.pill}>Projection maps</span>
            </div>
          </article>

          <aside className={styles.card}>
            <h2 className={styles.sectionTitle}>How it works</h2>
            <ul className={styles.list}>
              <li className={styles.listItem}>
                <span className={styles.listLabel}>Ingest</span>
                <p className={styles.listBody}>
                  Source texts are parsed into a shared hierarchical model with corpus and
                  taxonomy metadata.
                </p>
              </li>
              <li className={styles.listItem}>
                <span className={styles.listLabel}>Embed</span>
                <p className={styles.listBody}>
                  Passages and spans are encoded into vector space so semantically related
                  material can be compared across corpora.
                </p>
              </li>
              <li className={styles.listItem}>
                <span className={styles.listLabel}>Explore</span>
                <p className={styles.listBody}>
                  The frontend layers search, reading, and map-based navigation on top of
                  those processed text relationships.
                </p>
              </li>
            </ul>
          </aside>
        </section>
      </div>
    </main>
  )
}
