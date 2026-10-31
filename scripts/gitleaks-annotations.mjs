// Turns a gitleaks JSON report (generated with --redact) into GitHub workflow annotations, so findings are readable
// without opening the job log. Never prints secret values (the report is already redacted). Exits 1 if there are findings.
import { existsSync, readFileSync } from "node:fs";

const file = process.argv[2] ?? "gitleaks-report.json";
if (!existsSync(file)) {
  console.error(`::error::gitleaks report not found: ${file}`);
  process.exit(1);
}
const raw = readFileSync(file, "utf8").trim();
const findings = raw === "" ? [] : JSON.parse(raw);
if (!Array.isArray(findings) || findings.length === 0) {
  console.log("gitleaks: no findings");
  process.exit(0);
}
for (const f of findings.slice(0, 50)) {
  const commit = String(f.Commit ?? "").slice(0, 7);
  console.log(`::error file=${f.File},line=${f.StartLine},title=gitleaks ${f.RuleID}::${f.Description} (commit ${commit})`);
}
console.error(`gitleaks: ${findings.length} finding(s)`);
process.exit(1);
