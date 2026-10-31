import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DemoCard, EmptyState } from "./ui";

describe("demo content is clearly identified", () => {
  it("DemoCard always shows the 'Demonstração' badge and the not-real-data notice", () => {
    const html = renderToStaticMarkup(<DemoCard title="Exemplo">conteúdo</DemoCard>);
    expect(html).toContain('data-demo="true"');
    expect(html).toContain("Demonstração");
    expect(html).toContain("Não são dados reais");
  });

  it("EmptyState renders only what it is given", () => {
    const html = renderToStaticMarkup(<EmptyState title="Nenhum treino planejado" />);
    expect(html).toContain("Nenhum treino planejado");
    expect(html).not.toContain("Demonstração");
  });
});
