import type { Metadata } from "next";
import { ensureRuleSet, getApprovedRuleSet, getPreferences, getProfile, listAvailability, readAiConfig, MEAL_ANALYSIS_DISCLOSURE } from "@triatlo/data";
import { Card, DisabledButton, PageHeader, StatusPill } from "@/components/ui";
import { Field, Notice, firstParam, inputClass, primaryButton, secondaryButton } from "@/components/forms";
import { ImportPanel } from "@/components/ImportPanel";
import { PushSetup } from "@/components/PushSetup";
import { readPublicConfig } from "@/lib/env";
import { requireSession } from "@/server/ctx";
import { aiConsentAction, approveRulesAction, saveAvailabilityAction, saveProfileAction } from "@/server/actions";
import { signOut } from "@/app/login/actions";
import pkg from "../../../../package.json";

export const metadata: Metadata = { title: "Configurações" };
// Reads runtime configuration and the signed-in user's data: rendered per request.
export const dynamic = "force-dynamic";

const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const ZONES = ["America/Sao_Paulo", "America/Manaus", "America/Belem", "America/Fortaleza", "America/Recife", "America/Bahia", "America/Cuiaba", "America/Rio_Branco", "America/Noronha", "Europe/Lisbon"];

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const { ctx, email } = await requireSession();
  const [profile, windows, prefs, draft, approved] = await Promise.all([getProfile(ctx), listAvailability(ctx), getPreferences(ctx), ensureRuleSet(ctx), getApprovedRuleSet(ctx)]);
  const byDay = new Map(windows.filter((w) => w.kind === "training").map((w) => [w.weekday, w]));
  const aiConfigured = readAiConfig(process.env) !== null;
  const rules = draft.params;

  return (
    <>
      <PageHeader title="Configurações" subtitle="Perfil, janelas de treino, regras do assistente, dados do relógio, IA e notificações." />
      <Notice ok={firstParam(query.ok)} erro={firstParam(query.erro)} />

      <div className="grid gap-4">
        <Card title="Perfil" aside={profile?.timezone ? <StatusPill tone="ok">fuso definido</StatusPill> : <StatusPill tone="warn">defina o fuso</StatusPill>}>
          <form action={saveProfileAction} className="grid gap-3 sm:grid-cols-2">
            <Field label="Nome" htmlFor="displayName"><input id="displayName" name="displayName" defaultValue={profile?.displayName ?? ""} className={inputClass} /></Field>
            <Field label="Fuso horário" htmlFor="timezone" hint="Define o que é “hoje” e a hora dos treinos e lembretes.">
              <input id="timezone" name="timezone" list="zones" required defaultValue={profile?.timezone ?? ""} placeholder="Ex.: America/Sao_Paulo" className={inputClass} />
              <datalist id="zones">{ZONES.map((z) => <option key={z} value={z} />)}</datalist>
            </Field>
            <div className="sm:col-span-2"><button type="submit" className={primaryButton}>Salvar perfil</button></div>
          </form>
        </Card>

        <Card title="Janelas de treino">
          <form action={saveAvailabilityAction} className="grid gap-2">
            <p className="text-sm text-muted">Quando você pode treinar em cada dia. O planejador só posiciona sessões dentro destas janelas. Em branco = sem treino nesse dia.</p>
            {WEEKDAYS.map((name, weekday) => (
              <div key={weekday} className="grid grid-cols-[6rem_1fr_1fr] items-center gap-2">
                <span className="text-sm">{name}</span>
                <input type="time" name={`start_${weekday}`} defaultValue={byDay.get(weekday)?.startsAt ?? ""} aria-label={`${name}: início`} className={inputClass} />
                <input type="time" name={`end_${weekday}`} defaultValue={byDay.get(weekday)?.endsAt ?? ""} aria-label={`${name}: fim`} className={inputClass} />
              </div>
            ))}
            <div><button type="submit" className={primaryButton}>Salvar janelas</button></div>
          </form>
        </Card>

        <Card title="Regras do assistente" aside={<StatusPill tone={approved ? "ok" : "warn"}>{approved ? `v${approved.version} aprovada` : `v${draft.version} em rascunho (inativa)`}</StatusPill>}>
          <p className="text-sm text-muted">
            São escolhas de política do projeto, não fatos médicos. Tudo é relativo à <em>sua</em> própria mediana recente; o assistente só sugere <strong>reduções</strong> e nunca aumenta carga.
          </p>
          <ul className="mt-3 grid gap-1 text-sm">
            <li>Compara com os seus últimos {rules.lookbackDays} dias (mínimo {rules.minKnownDays} dias com dados).</li>
            <li>Gatilho: piora de {rules.subjective.minPointsWorse} ponto(s) por {rules.subjective.consecutiveDays} dias seguidos, ou sono {Math.round(rules.sleep.shortfallFraction * 100)}% abaixo do seu normal.</li>
            <li>Proposta: reduzir a duração em {Math.round(rules.reduction.durationFraction * 100)}% (só treinos nas próximas {rules.horizonHours} h).</li>
            <li>No máximo {rules.stability.maxProposalsPerWeek} propostas por semana; mínimo de {rules.stability.minHoursBetweenChangesPerSession} h entre mudanças na mesma sessão.</li>
            <li>Dado ausente nunca dispara nada. Relato de cansaço seu nunca é descartado.</li>
          </ul>
          {approved && approved.version === draft.version ? (
            <p className="mt-3 text-sm">Estas regras estão ativas. Ajustes automáticos: <strong>{prefs.autoApplyEnabled ? "ligados (só reduções até o limite acima)" : "desligados"}</strong>.</p>
          ) : null}
          <form action={approveRulesAction} className="mt-3 grid gap-2">
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="autoApply" defaultChecked={prefs.autoApplyEnabled} className="mt-1" />
              <span>Aplicar sozinho reduções pequenas (até {Math.round(rules.reduction.maxAutoFraction * 100)}%). Sempre dá para desfazer. Desmarcado: toda mudança pede sua aprovação.</span>
            </label>
            <div><button type="submit" className={primaryButton}>{approved?.version === draft.version ? "Atualizar autonomia" : `Aprovar regras v${draft.version}`}</button></div>
          </form>
        </Card>

        <Card title="Relógio — importar dados reais" aside={<StatusPill tone="neutral">importação de arquivo</StatusPill>}>
          <p className="mb-3 text-sm text-muted">
            O Amazfit Active 2 não tem API pública. O caminho real e verificável é exportar os dados do app Zepp para o app Saúde da Apple e importar o export aqui, ou importar GPX/TCX de treinos.
          </p>
          <ImportPanel />
        </Card>

        <Card title="IA e privacidade" aside={<StatusPill tone={prefs.aiProcessingConsentAt ? "ok" : "neutral"}>{prefs.aiProcessingConsentAt ? "consentimento ativo" : "sem consentimento"}</StatusPill>}>
          <p className="text-sm">{MEAL_ANALYSIS_DISCLOSURE.purpose}. Enviado ao provedor: <strong>apenas a foto da refeição</strong> (nenhum dado de saúde, treino ou identificação).</p>
          <p className="mt-1 text-sm text-muted">As respostas são estimativas, validadas pelo app e sempre revisadas por você. {aiConfigured ? "Provedor configurado neste ambiente." : "Provedor de IA ainda não configurado neste ambiente."}</p>
          <form action={aiConsentAction} className="mt-3 flex flex-wrap gap-2">
            {prefs.aiProcessingConsentAt
              ? <button type="submit" name="grant" value="0" className={secondaryButton}>Retirar consentimento</button>
              : <button type="submit" name="grant" value="1" className={primaryButton}>Autorizar envio de fotos de refeição</button>}
          </form>
        </Card>

        <Card title="Notificações">
          <PushSetup config={readPublicConfig()} />
        </Card>

        <Card title="Seus dados">
          <p className="mb-3 text-sm text-muted">Exportação e exclusão completas ainda não estão disponíveis.</p>
          <div className="flex flex-wrap gap-2">
            <DisabledButton reason="Ainda não implementado">Exportar dados</DisabledButton>
            <DisabledButton reason="Ainda não implementado">Excluir registros</DisabledButton>
          </div>
        </Card>

        <Card title="Conta e sistema">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted">Conta</dt><dd>{email ?? "—"}</dd>
            <dt className="text-muted">Versão</dt><dd>{pkg.version}</dd>
          </dl>
          <form action={signOut} className="mt-3"><button type="submit" className={secondaryButton}>Sair</button></form>
        </Card>
      </div>
    </>
  );
}
