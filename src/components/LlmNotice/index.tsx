import type { ReactNode } from "react";
import styles from "./styles.module.css";

// Rendered above every doc page by src/theme/DocItem/Content. One place to edit,
// rather than the same block pasted into 70 markdown files.
export default function LlmNotice(): ReactNode {
  return (
    <aside className={styles.notice}>
      <strong className={styles.tag}>LLM GENERATED</strong>
      <span>
        An LLM wrote this page. I have reviewed it and the content is correct.
        What I have not had time to do is write it in my own words. Apologies
        for the machine prose.
      </span>
    </aside>
  );
}
