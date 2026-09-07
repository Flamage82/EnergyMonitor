import type { ReactNode } from "react";

export function Section({ title, error, children }: { title: string; error?: string | null; children: ReactNode }) {
  return (
    <section className="section">
      <h2>{title}</h2>
      {error ? <p className="banner" role="alert">{error}</p> : null}
      {children}
    </section>
  );
}
