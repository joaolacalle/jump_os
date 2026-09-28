-- ============================================================
-- REGISTRO DOS EVENTOS DE DM AUTOMÁTICA — PASSO 1: MIGRATION
-- ============================================================
-- Contexto: o motivo desta tabela existir é o próprio histórico recente de
-- depuração da conexão Instagram (rodada "Inscrição no webhook" + duas
-- correções, 26–28/set/2026) — quatro rodadas às cegas até achar a causa
-- (conta não inscrita → faltava permissão → id errado → app em modo dev),
-- cada uma exigindo pedir pro João testar de novo e relatar o que
-- aconteceu, porque nenhuma delas deixava rastro no banco. Esta tabela
-- existe pra próxima vez que algo não disparar, a resposta estar numa
-- linha só (SELECT * FROM dm_eventos WHERE ig_id_recebido = '...' ORDER BY
-- criado_em DESC LIMIT 1), em vez de reconstruir o caminho lendo log de
-- runtime da Vercel ou pedindo teste novo.
--
-- O que isto cria (nada disso mexe em nenhuma tabela existente):
--   1) uma tabela nova, dm_eventos — 1 linha por decisão que
--      processarWebhook (api/cron.js) toma pra cada comentário/DM recebido
--      via webhook do Instagram: achou a conta? achou regra ativa? o
--      remetente é o próprio dono? bateu alguma palavra-chave? tinha cota?
--      a Meta aceitou o envio? Cada uma dessas perguntas vira 1 valor fixo
--      de `resultado` (ver CHECK abaixo) — nunca texto livre, pra dar pra
--      filtrar/contar sem adivinhar variação de grafia.
--   2) dois índices — um pela data (usado pela limpeza de 30 dias, ver
--      jobLimpeza em api/cron.js), outro por (user_id, criado_em) — mesmo
--      uso que uma futura tela de histórico por cliente teria.
--   3) RLS ligado, com a MESMA política de leitura que contas_conectadas
--      já usa hoje (cc_gestao: dono vê as próprias linhas, supervisor e
--      admin veem todas — via is_supervisor_of()/is_admin(), as mesmas
--      funções, não uma cópia da regra em SQL solto). SEM política de
--      escrita: só o cron (SUPABASE_SERVICE_KEY, que ignora RLS por
--      padrão no Supabase) grava aqui — mesmo padrão de "tabela mantida
--      só por um caminho automático, RLS ligado, zero política de escrita
--      pra ninguém mais" que sql/lote1-passo1-migration.sql já usa em
--      ordem_itens.
--
-- user_id e regra_id ficam NULLABLE de propósito: um evento sem_conta
-- (webhook chegou com um ig_id que não bate com nenhuma conexão) não tem
-- user_id nenhum pra gravar — é exatamente o caso que esta tabela existe
-- pra diagnosticar, então a linha tem que poder existir mesmo sem essa
-- referência. Mesma lógica pra regra_id: só existe quando o resultado é
-- 'sem_cota', 'erro_meta' ou 'enviado' (uma regra bateu); nos resultados
-- anteriores (sem_conta/sem_regra/proprio/sem_match) não há regra pra
-- referenciar.
--
-- FOREIGN KEYS com ON DELETE SET NULL, não CASCADE nem bloqueio: apagar um
-- cliente ou uma automação não pode apagar o histórico de diagnóstico nem
-- falhar por causa dele — a linha do evento fica (o registro de "isto
-- aconteceu, nesta data" continua valendo), só perde o vínculo.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS dm_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES clientes(id) ON DELETE SET NULL,
  ig_id_recebido text,
  tipo text NOT NULL CHECK (tipo IN ('comentario', 'dm')),
  texto text,
  alvo text,
  regra_id uuid REFERENCES automacoes_dm(id) ON DELETE SET NULL,
  resultado text NOT NULL CHECK (resultado IN (
    'sem_conta', 'sem_regra', 'proprio', 'sem_match', 'sem_cota', 'erro_meta', 'enviado'
  )),
  detalhe text,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_dm_eventos_criado_em ON dm_eventos(criado_em);
CREATE INDEX IF NOT EXISTS ix_dm_eventos_user_criado ON dm_eventos(user_id, criado_em DESC);

ALTER TABLE dm_eventos ENABLE ROW LEVEL SECURITY;

-- Leitura: mesmo padrão de contas_conectadas (cc_gestao) — dono, supervisor
-- ou admin. Sem política de INSERT/UPDATE/DELETE: só o service_role (cron)
-- escreve, e esse ignora RLS por padrão — nenhum cliente ou navegador
-- precisa (nem deve) gravar aqui diretamente.
DROP POLICY IF EXISTS dm_eventos_sel ON dm_eventos;
CREATE POLICY dm_eventos_sel ON dm_eventos FOR SELECT
  USING (user_id = auth.uid() OR is_supervisor_of(user_id) OR is_admin());

COMMIT;

-- Confirmação (opcional, só leitura):
-- SELECT relrowsecurity FROM pg_class WHERE relname = 'dm_eventos';
-- SELECT policyname, cmd FROM pg_policies WHERE tablename = 'dm_eventos';
