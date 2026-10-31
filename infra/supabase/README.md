# infra/supabase

Stack Supabase self-hosted **dedicada ao Triatlo Inteligente**, para um serviço Compose do EasyPanel.

- Passo a passo completo: [`docs/SUPABASE_EASYPANEL.md`](../../docs/SUPABASE_EASYPANEL.md)
- Origem, versão fixada e diferenças do upstream: [`UPSTREAM.md`](UPSTREAM.md)
- Segredos: `sh scripts/prepare-env.sh` gera tudo **fora do repositório** (`~/.triatlo-secrets/supabase.env`). Nunca versionar.
- Testes de superfície pública: `bash scripts/smoke-test.sh --api-url https://…`
- Criação da conta única: `bash scripts/create-admin-user.sh --api-url https://…`
- Backup/restauração: [`../backup/RESTORE.md`](../backup/RESTORE.md)
