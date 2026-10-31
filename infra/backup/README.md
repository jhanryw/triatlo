# infra/backup

Backups do Supabase self-hosted. O agendamento roda no serviço `backup` do compose (`infra/supabase/backup/backup.sh`): dump do banco, roles e arquivos do Storage, com checksums e retenção.

- Restauração e ensaio: [`RESTORE.md`](RESTORE.md)
- **Cópia externa**: depende da escolha do destino (pendência Q-03). Enquanto não existir, os backups ficam apenas no mesmo servidor — **isso não é um backup externo**.
