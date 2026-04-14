import { useState } from "react";
import type { TaxonomyLabel } from "../api/types";
import { getTaxonomyColors, type TaxonomyColorItem } from "../utils/taxonomyColors";
import styles from "./ColorChecker.module.css";

interface TaxonomyPreviewNode {
  name: string;
  children?: TaxonomyPreviewNode[];
}

const TAXONOMY_TREE: TaxonomyPreviewNode[] = [
  {
    name: "Abrahamic",
    children: [{ name: "Judaism" }, { name: "Christianity" }, { name: "Islam" }],
  },
  {
    name: "Indic (Dharmic)",
    children: [
      { name: "Hinduism" },
      { name: "Buddhism" },
      { name: "Jainism" },
      { name: "Sikhism" },
    ],
  },
  {
    name: "East Asian",
    children: [
      { name: "Taoism" },
      { name: "Confucianism" },
      { name: "Shinto" },
      { name: "Zen" },
    ],
  },
  {
    name: "Persian",
    children: [{ name: "Zoroastrianism" }],
  },
  {
    name: "Indigenous",
    children: [
      { name: "North American" },
      { name: "Mesoamerican" },
      { name: "South American" },
      { name: "African" },
      { name: "Oceanian" },
      { name: "Aboriginal Australian" },
    ],
  },
  {
    name: "Ancient / Historical",
    children: [
      { name: "Greek" },
      { name: "Roman" },
      { name: "Egyptian" },
      { name: "Mesopotamian" },
      { name: "Norse / Germanic" },
      { name: "Celtic" },
    ],
  },
  {
    name: "New Religious Movements",
    children: [
      { name: "Scientology" },
      { name: "Bahá'í" },
      { name: "Neo-Paganism / Wicca" },
      { name: "Other modern movements" },
    ],
  },
  {
    name: "Other (Sacred)",
  },
  {
    name: "Non Sacred",
    children: [
      { name: "Philosophy" },
      { name: "Scientific" },
      { name: "Literature" },
      { name: "Plays" },
      { name: "Speeches" },
      { name: "Historical" },
    ],
  },
];

function taxonomyLabel(
  id: number,
  name: string,
  level: number,
  parentId: number | null,
): TaxonomyLabel {
  return { id, name, level, parent_id: parentId };
}

function colorText(item: TaxonomyColorItem): string {
  const { h, s, l } = item.hsl;
  return `hsl(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(l)}%)`;
}

function RootRow({
  root,
  index,
  copiedValue,
  onCopyColor,
}: {
  root: TaxonomyPreviewNode;
  index: number;
  copiedValue: string | null;
  onCopyColor: (item: TaxonomyColorItem) => void;
}) {
  const rootLabel = taxonomyLabel(index + 1, root.name, 0, null);
  const rootColor = getTaxonomyColors([rootLabel])[0];
  const children = root.children ?? [];

  return (
    <section className={styles.group}>
      <header
        className={styles.rootHeader}
        style={
          {
            "--root-color": rootColor.solid,
            "--root-dim": rootColor.dim,
          } as React.CSSProperties
        }
      >
        <button
          className={styles.rootSwatch}
          type="button"
          title={`Copy ${root.name}: ${colorText(rootColor)}`}
          aria-label={`Copy ${root.name} color`}
          onClick={() => onCopyColor(rootColor)}
        />
        <div className={styles.rootText}>
          <h2 className={styles.rootName}>{root.name}</h2>
          {copiedValue === colorText(rootColor) && (
            <span className={styles.copied}>Copied</span>
          )}
        </div>
      </header>

      {children.length > 0 && (
        <div className={styles.childGrid}>
          {children.map((child, childIndex) => {
            const childLabel = taxonomyLabel(
              (index + 1) * 100 + childIndex + 1,
              child.name,
              1,
              rootLabel.id,
            );
            const items = getTaxonomyColors([rootLabel, childLabel]);
            const childColor = items[0];
            return (
              <article
                key={child.name}
                className={styles.child}
                style={
                  {
                    "--child-color": childColor.solid,
                    "--child-dim": childColor.dim,
                  } as React.CSSProperties
                }
              >
                <button
                  className={styles.childSwatch}
                  type="button"
                  title={`Copy ${child.name}: ${colorText(childColor)}`}
                  aria-label={`Copy ${child.name} color`}
                  onClick={() => onCopyColor(childColor)}
                />
                <div className={styles.childText}>
                  <h3 className={styles.childName}>{child.name}</h3>
                  {copiedValue === colorText(childColor) && (
                    <span className={styles.copied}>Copied</span>
                  )}
                </div>
                <div className={styles.miniStack}>
                  {items.map((item) => (
                    <button
                      key={item.label}
                      className={styles.stackDot}
                      type="button"
                      title={`Copy ${item.label}: ${colorText(item)}`}
                      aria-label={`Copy ${item.label} color`}
                      onClick={() => onCopyColor(item)}
                      style={{ "--dot-color": item.solid } as React.CSSProperties}
                    />
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function ColorChecker() {
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const nodeCount = TAXONOMY_TREE.reduce(
    (sum, root) => sum + 1 + (root.children?.length ?? 0),
    0,
  );

  const copyColor = (item: TaxonomyColorItem) => {
    const value = colorText(item);
    void navigator.clipboard?.writeText(value);
    setCopiedValue(value);
    window.setTimeout(() => {
      setCopiedValue((current) => (current === value ? null : current));
    }, 1200);
  };

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Taxonomy Colors</h1>
          <p className={styles.subtitle}>
            Click any swatch to copy its HSL value.
          </p>
        </div>
        <div className={styles.summary}>
          <span>{TAXONOMY_TREE.length} roots</span>
          <span>{nodeCount} nodes</span>
        </div>
      </header>

      <div className={styles.content}>
        {TAXONOMY_TREE.map((root, index) => (
          <RootRow
            key={root.name}
            root={root}
            index={index}
            copiedValue={copiedValue}
            onCopyColor={copyColor}
          />
        ))}
      </div>
    </main>
  );
}
